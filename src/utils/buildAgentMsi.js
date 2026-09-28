const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);
const TEMPLATE = path.join(__dirname, '../../downloads/templates/maintenance-agent.msi');

async function buildAgentMsi(serverUrl, enrollmentToken) {
  const url = new URL(serverUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL du serveur invalide');
  if (!/^[A-Za-z0-9._-]{1,256}$/.test(enrollmentToken)) throw new Error("Jeton d'enrôlement invalide");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-msi-'));
  const output = path.join(directory, 'maintenance-agent.msi');
  try {
    await fs.copyFile(TEMPLATE, output);
    const sqlLiteral = value => `'${value.replace(/'/g, "''")}'`;
    const urlValue = url.toString().replace(/\/$/, '');
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'personalizeAgentMsi.ps1'), output, urlValue, enrollmentToken
      ], { timeout: 15000, maxBuffer: 1024 * 1024 });
    } else {
      await execFileAsync('msibuild', [output,
        '-q', `UPDATE Property SET Value=${sqlLiteral(urlValue)} WHERE Property='SERVERURL'`,
        '-q', `UPDATE Property SET Value=${sqlLiteral(enrollmentToken)} WHERE Property='ENROLLMENTTOKEN'`
      ], { timeout: 15000, maxBuffer: 1024 * 1024 });
    }
    return await fs.readFile(output);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { buildAgentMsi };
