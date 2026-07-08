#!/bin/bash
# Installateur Docker Compose pour le puller de supervision MaintenanceBoard

set -e

SERVER_URL="${SERVER_URL:-{{SERVER_URL}}}"
ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN:-{{ENROLLMENT_TOKEN}}}"
INSTALL_DIR="${INSTALL_DIR:-/opt/maintenanceboard-puller}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être exécuté en tant que root (sudo)."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker est requis. Installez Docker Engine puis relancez ce script."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 est requis (commande: docker compose)."
  exit 1
fi

mkdir -p "$INSTALL_DIR/config" "$INSTALL_DIR/logs"
chmod 700 "$INSTALL_DIR/config"

cat > "$INSTALL_DIR/config/puller.yml" <<EOF
server_url: "$SERVER_URL"
enrollment_token: "$ENROLLMENT_TOKEN"
interval_seconds: 300

inventory:
  enabled: true

harvests:
  # Exemple:
  # - name: "Portail ENT"
  #   equipment_name: "Serveur ENT"
  #   equipment_type: "Serveur"
  #   type: https
  #   url: "https://ent.example.local/"
  #   method: GET
  #   expected_status: 200
  #   timeout_seconds: 10
  #   insecure_skip_verify: false
EOF
chmod 600 "$INSTALL_DIR/config/puller.yml"

cat > "$INSTALL_DIR/Dockerfile" <<'EOF'
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash ca-certificates curl dmidecode iproute2 jq procps python3 python3-yaml \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
EOF

cat > "$INSTALL_DIR/entrypoint.sh" <<'EOF'
#!/bin/bash
set -e

SERVER_URL="${SERVER_URL%/}"
AGENT_SCRIPT="/usr/local/bin/maintenance-agent.sh"

if [ -z "$SERVER_URL" ] || [ -z "$ENROLLMENT_TOKEN" ]; then
  echo "SERVER_URL et ENROLLMENT_TOKEN sont requis."
  exit 1
fi

curl -sf "$SERVER_URL/downloads/agent.sh?enrollmentToken=$ENROLLMENT_TOKEN" -o "$AGENT_SCRIPT"
chmod +x "$AGENT_SCRIPT"
exec "$AGENT_SCRIPT"
EOF
chmod +x "$INSTALL_DIR/entrypoint.sh"

cat > "$INSTALL_DIR/docker-compose.yml" <<EOF
services:
  supervision-puller:
    build: .
    container_name: maintenanceboard-supervision-puller
    restart: unless-stopped
    environment:
      SERVER_URL: "$SERVER_URL"
      ENROLLMENT_TOKEN: "$ENROLLMENT_TOKEN"
    volumes:
      - ./config:/etc/maintenance-agent
      - ./logs:/var/log
    extra_hosts:
      - "host.docker.internal:host-gateway"
EOF

cd "$INSTALL_DIR"
docker compose up -d --build

echo ""
echo "=== Puller de supervision Docker déployé ==="
echo "  Dossier : $INSTALL_DIR"
echo "  Config  : $INSTALL_DIR/config/puller.yml"
echo "  Logs    : docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
