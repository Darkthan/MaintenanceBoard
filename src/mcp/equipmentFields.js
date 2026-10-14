const { z } = require('zod');

const text = max => z.string().trim().max(max).nullable().optional();
const date = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional();
const equipmentFields = {
  name: z.string().trim().min(1).max(200).optional(),
  type: z.string().trim().min(1).max(100).optional(),
  brand: text(200), model: text(200), serialNumber: text(200),
  invoiceNumber: text(200), deliveryNoteNumber: text(200),
  status: z.enum(['ACTIVE', 'INACTIVE', 'REPAIR', 'DECOMMISSIONED', 'DEEE']).optional(),
  description: text(10000), roomId: text(200), supplierId: text(200),
  purchaseDate: date, warrantyEnd: date,
  purchasePrice: z.number().finite().nonnegative().nullable().optional().describe('Prix unitaire d’achat en euros, jamais le total du lot.'),
  discoverySource: z.enum(['MANUAL', 'AGENT']).optional(),
  discoveryStatus: z.enum(['PENDING', 'CONFIRMED']).optional(),
  suggestedRoomId: text(200), lastSeenAt: date,
  agentHostname: text(255),
  agentInfo: z.union([z.record(z.unknown()), z.string().max(10000)]).nullable().optional()
    .describe('Informations matérielles et système : objet JSON ou texte JSON contenant un objet.'),
  agentRevoked: z.boolean().optional(), enrollmentTokenId: text(200)
};

const readOnlyFields = ['id', 'createdAt', 'updatedAt'];
const protectedFields = ['qrToken', 'agentToken', 'agentAlertState'];

module.exports = { equipmentFields, readOnlyFields, protectedFields };
