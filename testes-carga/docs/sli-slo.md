# Definição de SLIs e SLOs — EntregasJá (Black Friday)

## Contexto
Documento formal de thresholds de qualidade de serviço para o microsserviço
de Checkout da plataforma EntregasJá, conforme especificação da Fase 4.

Os limites abaixo foram extraídos do documento de especificação de requisitos
(especificacao.md, Seção 5) e servem como critério de aprovação/reprovação
automático nos scripts k6.

---

## SLIs — Service Level Indicators
Métricas observadas em tempo real durante os testes de carga.

| SLI | Descrição |
|-----|-----------|
| Latência p95 | Tempo de resposta do percentil 95 das requisições ao /api/v1/checkout |
| Taxa de Erro | Percentual de requisições com status HTTP >= 400 |
| Taxa de Sucesso | Percentual de requisições com status HTTP 200 |
| Throughput | Requisições por segundo processadas com sucesso |

---

## SLOs — Service Level Objectives

| SLO | Threshold | Quando se aplica |
|-----|-----------|-----------------|
| SLO-01: Latência p95 | < 2500ms | Carga normal |
| SLO-02: Taxa de sucesso | > 95% | Carga normal |
| SLO-03: Taxa de erro | < 5% | Carga normal |
| SLO-04: Latência p95 (caos) | < 8000ms | Durante injeção de falhas via Toxiproxy |
| SLO-05: Taxa de sucesso (caos) | > 80% | Durante injeção de falhas via Toxiproxy |

> Durante a injeção de caos, os thresholds são relaxados intencionalmente.
> O objetivo não é manter performance nominal, mas provar Degradação Graciosa:
> o sistema deve continuar respondendo mesmo sob falhas, sem travar por completo.

---

## Cenários e SLOs Aplicáveis

| Cenário | Ferramenta | SLOs Avaliados |
|---------|-----------|----------------|
| Carga Normal (ramp-up/steady/down) | k6 | SLO-01, SLO-02, SLO-03 |
| Gateway Lento (5000ms de latência) | k6 + Toxiproxy | SLO-04, SLO-05 |
| Thundering Herd (flush de cache) | k6 + Toxiproxy | SLO-04, SLO-05 |

---

## Cálculo de MTTR (Mean Time to Recover)

O MTTR será calculado durante o experimento de Thundering Herd:

MTTR = T_recuperacao - T_injecao_caos

- T_injecao_caos: momento em que o Toxiproxy injeta o tóxico
- T_recuperacao: momento em que a taxa de sucesso volta a cruzar 80%

Meta: MTTR inferior a 30 segundos, graças ao Backoff com Jitter
implementado no CheckoutService._cobrar().
