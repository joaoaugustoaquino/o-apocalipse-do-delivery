# O Apocalipse do Delivery

Intrgrantes
* Felipe Augusto Moreira Corrêa
* João Augusto Aquino Campelo
* João Paulo Gobira Lopes Costa
* Júlia de Souza Ventura
* Rayssa Pierre da Silva Ramiro
  
Como as Fases se Conectam a este Código

**Fase 1**
Vocês calcularão a Complexidade Ciclomática do método processar(pedido). Notem que ele tem caminhos lógicos bem claros baseados no status do pagamento e no bloco catch.

**Fase 2**
O e-mail síncrono acoplado dentro do fluxo de aprovação é um erro clássico de design. Vocês devem usar a refatoração para extrair essa lógica e garantir via Mocks (no Jest) se o e-mail foi chamado adequadamente, ou usar Stubs para injetar respostas malformadas do gateway.

**Fase 4**
No arquivo server.js, a função gatewayPagamentoMock.cobrar simula uma promessa de 300ms. Quando vocês configurarem o Toxiproxy, vocês interceptarão essa chamada externa e forçarão uma latência de 5000ms. O k6 vai disparar requisições para /api/v1/checkout e o grupo deverá avaliar se o Express vai sofrer um colapso ou se o código de vocês (redesenhado com circuit breaker ou timeouts curtos) vai proteger o servidor.
