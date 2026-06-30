import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const taxaErro         = new Rate('taxa_erro_checkout');
const latenciaCheckout = new Trend('latencia_checkout_ms', true);

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0  },
  ],

  thresholds: {
    'latencia_checkout_ms': ['p(95)<5000'],
    'http_req_failed': ['rate<0.05'],
  },
};

const payload = JSON.stringify({
  clienteEmail: 'cliente.blackfriday@entregasja.com.br',
  valor: 89.90,
  cartao: {
    numero: '4111111111111111',
    validade: '12/2030',
    cvv: '123',
    titular: 'Cliente Black Friday',
  },
});

const headers = { 'Content-Type': 'application/json' };

export default function () {
  const inicio = Date.now();

  const res = http.post(
    'http://localhost:3000/api/v1/checkout',
    payload,
    { headers }
  );

  const duracao = Date.now() - inicio;
  latenciaCheckout.add(duracao);

  const sucesso = check(res, {
    'Status 200': (r) => r.status === 200,
    'Mensagem de sucesso': (r) => {
      try { return JSON.parse(r.body).mensagem === 'Pedido finalizado com sucesso!'; }
      catch { return false; }
    },
    'Latência abaixo de 5000ms': () => duracao < 5000,
  });

  taxaErro.add(!sucesso);

  sleep(Math.random() * 1 + 0.5);
}

export function handleSummary(data) {
  const p95   = data.metrics['latencia_checkout_ms']?.values?.['p(95)'] ?? 'N/A';
  const erros = (data.metrics['taxa_erro_checkout']?.values?.rate * 100 ?? 0).toFixed(2);
  const total = data.metrics['http_reqs']?.values?.count ?? 0;

  console.log('\n════════════════════════════════════════');
  console.log('  RELATÓRIO — BLACK FRIDAY LOAD TEST');
  console.log('════════════════════════════════════════');
  console.log(`  Total de requisições : ${total}`);
  console.log(`  Latência p95         : ${typeof p95 === 'number' ? p95.toFixed(0) + 'ms' : p95}`);
  console.log(`  Taxa de erro         : ${erros}%`);
  console.log(`  SLO-01 (p95<5000ms)  : ${typeof p95 === 'number' && p95 < 5000 ? 'APROVADO' : 'VIOLADO'}`);
  console.log(`  SLO-03 (erro<5%)     : ${parseFloat(erros) < 5 ? 'APROVADO' : 'VIOLADO'}`);
  console.log('════════════════════════════════════════\n');

  return {
    'testes-carga/reports/resultado-blackfriday.json': JSON.stringify(data, null, 2),
  };
}
