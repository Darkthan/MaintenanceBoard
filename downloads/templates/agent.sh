#!/bin/bash
# MaintenanceBoard HTTPS Puller Linux
# Config : /etc/maintenance-agent/puller.yml

CONFIG_DIR="/etc/maintenance-agent"
CONFIG="$CONFIG_DIR/puller.yml"
TOKEN_FILE="$CONFIG_DIR/machine-token"
LOG_FILE="/var/log/maintenance-agent.log"
CONFIG_JSON=""

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" | tee -a "$LOG_FILE"
}

if [ ! -f "$CONFIG" ]; then
  log "ERREUR : $CONFIG introuvable"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  log "ERREUR : jq non installé (apt install jq)"
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  log "ERREUR : python3 non installé"
  exit 1
fi

load_config() {
  CONFIG_JSON=$(python3 - "$CONFIG" <<'PY'
import json
import sys

try:
    import yaml
except Exception:
    print("PyYAML manquant: installer python3-yaml", file=sys.stderr)
    sys.exit(2)

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = yaml.safe_load(handle) or {}

print(json.dumps(data))
PY
)
}

load_config || {
  log "ERREUR : YAML invalide ou python3-yaml manquant"
  exit 1
}

SERVER_URL=$(echo "$CONFIG_JSON" | jq -r '.server_url // .serverUrl // empty' | sed 's|/$||')
if [ -z "$SERVER_URL" ]; then
  log "ERREUR : server_url manquant dans $CONFIG"
  exit 1
fi

log "Puller démarré. Serveur : $SERVER_URL"

collect_https_harvests() {
  local count
  count=$(echo "$CONFIG_JSON" | jq '.harvests // [] | length')
  if [ "$count" -eq 0 ]; then
    echo "[]"
    return
  fi

  local results="[]"
  local index=0
  while [ "$index" -lt "$count" ]; do
    local item name equipment_name equipment_type type url method timeout expected insecure start end curl_out http_code latency status message checked_at result
    item=$(echo "$CONFIG_JSON" | jq -c ".harvests[$index]")
    name=$(echo "$item" | jq -r '.name // "Récolte HTTPS"')
    equipment_name=$(echo "$item" | jq -r '.equipment_name // .equipmentName // empty')
    equipment_type=$(echo "$item" | jq -r '.equipment_type // .equipmentType // empty')
    type=$(echo "$item" | jq -r '.type // "https"' | tr '[:lower:]' '[:upper:]')
    url=$(echo "$item" | jq -r '.url // .target // empty')
    method=$(echo "$item" | jq -r '.method // "GET"')
    timeout=$(echo "$item" | jq -r '.timeout_seconds // .timeout // 10')
    expected=$(echo "$item" | jq -r '.expected_status // 200')
    insecure=$(echo "$item" | jq -r '.insecure_skip_verify // false')
    checked_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    if [ "$type" != "HTTPS" ] && [ "$type" != "HTTP" ]; then
      message="Type de récolte non supporté par ce puller"
      result=$(jq -n --arg name "$name" --arg equipmentName "$equipment_name" --arg equipmentType "$equipment_type" --arg type "$type" --arg target "$url" --arg checkedAt "$checked_at" --arg message "$message" \
        '{name:$name,equipmentName:$equipmentName,equipmentType:$equipmentType,type:$type,target:$target,status:"DOWN",checkedAt:$checkedAt,message:$message}')
      results=$(echo "$results" | jq --argjson result "$result" '. + [$result]')
      index=$((index + 1))
      continue
    fi

    if [ -z "$url" ]; then
      message="URL manquante"
      result=$(jq -n --arg name "$name" --arg equipmentName "$equipment_name" --arg equipmentType "$equipment_type" --arg type "$type" --arg checkedAt "$checked_at" --arg message "$message" \
        '{name:$name,equipmentName:$equipmentName,equipmentType:$equipmentType,type:$type,status:"DOWN",checkedAt:$checkedAt,message:$message}')
      results=$(echo "$results" | jq --argjson result "$result" '. + [$result]')
      index=$((index + 1))
      continue
    fi

    start=$(date +%s%3N)
    if [ "$insecure" = "true" ]; then
      curl_out=$(curl -k -sS -o /dev/null -w '%{http_code}' -X "$method" --max-time "$timeout" "$url" 2>&1)
    else
      curl_out=$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" --max-time "$timeout" "$url" 2>&1)
    fi
    curl_status=$?
    end=$(date +%s%3N)
    latency=$((end - start))

    if [ "$curl_status" -eq 0 ]; then
      http_code="$curl_out"
      if [ "$http_code" = "$expected" ]; then
        status="UP"
        message="OK"
      else
        status="DOWN"
        message="HTTP $http_code attendu $expected"
      fi
    else
      http_code=0
      status="DOWN"
      message=$(echo "$curl_out" | tail -1 | cut -c1-500)
    fi

    result=$(jq -n \
      --arg name "$name" \
      --arg equipmentName "$equipment_name" \
      --arg equipmentType "$equipment_type" \
      --arg type "$type" \
      --arg target "$url" \
      --arg status "$status" \
      --arg checkedAt "$checked_at" \
      --arg message "$message" \
      --argjson httpStatus "$http_code" \
      --argjson latencyMs "$latency" \
      '{name:$name,equipmentName:$equipmentName,equipmentType:$equipmentType,type:$type,target:$target,status:$status,httpStatus:$httpStatus,latencyMs:$latencyMs,checkedAt:$checkedAt,message:$message}')
    results=$(echo "$results" | jq --argjson result "$result" '. + [$result]')
    index=$((index + 1))
  done

  echo "$results"
}

