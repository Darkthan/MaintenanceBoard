const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const XLSX = require('xlsx');

/**
 * Parse un fichier CSV ou Excel et retourne un tableau de lignes
 */
async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    return parseCsv(filePath);
  } else if (['.xlsx', '.xls'].includes(ext)) {
    return parseExcel(filePath);
  } else {
    throw new Error('Format de fichier non supporté. Utilisez CSV ou Excel (.xlsx, .xls)');
  }
}

function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv({ separator: ',', skipEmptyLines: true }))
      .on('data', (row) => {
        // Nettoyer les clés (trim, lowercase)
        const cleaned = {};
        for (const [k, v] of Object.entries(row)) {
          cleaned[k.trim()] = typeof v === 'string' ? v.trim() : v;
        }
        rows.push(cleaned);
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  // Nettoyer les clés
  return rows.map(row => {
    const cleaned = {};
    for (const [k, v] of Object.entries(row)) {
      cleaned[k.trim()] = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
    }
    return cleaned;
  });
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function parseOptionalDate(value) {
  const text = String(value || '').trim();
  if (!text) return { value: null, error: null };
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, error: `Date invalide '${text}'` };
  }
  return { value: parsed, error: null };
}

function parseOptionalNumber(value, label) {
  const text = String(value || '').trim();
  if (!text) return { value: null, error: null };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return { value: null, error: `Le champ '${label}' doit être numérique` };
  }
  return { value: parsed, error: null };
}

function parseOptionalBoolean(value, label) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return { value: null, error: null };
  if (['true', '1', 'yes', 'oui'].includes(text)) return { value: true, error: null };
  if (['false', '0', 'no', 'non'].includes(text)) return { value: false, error: null };
  return { value: null, error: `Le champ '${label}' doit être vrai/faux` };
}

function parseStringArray(value) {
  const text = String(value || '').trim();
  if (!text) return { value: [], error: null };

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return {
        value: parsed.map(item => String(item || '').trim()).filter(Boolean),
        error: null
      };
    }
  } catch {}

  return {
    value: text
      .split(/[|;\n,]/)
      .map(item => item.trim())
      .filter(Boolean),
    error: null
  };
}

function parseDisks(value) {
  const text = String(value || '').trim();
  if (!text) return { value: [], error: null };

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return { value: null, error: "Le champ 'agentDisks' doit être un tableau JSON" };
    }
    return {
      value: parsed.map(disk => ({
        mount: typeof disk?.mount === 'string' ? disk.mount.trim() : undefined,
        label: typeof disk?.label === 'string' ? disk.label.trim() : undefined,
        filesystem: typeof disk?.filesystem === 'string' ? disk.filesystem.trim() : undefined,
        totalGb: Number.isFinite(Number(disk?.totalGb)) ? Number(disk.totalGb) : undefined,
        freeGb: Number.isFinite(Number(disk?.freeGb)) ? Number(disk.freeGb) : undefined,
        usedPercent: Number.isFinite(Number(disk?.usedPercent)) ? Number(disk.usedPercent) : undefined
      })),
      error: null
    };
  } catch {
    return { value: null, error: "Le champ 'agentDisks' doit être un JSON valide" };
  }
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'string') return value.trim() !== '';
      return true;
    })
  );
}

/**
 * Valide et transforme une ligne de données pour une salle
 */
function validateRoomRow(row, index) {
  const errors = [];
  const rowNum = index + 2; // +2 car index 0-based + header

  if (!row.name?.trim()) {
    errors.push(`Ligne ${rowNum}: Le champ 'name' est obligatoire`);
  }

  const floor = row.floor !== '' && row.floor !== undefined
    ? parseInt(row.floor)
    : null;

  if (row.floor !== '' && row.floor !== undefined && isNaN(floor)) {
    errors.push(`Ligne ${rowNum}: Le champ 'floor' doit être un nombre`);
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? {
      name: row.name?.trim(),
      building: row.building?.trim() || null,
      floor: floor,
      number: row.number?.trim() || null,
      description: row.description?.trim() || null
    } : null
  };
}

/**
 * Valide et transforme une ligne de données pour un équipement
 */
