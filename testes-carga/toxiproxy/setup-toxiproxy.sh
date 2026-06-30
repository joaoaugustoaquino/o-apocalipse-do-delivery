#!/bin/bash
# Configura os proxies no Toxiproxy.
# Execute depois de subir o container com docker compose up -d

TOXI_API="http://localhost:8474"

echo "Configurando proxy do gateway de pagamento..."
curl -s -X POST "$TOXI_API/proxies" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gateway-pagamento",
    "listen": "0.0.0.0:9090",
    "upstream": "host.docker.internal:3000",
    "enabled": true
  }'

echo ""
echo "Configurando proxy do cache..."
curl -s -X POST "$TOXI_API/proxies" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "cache-redis",
    "listen": "0.0.0.0:9091",
    "upstream": "host.docker.internal:3000",
    "enabled": true
  }'

echo ""
echo "Proxies configurados. Verifique em: $TOXI_API/proxies"
