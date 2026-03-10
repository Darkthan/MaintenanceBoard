#!/bin/bash
# Installateur MaintenanceBoard Agent (Linux)
# Usage : bash install.sh <SERVER_URL> <ENROLLMENT_TOKEN>
# Ou injecter les variables via le serveur (téléchargement dynamique)

set -e

SERVER_URL="${SERVER_URL:-{{SERVER_URL}}}"
ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN:-{{ENROLLMENT_TOKEN}}}"
CONFIG_DIR="/etc/maintenance-agent"
SERVICE_FILE="/etc/systemd/system/maintenance-agent.service"
AGENT_SCRIPT="$CONFIG_DIR/agent.sh"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être exécuté en tant que root (sudo)."
  exit 1
fi

echo "=== Installation de MaintenanceBoard Agent ==="
echo "  Serveur       : $SERVER_URL"
echo "  Répertoire    : $CONFIG_DIR"

# Dépendances
for dep in curl jq bash dmidecode; do
  if ! command -v "$dep" &>/dev/null; then
    echo "Installation de $dep..."
    apt-get install -y "$dep" 2>/dev/null || yum install -y "$dep" 2>/dev/null || true
  fi
done

# Créer répertoire de config
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

# Écrire config.json
cat > "$CONFIG_DIR/config.json" <<EOF
{
  "serverUrl": "$SERVER_URL",
  "enrollmentToken": "$ENROLLMENT_TOKEN"
}
EOF
chmod 600 "$CONFIG_DIR/config.json"

# Télécharger le script agent
curl -sf "$SERVER_URL/downloads/agent.sh" -o "$AGENT_SCRIPT" \
  || { echo "Impossible de télécharger agent.sh, utilisation locale..."; cp "$(dirname "$0")/agent.sh" "$AGENT_SCRIPT" 2>/dev/null || true; }
chmod +x "$AGENT_SCRIPT"

# Installer le service systemd
curl -sf "$SERVER_URL/downloads/maintenance-agent.service" -o "$SERVICE_FILE" \
  || cp "$(dirname "$0")/maintenance-agent.service" "$SERVICE_FILE" 2>/dev/null || cat > "$SERVICE_FILE" <<'SVCEOF'
[Unit]
Description=MaintenanceBoard Inventory Agent
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
echo "  Logs   : journalctl -u maintenance-agent -f"
