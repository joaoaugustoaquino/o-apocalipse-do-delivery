/**
 * Hierarquia polimórfica que substitui o if/else + try/catch do método
 * legado CheckoutService.processar().
 *
 * Refatoração aplicada: "Replace Conditional with Polymorphism" (Fowler).
 *
 * No código legado, o comportamento de cada cenário (aprovado, recusado,
 * erro de infraestrutura) era decidido inline através de condicionais.
 * Aqui, cada cenário se torna uma classe própria que SABE finalizar o
 * pedido por conta própria — quem chama não precisa mais perguntar
 * "qual foi o resultado?" antes de agir.
 */

class ResultadoPagamento {
  /**
   * @param {object} pedido - o pedido sendo processado
   * @param {{ pedidoRepository: object, emailService: object }} deps
   * @returns {Promise<{ pedidoSalvo: object|null, httpStatus: number }>}
   */
  async finalizar(pedido, deps) {
    throw new Error('finalizar() deve ser implementado pela subclasse de ResultadoPagamento');
  }
}

/** Fluxo 1 (Base) — RF02: pagamento aprovado pelo gateway. */
class PagamentoAprovado extends ResultadoPagamento {
  async finalizar(pedido, { pedidoRepository, emailService }) {
    pedido.status = 'PROCESSADO';
    const pedidoSalvo = await pedidoRepository.salvar(pedido);

    // RF02 (Restrição Arquitetural): o disparo do e-mail é uma chamada de
    // rede externa e deve ser não-bloqueante. O código legado usava
    // "await" aqui, acoplando a latência do SMTP externo à resposta HTTP
    // do checkout — um smell que esta refatoração já corrige de brinde.
    emailService
      .enviarConfirmacao(pedido.clienteEmail, 'Pagamento Aprovado')
      .catch((err) => console.error('Falha ao enviar e-mail de confirmação:', err.message));

    return { pedidoSalvo, httpStatus: 200 };
  }
}

/** Fluxo 2 (Negócio) — RF03: gateway respondeu, mas recusou a cobrança. */
class PagamentoRecusado extends ResultadoPagamento {
  async finalizar(pedido, { pedidoRepository }) {
    pedido.status = 'FALHOU';
    await pedidoRepository.salvar(pedido);
    // RN03 (Regra Crítica): jamais disparar e-mail de confirmação aqui.
    return { pedidoSalvo: null, httpStatus: 500 };
  }
}

/** Fluxo 4 (Caos) — RF05: falha de infraestrutura (timeout, 5xx, conexão recusada). */
class FalhaInfraestrutura extends ResultadoPagamento {
  async finalizar(pedido, { pedidoRepository }) {
    pedido.status = 'ERRO_GATEWAY';
    await pedidoRepository.salvar(pedido);
    return { pedidoSalvo: null, httpStatus: 500 };
  }
}

module.exports = {
  ResultadoPagamento,
  PagamentoAprovado,
  PagamentoRecusado,
  FalhaInfraestrutura,
};
