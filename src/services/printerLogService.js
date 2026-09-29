const csv = require('csv-parser');
const { Readable } = require('stream');

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function requiredDate(value, line, label) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    throw invalid(`Ligne ${line} : ${label} invalide`);
  }
  // Le journal RISO n'indique aucun fuseau. On garde l'heure murale en UTC.
  const date = new Date(value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19).replace('T', ' ') !== value) {
    throw invalid(`Ligne ${line} : ${label} invalide`);
  }
  return date;
}

function optionalNumber(value, line, label) {
  if (value === '') return null;
  if (!/^\d+$/.test(value) || Number(value) > 2147483647) {
    throw invalid(`Ligne ${line} : ${label} doit être un entier positif`);
  }
  return Number(value);
}

function optional(value) { return value || null; }

// Certains anciens exports RISO contiennent des guillemets non échappés dans
// les noms de documents. Les rendre conformes au CSV sans modifier les valeurs.
function normalizeQuotes(content) {
  let output = '';
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < content.length;) {
    const char = content[i];
    if (char === '"' && (quoted || fieldStart)) {
      if (!quoted) {
        quoted = true;
        fieldStart = false;
        output += char;
        i++;
        continue;
      }
      let end = i;
      while (content[end] === '"') end++;
      const count = end - i;
      const boundary = end === content.length || [',', '\r', '\n'].includes(content[end]);
      if (boundary) {
        output += '"'.repeat(count % 2 === 0 ? count + 1 : count);
        quoted = false;
      } else {
        output += '"'.repeat(count % 2 === 0 ? count : count + 1);
      }
      i = end;
      continue;
    }
    output += char;
    if (!quoted && [',', '\r', '\n'].includes(char)) fieldStart = true;
    else fieldStart = false;
    i++;
  }
  return output;
}

async function parsePrinterLog(buffer) {
  if (!Buffer.isBuffer(buffer)) throw invalid('Fichier CSV manquant');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw invalid('Le fichier doit être encodé en UTF-8'); }
  let rows;
  try {
    rows = await new Promise((resolve, reject) => {
      const result = [];
      Readable.from([normalizeQuotes(content.replace(/^\uFEFF/, ''))]).pipe(csv({ headers: false, skipEmptyLines: true }))
        .on('data', row => result.push(Object.values(row).map(value => String(value ?? '').trim())))
        .on('end', () => resolve(result))
        .on('error', reject);
    });
  } catch {
    throw invalid('CSV illisible');
  }

  if (rows.length < 6 || rows[0][0] !== 'Discrimination code' || !['EA', 'CA'].includes(rows[1][0]) ||
      rows[2][0] !== 'MODEL' || rows[3][0] === '' || rows[4][0] !== 'Job kind') {
    throw invalid('Format de journal RISO non reconnu');
  }
  if (rows[1][2]?.toUpperCase() !== 'UTF-8') throw invalid('Encodage du journal non pris en charge');

  const metadata = Object.fromEntries(rows[2].map((key, index) => [key, rows[3][index] || '']));
  const serial = metadata.SERIAL;
  const name = metadata['PRINTER NAME'];
  if (!serial || !name) throw invalid("Nom ou numéro de série de l'imprimante absent");

  const headers = rows[4];
  const needed = ['Job kind', 'Job ID', 'Start job', 'Job status1', 'Owner name', 'Print count'];
  if (needed.some(header => !headers.includes(header))) throw invalid('Colonnes du journal RISO manquantes');

  const jobs = rows.slice(5).map((values, index) => {
    const line = index + 6;
    const get = key => values[headers.indexOf(key)] || '';
    const jobKind = get('Job kind');
    const jobId = get('Job ID');
    if (!['Copy', 'Print', 'Scan'].includes(jobKind) || !jobId || !get('Job status1')) {
      throw invalid(`Ligne ${line} : type, identifiant ou statut invalide`);
    }
    return {
      jobId, jobKind, jobName: optional(get('Job name')),
      ownerName: optional(get('Owner name')),
      startedAt: requiredDate(get('Start job'), line, 'Start job'),
      endedAt: get('End job') ? requiredDate(get('End job'), line, 'End job') : null,
      status: get('Job status1'), statusCode: optional(get('Job status2')),
      color: optional(get('Color')), duplex: optional(get('Duplex printing')),
      paperSize: optional(get('Output paper size')),
      originalPages: optionalNumber(get('Original pages'), line, 'Original pages'),
      printPages: optionalNumber(get('Print pages'), line, 'Print pages'),
      outputVolume: optionalNumber(get('Output volume'), line, 'Output volume'),
      printCount: optionalNumber(get('Print count'), line, 'Print count')
    };
  });
  const identities = new Set();
  for (const [index, job] of jobs.entries()) {
    const key = JSON.stringify([job.jobId, job.startedAt.toISOString()]);
    if (identities.has(key)) throw invalid(`Ligne ${index + 6} : opération en double dans le fichier`);
    identities.add(key);
  }
  return { printer: { serial, name, model: optional(metadata.MODEL) }, jobs };
}

module.exports = { parsePrinterLog };
