#!/bin/bash
TOXI_API="http://localhost:8474"

echo "=========================================="
echo " EXPERIMENTO 1: GATEWAY LENTO (+5000ms)"
echo "=========================================="
T1_INICIO=$(date +%s000)
echo "Timestamp de injecao (epoch ms): $T1_INICIO"
echo "Timestamp de injecao (legivel): $(date '+%H:%M:%S')"

curl -s -X POST "$TOXI_API/proxies/gateway-pagamento/toxics" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gateway-latencia",
    "type": "latency",
    "stream": "downstream",
    "toxicity": 1.0,
    "attributes": { "latency": 5000, "jitter": 500 }
  }'

echo ""
echo "Aguardando 60s para observar o impacto no k6..."
sleep 60

T1_FIM=$(date +%s000)
echo "Removendo toxico de latencia..."
curl -s -X DELETE "$TOXI_API/proxies/gateway-pagamento/toxics/gateway-latencia"
echo "Timestamp de remocao (epoch ms): $T1_FIM"
echo "Timestamp de remocao (legivel): $(date '+%H:%M:%S')"

echo ""
echo "Aguardando 30s para observar recuperacao..."
sleep 30

echo ""
echo "=========================================="
echo " EXPERIMENTO 2: THUNDERING HERD"
echo "=========================================="
T2_INICIO=$(date +%s000)
echo "Timestamp de injecao (epoch ms): $T2_INICIO"
echo "Timestamp de injecao (legivel): $(date '+%H:%M:%S')"

curl -s -X POST "$TOXI_API/proxies/cache-redis/toxics" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "cache-down",
    "type": "reset_peer",
    "stream": "downstream",
    "toxicity": 1.0,
    "attributes": {}
  }'

echo ""
echo "Disparando flush do cache via API..."
curl -s -X POST "http://localhost:3000/api/v1/cache/flush"

echo ""
echo "Aguardando 60s para observar o Thundering Herd..."
sleep 60

T2_FIM=$(date +%s000)
echo "Restaurando cache..."
curl -s -X DELETE "$TOXI_API/proxies/cache-redis/toxics/cache-down"
echo "Timestamp de remocao (epoch ms): $T2_FIM"
echo "Timestamp de remocao (legivel): $(date '+%H:%M:%S')"

echo ""
echo "=========================================="
echo "  RESUMO DOS TIMESTAMPS (para calculo do MTTR)"
echo "=========================================="
echo "  Experimento 1 - Gateway Lento:"
echo "    Injecao : $T1_INICIO"
echo "    Remocao : $T1_FIM"
echo ""
echo "  Experimento 2 - Thundering Herd:"
echo "    Injecao : $T2_INICIO"
echo "    Remocao : $T2_FIM"
echo "=========================================="
