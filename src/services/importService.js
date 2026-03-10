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

  if (!row.name?.trim()) {
    errors.push(`Ligne ${rowNum}: Le champ 'name' est obligatoire`);
  }
  if (!row.type?.trim()) {
    errors.push(`Ligne ${rowNum}: Le champ 'type' est obligatoire`);
  }

  const validStatuses = ['ACTIVE', 'INACTIVE', 'REPAIR', 'DECOMMISSIONED'];
  const status = row.status?.trim().toUpperCase() || 'ACTIVE';
  if (!validStatuses.includes(status)) {
    errors.push(`Ligne ${rowNum}: Statut invalide '${row.status}'. Valeurs acceptées : ${validStatuses.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? {
      name: row.name?.trim(),
      type: row.type?.trim(),
      brand: row.brand?.trim() || null,
      model: row.model?.trim() || null,
      serialNumber: row.serialNumber?.trim() || row.serial_number?.trim() || null,
      status: status,
      description: row.description?.trim() || null,
      roomNumber: row.roomNumber?.trim() || row.room_number?.trim() || null
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
