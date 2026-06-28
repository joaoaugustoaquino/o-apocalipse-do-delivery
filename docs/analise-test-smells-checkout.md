# Analise de Test Smells no Checkout

## Contexto analisado

O microsservico de Checkout esta concentrado principalmente em:

- `src/server.js`: rota HTTP, validacao basica do payload e instanciacao do servico.
- `src/services/CheckoutService.js`: orquestracao da cobranca.
- `src/services/ResultadoPagamento.js`: comportamento para pagamento aprovado, recusado e falha de infraestrutura.

O proprio codigo documenta a diferenca entre a versao legada e a versao refatorada: antes, o metodo `processar()` misturava `if/else`, `try/catch`, persistencia e envio de e-mail na mesma funcao. Hoje, parte disso foi isolada com polimorfismo, mas os smells de teste ainda aparecem quando pensamos em como os testes unitarios seriam escritos sem builders e mocks.

## Test Smell: Obscure Setup

Obscure Setup acontece quando o teste precisa preparar muitos dados irrelevantes antes de chegar ao comportamento que realmente quer verificar. No Checkout, isso tende a aparecer na criacao manual do objeto `pedido`.

Exemplo de ponto sensivel:

- Em `src/server.js`, linhas 31 a 37, a rota extrai `clienteEmail`, `valor` e `cartao`, e depois monta manualmente o objeto `{ clienteEmail, valor, cartao, status: 'PENDENTE' }`.
- Em `src/services/CheckoutService.js`, linhas 43 a 48, o servico depende de `pedido.valor` e `pedido.cartao`.
- Em `src/services/ResultadoPagamento.js`, linhas 27 a 37, o fluxo aprovado tambem usa `pedido.clienteEmail` para enviar confirmacao.

Isso significa que qualquer teste de checkout precisa lembrar quais campos sao obrigatorios, qual formato de cartao usar, qual status inicial configurar e quais valores representam um pedido valido. Sem um Data Builder, cada teste tende a repetir objetos grandes como:

```js
const pedido = {
  clienteEmail: 'cliente@teste.com',
  valor: 89.9,
  cartao: {
    numero: '4111111111111111',
    validade: '12/2030',
    cvv: '123',
  },
  status: 'PENDENTE',
};
```

Esse setup fica ainda pior quando o teste quer apenas simular um detalhe, por exemplo "cartao recusado" ou "cartao expirado". O leitor precisa comparar o objeto inteiro para descobrir qual campo realmente importa para o cenario. Isso reduz clareza, aumenta duplicacao e facilita erros acidentais entre testes.

### Como o Data Builder resolve

A classe `OrderBuilder` criada em `tests/builders/OrderBuilder.js` concentra um pedido valido por padrao. Assim, o teste comeca do caso feliz e modifica apenas o detalhe relevante:

```js
const { OrderBuilder } = require('./builders/OrderBuilder');

const pedidoValido = new OrderBuilder().build();
const pedidoComCartaoInvalido = new OrderBuilder().withInvalidCard().build();
const pedidoExpirado = new OrderBuilder().withExpiredDate().build();
const pedidoAltoValor = new OrderBuilder().withHighValue().build();
```

Com isso, o teste passa a comunicar a intencao de negocio. O setup deixa de ser uma lista longa de campos e vira uma frase fluida: "um pedido com cartao invalido", "um pedido com data expirada", "um pedido de alto valor".

## Test Smell: Hard-coded Dependencies

Hard-coded Dependencies aparecem quando o codigo fica preso a implementacoes concretas de banco, gateway ou servico externo, dificultando testes isolados e previsiveis.

No projeto atual ha dois pontos importantes:

- Em `src/server.js`, linhas 7 a 27, o arquivo declara `gatewayPagamentoMock`, `pedidoRepositoryMock`, `emailServiceMock` e instancia `CheckoutService` diretamente. Mesmo sendo mocks locais, a rota fica acoplada a essas instancias globais.
- Em `src/services/ResultadoPagamento.js`, linhas 27 a 37, 45 a 49 e 55 a 58, os objetos de resultado chamam diretamente `pedidoRepository.salvar()` e `emailService.enviarConfirmacao()`. Isso e correto do ponto de vista de injecao de dependencias, mas exige que os testes fornecam dublês bem controlados.

O risco do codigo legado era maior: pelos comentarios em `CheckoutService.js`, linhas 10 a 17, o metodo `processar()` concentrava decisao, gateway, banco e e-mail. Nessa forma, um teste de pagamento aprovado poderia acabar dependendo de um gateway real, de um banco real ou de um SMTP real. Isso torna a suite lenta, fragil e sujeita a falhas externas que nao tem relacao com a regra de negocio testada.

Tambem existe um detalhe de integracao relevante: `CheckoutService.processar()` retorna o resultado de `resultado.finalizar()`, que hoje tem formato `{ pedidoSalvo, httpStatus }`. Ja a rota em `src/server.js`, linhas 40 a 46, verifica `resultado.status === 'PROCESSADO'`. Essa diferenca de contrato e um bom exemplo de problema que mocks e testes de contrato ajudariam a revelar rapidamente.

### Como Mocks resolvem

Mocks permitem testar o Checkout sem chamar infraestrutura real:

- O gateway pode ser configurado para retornar `{ status: 'APROVADO' }`, `{ status: 'RECUSADO' }` ou lancar uma excecao de timeout.
- O repositorio pode ser um mock com `salvar: jest.fn().mockResolvedValue(...)`, permitindo verificar se o pedido foi persistido com `PROCESSADO`, `FALHOU` ou `ERRO_GATEWAY`.
- O servico de e-mail pode ser um mock com `enviarConfirmacao: jest.fn().mockResolvedValue(...)`, permitindo garantir que e-mail so e enviado no caminho feliz.
- O banco offline pode ser simulado com `pedidoRepository.salvar.mockRejectedValue(new Error('DB offline'))`, sem precisar derrubar um banco real.

Com Data Builder e Mocks juntos, os testes ficam menores, mais legiveis e deterministas. O builder resolve a criacao de dados. Os mocks resolvem o isolamento das dependencias externas. O resultado e uma suite capaz de validar os cenarios de negocio e resiliencia sem depender da disponibilidade de gateway, banco ou SMTP.

## Exemplo de teste mais limpo

```js
const { CheckoutService } = require('../../src/services/CheckoutService');
const { OrderBuilder } = require('../builders/OrderBuilder');

test('salva pedido processado e envia e-mail quando o pagamento e aprovado', async () => {
  const pedido = new OrderBuilder().build();
  const gatewayPagamento = {
    cobrar: jest.fn().mockResolvedValue({ status: 'APROVADO' }),
  };
  const pedidoRepository = {
    salvar: jest.fn().mockResolvedValue({ ...pedido, id: 123 }),
  };
  const emailService = {
    enviarConfirmacao: jest.fn().mockResolvedValue(),
  };

  const service = new CheckoutService(gatewayPagamento, pedidoRepository, emailService);

  await service.processar(pedido);

  expect(pedidoRepository.salvar).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'PROCESSADO' })
  );
  expect(emailService.enviarConfirmacao).toHaveBeenCalledWith(
    pedido.clienteEmail,
    'Pagamento Aprovado'
  );
});
```