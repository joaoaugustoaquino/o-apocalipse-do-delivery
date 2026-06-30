#!/bin/bash
# Injeta caos no Toxiproxy enquanto o k6 está rodando.
# Execute em um terceiro terminal, enquanto o k6 estiver ativo.

TOXI_API="http://localhost:8474"

echo "=========================================="
echo " EXPERIMENTO 1: GATEWAY LENTO (+5000ms)"
echo "=========================================="
echo "Timestamp de injecao: $(date '+%H:%M:%S')"

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

echo "Removendo toxico de latencia..."
curl -s -X DELETE "$TOXI_API/proxies/gateway-pagamento/toxics/gateway-latencia"
echo "Timestamp de recuperacao: $(date '+%H:%M:%S')"

echo ""
echo "Aguardando 30s para observar recuperacao (MTTR)..."
sleep 30

echo ""
echo "=========================================="
echo " EXPERIMENTO 2: THUNDERING HERD"
echo "=========================================="
echo "Timestamp de injecao: $(date '+%H:%M:%S')"

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

echo "Restaurando cache..."
curl -s -X DELETE "$TOXI_API/proxies/cache-redis/toxics/cache-down"
echo "Timestamp de recuperacao: $(date '+%H:%M:%S')"

echo ""
echo "Experimentos concluidos!"
