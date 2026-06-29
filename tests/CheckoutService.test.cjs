const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const app = require('../src/server');
const { CheckoutService } = require('../src/services/CheckoutService');
const { OrderBuilder } = require('./builders/OrderBuilder');

test('salva pedido processado e envia e-mail quando o pagamento é aprovado', async () => {
  const pedido = new OrderBuilder().build();
  const gatewayPagamento = { cobrar: async () => ({ status: 'APROVADO' }) };
  const pedidoSalvo = { ...pedido, id: 123, status: 'PROCESSADO' };
  const pedidoRepository = {
    salvar: async (pedidoRecebido) => {
      assert.equal(pedidoRecebido.status, 'PROCESSADO');
      return pedidoSalvo;
    },
  };

  let emailChamado = false;
  const emailService = {
    enviarConfirmacao: async (email, mensagem) => {
      emailChamado = true;
      assert.equal(email, pedido.clienteEmail);
      assert.equal(mensagem, 'Pagamento Aprovado');
    },
  };

  const service = new CheckoutService(gatewayPagamento, pedidoRepository, emailService, {
    sleepFn: async () => {},
    randomFn: () => 0,
  });

  const resultado = await service.processar(pedido);
  assert.equal(resultado.status, 'PROCESSADO');
  assert.equal(emailChamado, true);
  assert.deepEqual(resultado.pedidoSalvo, pedidoSalvo);
});

test('registra pedido como FALHOU e não envia e-mail quando pagamento é recusado', async () => {
  const pedido = new OrderBuilder().build();
  const gatewayPagamento = { cobrar: async () => ({ status: 'RECUSADO' }) };
  let salvarChamada = false;
  const pedidoRepository = {
    salvar: async (pedidoRecebido) => {
      salvarChamada = true;
      assert.equal(pedidoRecebido.status, 'FALHOU');
      return { ...pedidoRecebido, id: 456 };
    },
  };

  const emailService = {
    enviarConfirmacao: async () => {
      throw new Error('Não deveria enviar e-mail em pedido recusado');
    },
  };

  const service = new CheckoutService(gatewayPagamento, pedidoRepository, emailService, {
    sleepFn: async () => {},
    randomFn: () => 0,
  });

  const resultado = await service.processar(pedido);
  assert.equal(resultado.status, 'FALHOU');
  assert.equal(resultado.pedidoSalvo, null);
  assert.equal(salvarChamada, true);
});

test('executa retry com backoff e jitter e processa pedido após recuperação', async () => {
  const pedido = new OrderBuilder().build();
  let tentativas = 0;
  const gatewayPagamento = {
    cobrar: async () => {
      tentativas += 1;
      if (tentativas === 1) throw new Error('Gateway temporariamente indisponível');
      return { status: 'APROVADO' };
    },
  };

  const pedidoRepository = { salvar: async (pedidoRecebido) => ({ ...pedidoRecebido, id: 789 }) };
  const emailService = { enviarConfirmacao: async () => {} };
  const sleepCalls = [];
  
  const service = new CheckoutService(gatewayPagamento, pedidoRepository, emailService, {
    sleepFn: async (ms) => sleepCalls.push(ms),
    randomFn: () => 0.3,
  });

  const resultado = await service.processar(pedido);
  assert.equal(tentativas, 2);
  assert.equal(resultado.status, 'PROCESSADO');
  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0], 560);
});

test('esgota retries e retorna ERRO_GATEWAY após falhas persistentes', async () => {
  const pedido = new OrderBuilder().build();
  let tentativas = 0;
  const gatewayPagamento = {
    cobrar: async () => {
      tentativas += 1;
      throw new Error('Falha persistente do gateway');
    },
  };

  const pedidoRepository = { salvar: async (pedidoRecebido) => ({ ...pedidoRecebido, id: 999 }) };
  const emailService = {
    enviarConfirmacao: async () => {
      throw new Error('Não deveria enviar e-mail em falha de infraestrutura');
    },
  };

  const sleepCalls = [];
  const service = new CheckoutService(gatewayPagamento, pedidoRepository, emailService, {
    maxRetries: 3,
    sleepFn: async (ms) => sleepCalls.push(ms),
    randomFn: () => 0.2,
  });

  const resultado = await service.processar(pedido);
  assert.equal(tentativas, 4);
  assert.equal(resultado.status, 'ERRO_GATEWAY');
  assert.equal(pedido.status, 'ERRO_GATEWAY'); 
  assert.equal(sleepCalls.length, 3);
  assert.deepEqual(sleepCalls, [540, 540, 540]);
});

