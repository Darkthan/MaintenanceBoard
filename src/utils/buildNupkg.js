/**
 * Construit un .nupkg valide au format OPC (Open Packaging Convention).
 * Chocolatey.Server exige [Content_Types].xml et _rels/.rels pour accepter le push.
 */
const JSZip = require('jszip');

const PACKAGE_ID = 'maintenance-agent';
const VERSION    = '1.0.0';

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels"  ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="nuspec" ContentType="application/octet-stream"/>
  <Default Extension="ps1"   ContentType="application/octet-stream"/>
  <Default Extension="json"  ContentType="application/octet-stream"/>
  <Default Extension="psmdcp" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>`;

function relsXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="R1" Type="http://schemas.microsoft.com/packaging/2010/07/manifest" Target="/${PACKAGE_ID}.nuspec"/>
</Relationships>`;
}

/**
 * @param {string} nuspecContent  - contenu du .nuspec déjà substitué
 * @param {string} agentPs1       - contenu de agent.ps1
 * @param {string} chocoInstall   - contenu de chocolateyInstall.ps1
 * @param {string} configJson     - contenu de config.json
 * @returns {Promise<Buffer>}
 */
async function buildNupkg(nuspecContent, agentPs1, chocoInstall, configJson) {
  const zip = new JSZip();

  // Fichiers OPC obligatoires
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', relsXml());

  // Nuspec à la racine
  zip.file(`${PACKAGE_ID}.nuspec`, nuspecContent);

  // Contenu du package
  zip.folder('tools').file('agent.ps1', agentPs1);
  zip.folder('tools').file('chocolateyInstall.ps1', chocoInstall);
  zip.folder('tools').file('config.json', configJson);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildNupkg, PACKAGE_ID, VERSION };
