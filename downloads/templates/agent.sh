#!/bin/bash
# MaintenanceBoard Agent Linux
# Config : /etc/maintenance-agent/config.json

CONFIG_DIR="/etc/maintenance-agent"
CONFIG="$CONFIG_DIR/config.json"
TOKEN_FILE="$CONFIG_DIR/machine-token"
LOG_FILE="/var/log/maintenance-agent.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" | tee -a "$LOG_FILE"
}

if [ ! -f "$CONFIG" ]; then
  log "ERREUR : $CONFIG introuvable"
  exit 1
fi

# Vérifier que jq est disponible
if ! command -v jq &>/dev/null; then
  log "ERREUR : jq non installé (apt install jq)"
  exit 1
fi

SERVER_URL=$(jq -r '.serverUrl' "$CONFIG" | sed 's|/$||')
log "Agent démarré. Serveur : $SERVER_URL"

collect_and_send() {
  HOSTNAME=$(hostname)
  SERIAL=$(dmidecode -s system-serial-number 2>/dev/null | tr -d '[:space:]' || \
           cat /sys/class/dmi/id/product_serial 2>/dev/null | tr -d '[:space:]' || \
           echo "UNKNOWN")
  CPU=$(grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || echo "Unknown CPU")
  RAM_GB=$(awk '/MemTotal/ { printf "%.1f", $2/1024/1024 }' /proc/meminfo 2>/dev/null || echo "0")
  OS=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -s)
  OS_VER=$(uname -r)
  CURRENT_USER=$(who 2>/dev/null | awk '{print $1}' | head -1 || echo "")

  IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | head -10 | jq -R . | jq -sc . 2>/dev/null || echo "[]")

  TOKEN=$([ -f "$TOKEN_FILE" ] && cat "$TOKEN_FILE" | tr -d '[:space:]' || jq -r '.enrollmentToken' "$CONFIG")

  PAYLOAD=$(jq -n \
    --arg hostname "$HOSTNAME" \
    --arg serial "$SERIAL" \
    --arg cpu "$CPU" \
    --argjson ram "$RAM_GB" \
    --arg os "$OS" \
    --arg osVer "$OS_VER" \
    --arg user "$CURRENT_USER" \
    --argjson ips "$IPS" \
    '{
      hostname: $hostname,
      serialNumber: $serial,
      type: "PC",
      cpu: $cpu,
      ramGb: $ram,
      os: $os,
      osVersion: $osVer,
      user: $user,
      ips: $ips,
      macs: [],
      peripherals: []
    }')

  RESPONSE=$(curl -sf -X POST "$SERVER_URL/api/agents/checkin" \
    -H "X-Agent-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    --max-time 30 2>/dev/null)

  if [ $? -ne 0 ]; then
    log "Erreur connexion au serveur"
    return
  fi

  NEW_TOKEN=$(echo "$RESPONSE" | jq -r '.agentToken // empty' 2>/dev/null)
  if [ -n "$NEW_TOKEN" ]; then
    echo "$NEW_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    EQUIP_ID=$(echo "$RESPONSE" | jq -r '.equipmentId // empty' 2>/dev/null)
    log "Token machine enregistré (équipement $EQUIP_ID)"
  else
    EQUIP_ID=$(echo "$RESPONSE" | jq -r '.equipmentId // empty' 2>/dev/null)
    log "Check-in OK (équipement $EQUIP_ID)"
  fi
}

while true; do
  collect_and_send
  sleep 300
done
