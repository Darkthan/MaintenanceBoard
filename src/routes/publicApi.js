// API publique REST (lecture) pour consulter équipements et salles.
// Authentification : clé API MaintenanceBoard (Bearer mcp_xxx) OU OAuth2
// (client_credentials / authorization_code), via le même middleware que le
// serveur MCP — mcpAuth gère déjà la durée de validité (expiresAt/isActive)
// et les scopes (droits d'accès) des tokens.
const express = require('express');
const router = express.Router();
const { mcpAuth, requireScope } = require('../middleware/mcpAuth');
const { MCP_SCOPES } = require('../utils/mcpTokens');
const equipmentService = require('../mcp/equipmentService');
const roomService = require('../services/roomService');

router.use(mcpAuth);

function scoped(scope) {
  return (req, res, next) => {
    if (!requireScope(req.mcpToken?.scopes, scope)) {
      return res.status(403).json({ error: `Scope manquant : ${scope}` });
    }
    next();
  };
}

router.get('/equipment', scoped(MCP_SCOPES.EQUIPMENT_READ), async (req, res, next) => {
  try {
    const { search, type, roomId, status, ip, mac, limit, cursor } = req.query;
    res.json(await equipmentService.listEquipment({ search, type, roomId, status, ip, mac, limit, cursor }));
  } catch (err) { next(err); }
});

router.get('/equipment/:id', scoped(MCP_SCOPES.EQUIPMENT_READ), async (req, res, next) => {
  try {
    res.json(await equipmentService.getEquipment({ id: req.params.id }));
  } catch (err) { next(err); }
});

router.get('/rooms', scoped(MCP_SCOPES.ROOMS_READ), async (req, res, next) => {
  try {
    const { search, building, limit, cursor } = req.query;
    res.json(await roomService.listRooms({ search, building, limit, cursor }));
  } catch (err) { next(err); }
});

router.get('/rooms/:id', scoped(MCP_SCOPES.ROOMS_READ), async (req, res, next) => {
  try {
    res.json(await roomService.getRoom({ id: req.params.id }));
  } catch (err) { next(err); }
});

router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
});

module.exports = router;
