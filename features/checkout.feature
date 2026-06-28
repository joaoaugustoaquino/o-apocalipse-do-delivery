# language: pt
Funcionalidade: Checkout de pedidos
  Como cliente da plataforma EntregasJa
  Quero finalizar uma compra pelo microsservico de Checkout
  Para receber a confirmacao do pedido quando o pagamento for aprovado
  E receber uma resposta clara quando houver falha de pagamento ou infraestrutura

  Contexto:
    Dado que existe um pedido de delivery com dados obrigatorios validos
    E o pedido esta com status "PENDENTE"

  Cenario: Compra realizada com sucesso
    Dado que o gateway de pagamento esta disponivel
    E o gateway aprovara a cobranca do cartao
    Quando o cliente solicitar o checkout do pedido
    Entao o sistema deve cobrar o valor do pedido no cartao informado
    E o pedido deve ser salvo com status "PROCESSADO"
    E o cliente deve receber uma resposta HTTP 200
    E a confirmacao de pagamento deve ser enviada para o e-mail do cliente

  Cenario: Falha por timeout do gateway de pagamento acima de 5 segundos
    Dado que o gateway de pagamento esta indisponivel por lentidao
    E o gateway demora mais de 5 segundos para responder a cobranca
    Quando o cliente solicitar o checkout do pedido
    Entao o sistema deve interromper a tentativa de cobranca por timeout
    E o pedido deve ser salvo com status "ERRO_GATEWAY"
    E o cliente deve receber uma resposta HTTP 500
    E a resposta deve orientar o cliente a tentar novamente mais tarde
    E nenhuma confirmacao de pagamento deve ser enviada

  Cenario: Falha por cartao recusado
    Dado que o gateway de pagamento esta disponivel
    E o gateway recusara a cobranca do cartao
    Quando o cliente solicitar o checkout do pedido
    Entao o sistema deve registrar a recusa do pagamento
    E o pedido deve ser salvo com status "FALHOU"
    E o cliente deve receber uma resposta HTTP 500
    E nenhuma confirmacao de pagamento deve ser enviada

  Cenario: Erro de infraestrutura com banco de dados offline
    Dado que o gateway de pagamento esta disponivel
    E o gateway aprovara a cobranca do cartao
    Mas o banco de dados de pedidos esta offline
    Quando o cliente solicitar o checkout do pedido
    Entao o sistema deve falhar de forma controlada
    E o cliente deve receber uma resposta HTTP 500
    E a resposta deve informar que nao foi possivel processar o pagamento naquele momento
    E nenhuma excecao nao tratada deve derrubar o microsservico de Checkout