test('CheckoutService - deve usar sleepFn padrão quando nenhuma for fornecida', async () => {
  const gatewayPagamento = { cobrar: async () => ({ status: 'APROVADO' }) };
  const pedidoRepository = { salvar: async (p) => ({ ...p, id: 1 }) };
  const emailService = { enviarConfirmacao: async () => {} };

  const service = new CheckoutService(gatewayPagamento, pedidoRepository, emailService);
  
  assert.ok(service.sleepFn);
  assert.equal(typeof service.sleepFn, 'function');
});

test('CheckoutService - deve tratar erro na falha de envio do e-mail de confirmacao', async () => {
  const pedido = new OrderBuilder().build();
  const gatewayPagamento = { cobrar: async () => ({ status: 'APROVADO' }) };
  const pedidoRepository = { salvar: async (p) => ({ ...p, id: 1 }) };
  const emailService = {
    enviarConfirmacao: async () => {
      return Promise.reject(new Error('Erro de envio'));
    }
  };

  const service = new CheckoutService(gatewayPagamento, pedidoRepository, emailService, {
    sleepFn: async () => {},
    randomFn: () => 0,
  });

  const resultado = await service.processar(pedido);
  assert.equal(resultado.status, 'PROCESSADO');
});

test('Server.js - Rota /api/v1/checkout deve rejeitar requisições sem dados essenciais', async () => {
  const r1 = await request(app).post('/api/v1/checkout').send({ valor: 50, cartao: {} });
  assert.equal(r1.status, 400);
  assert.equal(r1.body.erro, 'Dados incompletos para checkout');

  const r2 = await request(app).post('/api/v1/checkout').send({ clienteEmail: 'felipe@puc.com', cartao: {} });
  assert.equal(r2.status, 400);

  const r3 = await request(app).post('/api/v1/checkout').send({ clienteEmail: 'felipe@puc.com', valor: 50 });
  assert.equal(r3.status, 400);
});

test('Server.js - Rota /api/v1/checkout executa fluxo com sucesso e devolve payload correto', async () => {
  const payloadValido = {
    clienteEmail: 'cliente.valido@entregasja.com.br',
    valor: 89.9,
    cartao: { numero: '4111111111111111', validade: '12/2030', cvv: '123', titular: 'Cliente Valido' }
  };

  const res = await request(app).post('/api/v1/checkout').send(payloadValido);
  assert.equal(res.status, 200);
  assert.equal(res.body.mensagem, 'Pedido finalizado com sucesso!');
  assert.equal(res.body.pedido.status, 'PROCESSADO');
  assert.ok(res.body.pedido.id);
  assert.equal(res.body.pedido.clienteEmail, 'cliente.valido@entregasja.com.br');
  assert.equal(res.body.pedido.valor, 89.9);
});

test('Server.js - Rota /api/v1/checkout retorna erro 500 caso ocorra falha catastrófica ou recusa', async () => {
  const payloadParaFalha = {
    clienteEmail: 'cliente.falhou@entregasja.com.br',
    valor: 99999.99,
    cartao: { numero: '0000000000000000', validade: '01/2025', cvv: '999', titular: 'Gera Erro' }
  };

  const res = await request(app).post('/api/v1/checkout').send(payloadParaFalha);
  
  assert.equal(res.status, 500);
  assert.ok(res.body.erro);
  assert.equal(res.body.erro, 'Não foi possível processar seu pagamento. Tente mais tarde.');
});

test('Server.js - Rota /api/v1/cache/flush invalida estado e retorna confirmação', async () => {
  const res = await request(app).post('/api/v1/cache/flush');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cache_invalidated');
});