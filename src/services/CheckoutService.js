const {
  PagamentoAprovado,
  PagamentoRecusado,
  FalhaInfraestrutura,
} = require('./ResultadoPagamento');

/**
 * CheckoutService — versão refatorada (Fase 2).
 *
 * Antes (legado): processar() continha 1 if/else + 1 try/catch misturados
 * com a lógica de persistência e e-mail na mesma função → V(G) = 3.
 *
 * Depois: processar() não tem nenhum nó de decisão (V(G) = 1). A
 * complexidade não desapareceu — ela foi ISOLADA dentro de _cobrar(),
 * que é a única "fábrica" responsável por traduzir a resposta externa
 * (ou uma exceção) em um objeto ResultadoPagamento. A partir daí, tudo
 * é despacho polimórfico.
 */
class CheckoutService {
  constructor(gatewayPagamento, pedidoRepository, emailService, options = {}) {
    this.gatewayPagamento = gatewayPagamento;
    this.pedidoRepository = pedidoRepository;
    this.emailService = emailService;

    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.sleepFn = options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.randomFn = options.randomFn ?? Math.random;
  }

  async processar(pedido) {
    const resultado = await this._cobrar(pedido);

    // Nenhum if/else aqui — o próprio objeto "resultado" sabe o que fazer.
    return resultado.finalizar(pedido, {
      pedidoRepository: this.pedidoRepository,
      emailService: this.emailService,
    });
  }

  /**
   * Único ponto de decisão remanescente do componente.
   * V(G) desta função = 3 (idêntico ao legado: 1 decisão do if de status
   * + 1 decisão implícita do try/catch), mas agora vive isolada em uma
   * função pequena, de responsabilidade única, fácil de testar com
   * Stubs simulando cada resposta do gateway (ver tarefas da Pessoa 3).
   */
  async _cobrar(pedido) {
    let tentativa = 0;

    while (true) {
      try {
        const resposta = await this.gatewayPagamento.cobrar(pedido.valor, pedido.cartao);
        return resposta.status === 'APROVADO'
          ? new PagamentoAprovado()
          : new PagamentoRecusado();
      } catch (error) {
        tentativa += 1;
        const aindaTemRetry = tentativa <= this.maxRetries;

        if (!aindaTemRetry) {
          console.error('Falha catastrófica no gateway bancário:', error.message);
          return new FalhaInfraestrutura();
        }

        const atraso = this._computeRetryDelayWithJitter(this.retryDelayMs);
        console.warn(`Gateway falhou na tentativa ${tentativa}. Retentando em ${atraso}ms.`, error.message);
        await this.sleepFn(atraso);
      }
    }
  }

  _computeRetryDelayWithJitter(baseDelayMs) {
    const jitter = Math.floor(this.randomFn() * 200);
    return baseDelayMs + jitter;
  }
}

module.exports = { CheckoutService };