function validateEquipmentRow(row, index) {
  const errors = [];
  const rowNum = index + 2;
  const discoverySource = firstNonEmpty(row.discoverySource, row.discovery_source).toUpperCase() || 'MANUAL';
  const discoveryStatusDefault = discoverySource === 'AGENT' ? 'PENDING' : 'CONFIRMED';
  const discoveryStatus = firstNonEmpty(row.discoveryStatus, row.discovery_status).toUpperCase() || discoveryStatusDefault;

  const name = firstNonEmpty(row.name, row.hostname, row.agentHostname, row.agent_hostname);
  if (!name) {
    errors.push(`Ligne ${rowNum}: Le champ 'name' est obligatoire`);
  }

  const type = firstNonEmpty(row.type, row.agentType, row.agent_type) || (discoverySource === 'AGENT' ? 'PC' : '');
  if (!type) {
    errors.push(`Ligne ${rowNum}: Le champ 'type' est obligatoire`);
  }

  const validStatuses = ['ACTIVE', 'INACTIVE', 'REPAIR', 'DECOMMISSIONED'];
  const status = firstNonEmpty(row.status).toUpperCase() || 'ACTIVE';
  if (!validStatuses.includes(status)) {
    errors.push(`Ligne ${rowNum}: Statut invalide '${row.status}'. Valeurs acceptées : ${validStatuses.join(', ')}`);
  }

  const validDiscoverySources = ['MANUAL', 'AGENT'];
  if (!validDiscoverySources.includes(discoverySource)) {
    errors.push(`Ligne ${rowNum}: discoverySource invalide '${row.discoverySource}'. Valeurs acceptées : ${validDiscoverySources.join(', ')}`);
  }

  const validDiscoveryStatuses = ['CONFIRMED', 'PENDING'];
  if (!validDiscoveryStatuses.includes(discoveryStatus)) {
    errors.push(`Ligne ${rowNum}: discoveryStatus invalide '${row.discoveryStatus}'. Valeurs acceptées : ${validDiscoveryStatuses.join(', ')}`);
  }

  const lastSeenAt = parseOptionalDate(firstNonEmpty(row.lastSeenAt, row.last_seen_at));
  if (lastSeenAt.error) {
    errors.push(`Ligne ${rowNum}: ${lastSeenAt.error}`);
  }

  const ramGb = parseOptionalNumber(firstNonEmpty(row.agentRamGb, row.agent_ram_gb, row.ramGb, row.ram_gb), 'agentRamGb');
  if (ramGb.error) {
    errors.push(`Ligne ${rowNum}: ${ramGb.error}`);
  }

  const agentRevoked = parseOptionalBoolean(firstNonEmpty(row.agentRevoked, row.agent_revoked), 'agentRevoked');
  if (agentRevoked.error) {
    errors.push(`Ligne ${rowNum}: ${agentRevoked.error}`);
  }

  const ips = parseStringArray(firstNonEmpty(row.agentIps, row.agent_ips, row.ips));
  const macs = parseStringArray(firstNonEmpty(row.agentMacs, row.agent_macs, row.macs));
  const peripherals = parseStringArray(firstNonEmpty(row.agentPeripherals, row.agent_peripherals, row.peripherals));
  const disks = parseDisks(firstNonEmpty(row.agentDisks, row.agent_disks, row.disks));
  if (disks.error) {
    errors.push(`Ligne ${rowNum}: ${disks.error}`);
  }

  let rawAgentInfo = null;
  const agentInfoField = firstNonEmpty(row.agentInfo, row.agent_info);
  if (agentInfoField) {
    try {
      rawAgentInfo = JSON.parse(agentInfoField);
    } catch {
      errors.push(`Ligne ${rowNum}: Le champ 'agentInfo' doit contenir un JSON valide`);
    }
  }

  const builtAgentInfo = compactObject({
    manufacturer: firstNonEmpty(row.agentManufacturer, row.agent_manufacturer, row.manufacturer, row.brand),
    model: firstNonEmpty(row.agentModel, row.agent_model, row.model),
    cpu: firstNonEmpty(row.agentCpu, row.agent_cpu, row.cpu),
    ramGb: ramGb.value,
    os: firstNonEmpty(row.agentOs, row.agent_os, row.os),
    osVersion: firstNonEmpty(row.agentOsVersion, row.agent_os_version, row.osVersion, row.os_version),
    user: firstNonEmpty(row.agentUser, row.agent_user, row.user),
    ips: ips.value,
    macs: macs.value,
    peripherals: peripherals.value,
    disks: disks.value
  });

  const finalAgentInfo = rawAgentInfo && typeof rawAgentInfo === 'object' && !Array.isArray(rawAgentInfo)
    ? rawAgentInfo
    : builtAgentInfo;
  const serializedAgentInfo = Object.keys(compactObject(finalAgentInfo || {})).length
    ? JSON.stringify(compactObject(finalAgentInfo))
    : null;

  if (serializedAgentInfo && serializedAgentInfo.length > 10240) {
    errors.push(`Ligne ${rowNum}: agentInfo trop volumineux (max 10 Ko)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? {
      name,
      type,
      brand: firstNonEmpty(row.brand, row.manufacturer, row.agentManufacturer, row.agent_manufacturer) || null,
      model: firstNonEmpty(row.model, row.agentModel, row.agent_model) || null,
      serialNumber: firstNonEmpty(row.serialNumber, row.serial_number) || null,
      status: status,
      description: firstNonEmpty(row.description) || null,
      roomNumber: firstNonEmpty(row.roomNumber, row.room_number) || null,
      suggestedRoomNumber: firstNonEmpty(row.suggestedRoomNumber, row.suggested_room_number) || null,
      discoverySource,
      discoveryStatus,
      agentHostname: firstNonEmpty(row.agentHostname, row.agent_hostname, row.hostname) || null,
      lastSeenAt: lastSeenAt.value,
      agentInfo: serializedAgentInfo,
      agentRevoked: agentRevoked.value ?? false
    } : null
  };
}

/**
 * Nettoie les fichiers d'import temporaires
 */
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn('Impossible de supprimer le fichier temporaire:', filePath, err.message);
  }
}

module.exports = { parseFile, validateRoomRow, validateEquipmentRow, cleanupFile };
