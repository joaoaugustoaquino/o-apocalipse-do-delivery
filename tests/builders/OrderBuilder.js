class OrderBuilder {
  constructor() {
    this.order = {
      clienteEmail: 'cliente.valido@entregasja.com.br',
      valor: 89.9,
      cartao: {
        numero: '4111111111111111',
        validade: '12/2030',
        cvv: '123',
        titular: 'Cliente Valido',
      },
      status: 'PENDENTE',
      itens: [
        {
          id: 'item-001',
          nome: 'Combo almoco',
          quantidade: 1,
          precoUnitario: 89.9,
        },
      ],
    };
  }

  withEmail(clienteEmail) {
    this.order.clienteEmail = clienteEmail;
    return this;
  }

  withValue(valor) {
    this.order.valor = valor;
    return this;
  }

  withHighValue() {
    this.order.valor = 9999.99;
    this.order.itens = [
      {
        id: 'item-premium-001',
        nome: 'Pedido corporativo premium',
        quantidade: 1,
        precoUnitario: 9999.99,
      },
    ];
    return this;
  }

  withInvalidCard() {
    this.order.cartao = {
      ...this.order.cartao,
      numero: '0000000000000000',
      cvv: '000',
    };
    return this;
  }

  withExpiredDate() {
    this.order.cartao = {
      ...this.order.cartao,
      validade: '01/2020',
    };
    return this;
  }

  withCard(cartao) {
    this.order.cartao = {
      ...this.order.cartao,
      ...cartao,
    };
    return this;
  }

  withStatus(status) {
    this.order.status = status;
    return this;
  }

  withItems(itens) {
    this.order.itens = itens.map((item) => ({ ...item }));
    return this;
  }

  build() {
    return {
      ...this.order,
      cartao: { ...this.order.cartao },
      itens: this.order.itens.map((item) => ({ ...item })),
    };
  }
}

module.exports = { OrderBuilder };
