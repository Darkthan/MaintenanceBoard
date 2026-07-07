#!/bin/bash
# Installateur MaintenanceBoard HTTPS Puller (Linux)
# Usage : bash install.sh <SERVER_URL> <ENROLLMENT_TOKEN>
# Ou injecter les variables via le serveur (téléchargement dynamique)

set -e

SERVER_URL="${SERVER_URL:-{{SERVER_URL}}}"
ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN:-{{ENROLLMENT_TOKEN}}}"
CONFIG_DIR="/etc/maintenance-agent"
SERVICE_FILE="/etc/systemd/system/maintenance-agent.service"
AGENT_SCRIPT="$CONFIG_DIR/agent.sh"
CONFIG_FILE="$CONFIG_DIR/puller.yml"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être exécuté en tant que root (sudo)."
  exit 1
fi

echo "=== Installation de MaintenanceBoard HTTPS Puller ==="
echo "  Serveur       : $SERVER_URL"
echo "  Répertoire    : $CONFIG_DIR"

# Dépendances
for dep in curl jq bash dmidecode python3; do
  if ! command -v "$dep" &>/dev/null; then
    echo "Installation de $dep..."
    apt-get install -y "$dep" 2>/dev/null || yum install -y "$dep" 2>/dev/null || true
  fi
done

python3 - <<'PY' >/dev/null 2>&1 || {
import yaml
PY
  echo "Installation de python3-yaml..."
  apt-get install -y python3-yaml 2>/dev/null || yum install -y python3-pyyaml 2>/dev/null || true
}

# Créer répertoire de config
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

# Écrire la configuration YAML du puller.
# Les récoltes se configurent localement ici, puis le service les pousse en HTTPS.
cat > "$CONFIG_FILE" <<EOF
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
chmod 600 "$CONFIG_FILE"

# Télécharger le script agent
curl -sf "$SERVER_URL/downloads/agent.sh?enrollmentToken=$ENROLLMENT_TOKEN" -o "$AGENT_SCRIPT" \
  || { echo "Impossible de télécharger agent.sh, utilisation locale..."; cp "$(dirname "$0")/agent.sh" "$AGENT_SCRIPT" 2>/dev/null || true; }
chmod +x "$AGENT_SCRIPT"

# Installer le service systemd
curl -sf "$SERVER_URL/downloads/maintenance-agent.service?enrollmentToken=$ENROLLMENT_TOKEN" -o "$SERVICE_FILE" \
  || cp "$(dirname "$0")/maintenance-agent.service" "$SERVICE_FILE" 2>/dev/null || cat > "$SERVICE_FILE" <<'SVCEOF'
[Unit]
Description=MaintenanceBoard HTTPS Puller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash /etc/maintenance-agent/agent.sh
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=maintenance-agent

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable maintenance-agent
systemctl restart maintenance-agent

echo ""
echo "=== Installation terminée ==="
echo "  Statut : $(systemctl is-active maintenance-agent)"
echo "  Config : $CONFIG_FILE"
echo "  Logs   : journalctl -u maintenance-agent -f"
