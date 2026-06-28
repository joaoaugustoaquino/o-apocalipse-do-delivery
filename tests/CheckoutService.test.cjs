const assert = require('node:assert/strict');
const test = require('node:test');
const { CheckoutService } = require('../src/services/CheckoutService');
const { OrderBuilder } = require('./builders/OrderBuilder');

test('salva pedido processado e envia e-mail quando o pagamento é aprovado', async () => {
  const pedido = new OrderBuilder().build();

  const gatewayPagamento = {
    cobrar: async () => ({ status: 'APROVADO' }),
  };

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

  const gatewayPagamento = {
    cobrar: async () => ({ status: 'RECUSADO' }),
  };

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
      if (tentativas === 1) {
        throw new Error('Gateway temporariamente indisponível');
      }
      return { status: 'APROVADO' };
    },
  };

  const pedidoRepository = {
    salvar: async (pedidoRecebido) => ({ ...pedidoRecebido, id: 789 }),
  };

  const emailService = {
    enviarConfirmacao: async () => {},
  };

  const sleepCalls = [];
  const service = new CheckoutService(gatewayPagamento, pedidoRepository, emailService, {
    sleepFn: async (ms) => sleepCalls.push(ms),
    randomFn: () => 0.3,
  });

  const resultado = await service.processar(pedido);

  assert.equal(tentativas, 2);
  assert.equal(resultado.status, 'PROCESSADO');
  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0], 560); // 500 + 0.3 * 200
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

  const pedidoRepository = {
    salvar: async (pedidoRecebido) => ({ ...pedidoRecebido, id: 999 }),
  };

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
  assert.equal(sleepCalls.length, 3);
  assert.deepEqual(sleepCalls, [540, 540, 540]);
});
