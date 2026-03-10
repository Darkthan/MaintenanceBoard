const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const config = require('../config');

const TEMPLATES_DIR = path.join(__dirname, '../../downloads/templates');
const VERSION = '1.0.0';

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

// ── GET /downloads/agent.ps1 ──────────────────────────────────────────────────
// Script agent brut (utilisé par l'installateur Linux pour le télécharger)
router.get('/agent.ps1', (req, res) => {
  const content = readTemplate('agent.ps1');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="agent.ps1"');
  res.send(content);
});

// ── GET /downloads/agent.sh ───────────────────────────────────────────────────
router.get('/agent.sh', (req, res) => {
  const content = readTemplate('agent.sh');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="agent.sh"');
  res.send(content);
});

// ── GET /downloads/maintenance-agent.service ──────────────────────────────────
router.get('/maintenance-agent.service', (req, res) => {
  const content = readTemplate('maintenance-agent.service');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="maintenance-agent.service"');
  res.send(content);
});

// ── GET /downloads/windows?enrollmentToken=<token> ────────────────────────────
// Génère un .nupkg (ZIP) avec JSZip si disponible, sinon ZIP basique Node
router.get('/windows', async (req, res, next) => {
  const { enrollmentToken } = req.query;
  if (!enrollmentToken) {
    return res.status(400).json({ error: 'enrollmentToken requis' });
  }

  try {
    const serverUrl = config.appUrl;
    const configJson = JSON.stringify({ serverUrl, enrollmentToken }, null, 2);
    const nuspecContent = readTemplate('agent.nuspec.template')
      .replace(/\{\{VERSION\}\}/g, VERSION)
      .replace(/\{\{SERVER_URL\}\}/g, serverUrl);
    const agentPs1 = readTemplate('agent.ps1');
    const chocoInstall = readTemplate('chocolateyInstall.ps1');

    // Essayer JSZip, sinon construire un ZIP manuel minimaliste
    let JSZip;
    try { JSZip = require('jszip'); } catch { JSZip = null; }

    if (JSZip) {
      const zip = new JSZip();
      zip.file('maintenance-agent.nuspec', nuspecContent);
      zip.folder('tools').file('agent.ps1', agentPs1);
      zip.folder('tools').file('chocolateyInstall.ps1', chocoInstall);
      zip.folder('tools').file('config.json', configJson);

      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="maintenance-agent.nupkg"');
      res.send(buffer);
    } else {
      // Fallback : envoyer config.json seul + instructions
      res.status(503).json({
        error: 'jszip non installé. Installez jszip (npm install jszip) pour générer le .nupkg.',
        hint: 'Utilisez /downloads/install.ps1 à la place (script PowerShell standalone).'
      });
    }
  } catch (err) { next(err); }
});

// ── GET /downloads/linux?enrollmentToken=<token> ─────────────────────────────
// Retourne install.sh avec variables injectées
router.get('/linux', (req, res, next) => {
  const { enrollmentToken } = req.query;
  if (!enrollmentToken) {
    return res.status(400).json({ error: 'enrollmentToken requis' });
  }

  try {
    const serverUrl = config.appUrl;
    const content = readTemplate('install.sh')
      .replace(/\{\{SERVER_URL\}\}/g, serverUrl)
      .replace(/\{\{ENROLLMENT_TOKEN\}\}/g, enrollmentToken);

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="install-maintenance-agent.sh"');
    res.send(content);
  } catch (err) { next(err); }
});

// ── GET /downloads/install.ps1?enrollmentToken=<token> ───────────────────────
// Script PowerShell standalone (sans choco) avec config inline
router.get('/install.ps1', (req, res, next) => {
  const { enrollmentToken } = req.query;
  if (!enrollmentToken) {
    return res.status(400).json({ error: 'enrollmentToken requis' });
  }

  try {
    const serverUrl = config.appUrl;
    const content = readTemplate('install.ps1.template')
      .replace(/\{\{SERVER_URL\}\}/g, serverUrl)
      .replace(/\{\{ENROLLMENT_TOKEN\}\}/g, enrollmentToken);

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="install-maintenance-agent.ps1"');
    res.send(content);
  } catch (err) { next(err); }
});

module.exports = router;