collect_and_send() {
  load_config || {
    log "ERREUR : impossible de relire $CONFIG"
    return
  }

  HOSTNAME=$(hostname)
  SERIAL=$(dmidecode -s system-serial-number 2>/dev/null | tr -d '[:space:]' || \
           cat /sys/class/dmi/id/product_serial 2>/dev/null | tr -d '[:space:]' || \
           echo "UNKNOWN")
  CPU=$(grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || echo "Unknown CPU")
  RAM_GB=$(awk '/MemTotal/ { printf "%.1f", $2/1024/1024 }' /proc/meminfo 2>/dev/null || echo "0")
  OS=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -s)
  OS_VER=$(uname -r)
  MANUFACTURER=$(dmidecode -s system-manufacturer 2>/dev/null | head -1 | xargs || cat /sys/class/dmi/id/sys_vendor 2>/dev/null | head -1 | xargs || echo "")
  MODEL=$(dmidecode -s system-product-name 2>/dev/null | head -1 | xargs || cat /sys/class/dmi/id/product_name 2>/dev/null | head -1 | xargs || echo "")
  CURRENT_USER=$(who 2>/dev/null | awk '{print $1}' | head -1 || echo "")

  IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | head -10 | jq -R . | jq -sc . 2>/dev/null || echo "[]")
  DISKS=$(df -Pk -x tmpfs -x devtmpfs 2>/dev/null | awk 'NR>1 {print}' | jq -R -s '
    split("\n")
    | map(select(length > 0))
    | map(split(" ") | map(select(length > 0)))
    | map({
        filesystem: .[0],
        totalGb: ((.[1] | tonumber) / 1024 / 1024 | . * 10 | round / 10),
        usedPercent: (.[4] | sub("%$"; "") | tonumber),
        mount: .[5],
        freeGb: ((.[3] | tonumber) / 1024 / 1024 | . * 10 | round / 10)
      })
  ' 2>/dev/null || echo "[]")

  HARVESTS=$(collect_https_harvests)
  TOKEN=$([ -f "$TOKEN_FILE" ] && cat "$TOKEN_FILE" | tr -d '[:space:]' || echo "$CONFIG_JSON" | jq -r '.enrollment_token // .enrollmentToken // empty')

  PAYLOAD=$(jq -n \
    --arg hostname "$HOSTNAME" \
    --arg serial "$SERIAL" \
    --arg manufacturer "$MANUFACTURER" \
    --arg model "$MODEL" \
    --arg cpu "$CPU" \
    --argjson ram "$RAM_GB" \
    --arg os "$OS" \
    --arg osVer "$OS_VER" \
    --arg user "$CURRENT_USER" \
    --argjson ips "$IPS" \
    --argjson disks "$DISKS" \
    --argjson harvests "$HARVESTS" \
    '{
      hostname: $hostname,
      serialNumber: $serial,
      type: "PC",
      manufacturer: $manufacturer,
      model: $model,
      cpu: $cpu,
      ramGb: $ram,
      os: $os,
      osVersion: $osVer,
      user: $user,
      ips: $ips,
      disks: $disks,
      harvests: $harvests,
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
    FAILED=$(echo "$HARVESTS" | jq '[.[] | select(.status == "DOWN")] | length')
    log "Check-in OK (équipement $EQUIP_ID, récoltes en échec: $FAILED)"
  fi
}

while true; do
  collect_and_send
  INTERVAL=$(echo "$CONFIG_JSON" | jq -r '.interval_seconds // .interval // 300')
  sleep "$INTERVAL"
done
