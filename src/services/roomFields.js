const { z } = require('zod');

// Contraintes communes aux écritures HTTP et MCP.
const roomFields = {
  name: z.string().trim().min(1).max(200),
  building: z.string().trim().max(100).nullable().optional(),
  floor: z.number().int().min(-2147483648).max(2147483647).nullable().optional(),
  number: z.string().trim().max(50).nullable().optional(),
  description: z.string().trim().nullable().optional()
};
const createRoomSchema = z.object(roomFields).strict();
const updateRoomSchema = createRoomSchema.partial().refine(data => Object.keys(data).length > 0, 'Aucun champ à modifier');

module.exports = { roomFields, createRoomSchema, updateRoomSchema };
