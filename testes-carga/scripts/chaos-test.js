import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const taxaErroCaos = new Rate('taxa_erro_caos');
const latenciaCaos = new Trend('latencia_caos_ms', true);
const reqSucesso = new Counter('requisicoes_sucesso');
const reqFalha = new Counter('requisicoes_falha');

export const options = {
  scenarios: {
    thundering_herd: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 100 },
        { duration: '2m',  target: 100 },
        { duration: '30s', target: 0   },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'latencia_caos_ms': [{ threshold: 'p(95)<8000', abortOnFail: false }],
    'taxa_erro_caos': [{ threshold: 'rate<0.20', abortOnFail: false }],
  },
};

const payload = JSON.stringify({
  clienteEmail: 'caos@entregasja.com.br',
  valor: 150.00,
  cartao: { numero: '4111111111111111', validade: '12/2030', cvv: '456', titular: 'Cliente Caos' },
});

const headers = { 'Content-Type': 'application/json' };

const registroDeEventos = [];

export default function () {
  const inicio = Date.now();

  const res = http.post('http://localhost:9090/api/v1/checkout', payload, {
    headers,
    timeout: '15s',
  });

  const duracao = Date.now() - inicio;
  latenciaCaos.add(duracao);

  const sucesso = res.status === 200;

  const ok = check(res, {
    'servidor respondeu (nao travou)': (r) => r.status !== 0,
    'status 200 ou 500 (degradacao ok)': (r) => r.status === 200 || r.status === 500,
    'sem erro 503 (cascata catastrofico)': (r) => r.status !== 503,
    'latencia abaixo de 8000ms (SLO-04)': () => duracao < 8000,
  });

  if (sucesso) { reqSucesso.add(1); } else { reqFalha.add(1); }
  taxaErroCaos.add(!sucesso);

  registroDeEventos.push({
    timestamp: Date.now(),
    sucesso: sucesso,
    status: res.status,
    duracao: duracao,
  });

  sleep(Math.random() * 0.5 + 0.1);
}

export function handleSummary(data) {
  const p95    = data.metrics['latencia_caos_ms']?.values?.['p(95)'] ?? 'N/A';
  const erros  = (data.metrics['taxa_erro_caos']?.values?.rate * 100 ?? 0).toFixed(2);
  const total  = data.metrics['http_reqs']?.values?.count ?? 0;
  const ok     = data.metrics['requisicoes_sucesso']?.values?.count ?? 0;
  const falhas = data.metrics['requisicoes_falha']?.values?.count ?? 0;

  console.log('');
  console.log('========================================');
  console.log('  RELATORIO - CHAOS TEST (Toxiproxy)');
  console.log('========================================');
  console.log('  Total de requisicoes : ' + total);
  console.log('  Sucesso (200)        : ' + ok);
  console.log('  Falha (nao-200)      : ' + falhas);
  console.log('  Latencia p95         : ' + (typeof p95 === 'number' ? p95.toFixed(0) + 'ms' : p95));
  console.log('  Taxa de erro         : ' + erros + '%');
  console.log('  SLO-04 (p95<8000ms)  : ' + (typeof p95 === 'number' && p95 < 8000 ? 'APROVADO' : 'VIOLADO'));
  console.log('  SLO-05 (erro<20%)    : ' + (parseFloat(erros) < 20 ? 'APROVADO' : 'VIOLADO'));
  console.log('========================================');
  console.log('');

  return {
    'testes-carga/reports/resultado-chaos.json': JSON.stringify(data, null, 2),
    'testes-carga/reports/eventos-chaos.json': JSON.stringify(registroDeEventos, null, 2),
  };
}
