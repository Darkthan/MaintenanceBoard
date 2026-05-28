const express = require('express');
const router = express.Router();
const config = require('../config');
const { ALL_MCP_SCOPES } = require('../utils/mcpTokens');

const base = () => config.appUrl.replace(/\/$/, '');
const OAUTH_SCOPES = [...ALL_MCP_SCOPES, 'offline_access'];

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 * Découverte automatique par les clients OAuth2 (ChatGPT, Claude, etc.).
 */
router.get('/oauth-authorization-server', (_req, res) => {
  const b = base();
  res.json({
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    scopes_supported: OAUTH_SCOPES,
    service_documentation: `${b}/api-docs`
  });
});

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 * Indique aux clients quel serveur d'autorisation protège cette ressource.
 */
router.get('/oauth-protected-resource', (_req, res) => {
  const b = base();
  res.json({
    resource: `${b}/mcp`,
    authorization_servers: [b],
    bearer_methods_supported: ['header'],
    scopes_supported: ALL_MCP_SCOPES
  });
});

module.exports = router;
