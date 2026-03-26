/**
 * Flux NuGet v2 minimal pour Chocolatey
 * URL source : /api/nuget/:enrollmentToken
 * Usage : choco source add -n="MaintenanceBoard" -s="https://server/api/nuget/TOKEN"
 *         choco install maintenance-agent -y
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const prisma = require('../lib/prisma');
const config = require('../config');

const TEMPLATES_DIR = path.join(__dirname, '../../downloads/templates');
const PACKAGE_ID = 'maintenance-agent';
const VERSION = '1.0.0';

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

async function validateToken(token) {
  if (!token) return false;
  const record = await prisma.agentToken.findUnique({ where: { token } });
  return !!(record && record.isActive);
}

function feedBase(token) {
  return `${config.appUrl}/api/nuget/${encodeURIComponent(token)}`;
}

function buildEntry(base) {
  const downloadUrl = `${base}/package/${PACKAGE_ID}/${VERSION}`;
  const now = new Date().toISOString();
  return `<entry>
    <id>${base}/Packages(Id='${PACKAGE_ID}',Version='${VERSION}')</id>
    <category term="NuGet.Server.DataServices.ODataPackage" scheme="http://schemas.microsoft.com/ado/2007/08/dataservices/scheme"/>
    <link rel="edit" title="ODataPackage" href="Packages(Id='${PACKAGE_ID}',Version='${VERSION}')"/>
    <title type="text">${PACKAGE_ID}</title>
    <summary type="text">MaintenanceBoard Agent</summary>
    <updated>${now}</updated>
    <author><name>MaintenanceBoard</name></author>
    <content type="application/zip" src="${downloadUrl}"/>
    <m:properties>
      <d:Id>${PACKAGE_ID}</d:Id>
      <d:Version>${VERSION}</d:Version>
      <d:NormalizedVersion>${VERSION}</d:NormalizedVersion>
      <d:Title>MaintenanceBoard Agent</d:Title>
      <d:Description>MaintenanceBoard inventory agent. Server: ${config.appUrl}</d:Description>
      <d:Tags>maintenance inventory agent</d:Tags>
      <d:Authors>MaintenanceBoard</d:Authors>
      <d:IsLatestVersion m:type="Edm.Boolean">true</d:IsLatestVersion>
      <d:IsAbsoluteLatestVersion m:type="Edm.Boolean">true</d:IsAbsoluteLatestVersion>
      <d:IsPrerelease m:type="Edm.Boolean">false</d:IsPrerelease>
      <d:RequireLicenseAcceptance m:type="Edm.Boolean">false</d:RequireLicenseAcceptance>
      <d:DownloadCount m:type="Edm.Int32">0</d:DownloadCount>
      <d:VersionDownloadCount m:type="Edm.Int32">0</d:VersionDownloadCount>
      <d:PackageSize m:type="Edm.Int64">0</d:PackageSize>
      <d:PackageHash></d:PackageHash>
      <d:PackageHashAlgorithm>SHA512</d:PackageHashAlgorithm>
      <d:Published m:type="Edm.DateTime">${now}</d:Published>
      <d:LastUpdated m:type="Edm.DateTime">${now}</d:LastUpdated>
      <d:Dependencies></d:Dependencies>
      <d:ProjectUrl>${config.appUrl}</d:ProjectUrl>
    </m:properties>
  </entry>`;
}

function atomFeed(base, title, includeEntry) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xml:base="${base}/" xmlns="http://www.w3.org/2005/Atom"
  xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
  xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <id>${base}/${title}</id>
  <title type="text">${title}</title>
  <updated>${now}</updated>
  <link rel="self" title="${title}" href="${base}/${title}"/>
  ${includeEntry ? buildEntry(base) : ''}
</feed>`;
}

// ── Route principale : /:token et /:token/* ───────────────────────────────────
// On utilise un seul handler catch-all pour éviter les problèmes avec les
// parenthèses dans les paths OData (FindPackagesById(), Search(), Packages())
// qui sont interprétées comme des groupes regex par path-to-regexp (Express 5).

router.all('/:token', handleNuget);
router.all('/:token/*path', handleNuget);

async function handleNuget(req, res, next) {
  try {
    const token = req.params.token;
    if (!await validateToken(token)) {
      return res.status(403).send('Token enrollment invalide ou desactive');
    }

    const base = feedBase(token);
    // Sous-chemin après /:token/
    const sub = (req.params.path || '').replace(/^\/+/, '');

    // ── Racine du service OData ───────────────────────────────────────────────
    if (!sub) {
      res.set('Content-Type', 'application/atomsvc+xml; charset=utf-8');
      return res.send(`<?xml version="1.0" encoding="utf-8"?>
<service xml:base="${base}/" xmlns="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <workspace>
    <atom:title type="text">Default</atom:title>
    <collection href="Packages">
      <atom:title type="text">Packages</atom:title>
    </collection>
  </workspace>
</service>`);
    }

    // ── $metadata ─────────────────────────────────────────────────────────────
    if (sub === '$metadata') {
      res.set('Content-Type', 'application/xml; charset=utf-8');
      return res.send(`<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices m:DataServiceVersion="2.0"
    xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <Schema Namespace="NuGet.Server.DataServices"
      xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
      xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"
      xmlns="http://schemas.microsoft.com/ado/2006/04/edm">
      <EntityType Name="ODataPackage" m:HasStream="true">
        <Key><PropertyRef Name="Id"/><PropertyRef Name="Version"/></Key>
        <Property Name="Id" Type="Edm.String" Nullable="false"/>
        <Property Name="Version" Type="Edm.String" Nullable="false"/>
        <Property Name="NormalizedVersion" Type="Edm.String"/>
        <Property Name="Title" Type="Edm.String"/>
        <Property Name="Description" Type="Edm.String"/>
        <Property Name="Authors" Type="Edm.String"/>
        <Property Name="Tags" Type="Edm.String"/>
        <Property Name="ProjectUrl" Type="Edm.String"/>
        <Property Name="IsLatestVersion" Type="Edm.Boolean" Nullable="false"/>
        <Property Name="IsAbsoluteLatestVersion" Type="Edm.Boolean" Nullable="false"/>
        <Property Name="IsPrerelease" Type="Edm.Boolean" Nullable="false"/>
        <Property Name="RequireLicenseAcceptance" Type="Edm.Boolean" Nullable="false"/>
        <Property Name="DownloadCount" Type="Edm.Int32" Nullable="false"/>
        <Property Name="VersionDownloadCount" Type="Edm.Int32" Nullable="false"/>
        <Property Name="PackageSize" Type="Edm.Int64" Nullable="false"/>
        <Property Name="Published" Type="Edm.DateTime"/>
        <Property Name="LastUpdated" Type="Edm.DateTime"/>
        <Property Name="Dependencies" Type="Edm.String"/>
      </EntityType>
      <EntityContainer Name="PackageContext" m:IsDefaultEntityContainer="true">
        <EntitySet Name="Packages" EntityType="NuGet.Server.DataServices.ODataPackage"/>
        <FunctionImport Name="Search" EntitySet="Packages" ReturnType="Collection(NuGet.Server.DataServices.ODataPackage)" m:HttpMethod="GET"/>
        <FunctionImport Name="FindPackagesById" EntitySet="Packages" ReturnType="Collection(NuGet.Server.DataServices.ODataPackage)" m:HttpMethod="GET"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`);
    }

    // ── Téléchargement .nupkg ─────────────────────────────────────────────────
    // path: package/maintenance-agent/1.0.0
    if (sub.startsWith('package/')) {
      const { buildNupkg } = require('../utils/buildNupkg');
      const serverUrl = config.appUrl;
      const configJson = JSON.stringify({ serverUrl, enrollmentToken: token }, null, 2);
      const nuspecContent = readTemplate('agent.nuspec.template')
        .replace(/\{\{VERSION\}\}/g, VERSION)
        .replace(/\{\{SERVER_URL\}\}/g, serverUrl);
      const agentPs1    = readTemplate('agent.ps1');
      const chocoInstall = readTemplate('chocolateyInstall.ps1');

      const buffer = await buildNupkg(nuspecContent, agentPs1, chocoInstall, configJson);
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${PACKAGE_ID}.${VERSION}.nupkg"`);
      return res.send(buffer);
    }

    // ── OData : Packages, FindPackagesById, Search ────────────────────────────
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');

    // Packages(Id='...', Version='...') — entrée unique
    const pkgByIdVer = /^Packages\(Id='([^']+)',\s*Version='([^']+)'\)$/i;
    if (pkgByIdVer.test(sub)) {
      const m = sub.match(pkgByIdVer);
      if (m[1].toLowerCase() === PACKAGE_ID) return res.send(atomFeed(base, 'Packages', true));
      return res.send(atomFeed(base, 'Packages', false));
    }

    // FindPackagesById — le plus utilisé par Chocolatey
    if (sub.startsWith('FindPackagesById')) {
      const id = (req.query.id || '').replace(/'/g, '');
      const match = !id || id.toLowerCase() === PACKAGE_ID;
      return res.send(atomFeed(base, 'FindPackagesById', match));
    }

    // Search
    if (sub.startsWith('Search')) {
      const term = (req.query.searchTerm || req.query.q || '').replace(/'/g, '').toLowerCase();
      const match = !term || PACKAGE_ID.includes(term) || 'maintenanceboard'.includes(term);
      return res.send(atomFeed(base, 'Search', match));
    }

    // Packages() — liste complète
    if (sub.startsWith('Packages')) {
      return res.send(atomFeed(base, 'Packages', true));
    }

    // Fallback : flux vide
    res.send(atomFeed(base, sub, false));

  } catch (err) { next(err); }
}

module.exports = router;
