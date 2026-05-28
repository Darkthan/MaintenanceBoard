const prisma = require('../lib/prisma');
const {
  ACTIVE_LOAN_STATUSES,
  LOAN_EQUIPMENT_INCLUDE,
  getBundleInfo,
  ensureLoanAvailability
} = require('../utils/loans');

const RESERVATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURNED'];

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function ensureValidDates(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw Object.assign(new Error('Les dates de prêt sont invalides (format ISO 8601 attendu).'), { status: 400 });
  }
  if (end <= start) {
    throw Object.assign(new Error('La date de fin doit être postérieure à la date de début.'), { status: 400 });
  }
  return { start, end };
}

// Vue compacte d'une réservation, adaptée à une réponse textuelle MCP.
function mapReservation(r) {
  return {
    id: r.id,
    status: r.status,
    resource: r.resource ? { id: r.resource.id, name: r.resource.name } : null,
    requesterName: r.requesterName,
    requesterEmail: r.requesterEmail,
    requesterOrganization: r.requesterOrganization || null,
    startAt: r.startAt,
    endAt: r.endAt,
    requestedUnits: r.requestedUnits,
    reservedSlots: r.reservedSlots,
    notes: r.notes || null,
    internalNotes: r.internalNotes || null,
    selectedEquipments: Array.isArray(r.selectedEquipments)
      ? r.selectedEquipments.map(e => ({
          equipmentId: e.equipmentId || e.equipment?.id || null,
          name: e.equipmentName || e.equipment?.name || null,
          serialNumber: e.equipmentSerialNumber || e.equipment?.serialNumber || null
        }))
      : [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

const RESERVATION_INCLUDE = {
  resource: { select: { id: true, name: true } },
  selectedEquipments: {
    include: { equipment: { select: { id: true, name: true, serialNumber: true } } },
    orderBy: [{ lotNumber: 'asc' }, { equipmentName: 'asc' }]
  }
};

// Construit les snapshots d'équipements nominatifs en validant qu'ils appartiennent à la ressource.
function buildSelectedEquipmentSnapshots(resource, selectedEquipmentIds) {
  const ids = [...new Set((selectedEquipmentIds || []).map(s => String(s || '').trim()).filter(Boolean))];
  if (!ids.length) return [];

  const byId = new Map(
    (resource.equipments || [])
      .map(link => ({ equipment: link.equipment || link, lotNumber: link.lotNumber ?? 1 }))
      .filter(e => e.equipment?.id)
      .map(e => [e.equipment.id, e])
  );

  return ids.map(id => {
    const entry = byId.get(id);
    if (!entry) {
      throw Object.assign(new Error(`L'appareil ${id} ne fait pas partie de cette ressource de prêt.`), { status: 400 });
    }
    const eq = entry.equipment;
    return {
      equipmentId: eq.id,
      equipmentName: eq.name,
      equipmentType: eq.type || null,
      equipmentBrand: eq.brand || null,
      equipmentModel: eq.model || null,
      equipmentSerialNumber: eq.serialNumber || null,
      lotNumber: entry.lotNumber
    };
  });
}

async function listResources() {
  const resources = await prisma.loanResource.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { ...LOAN_EQUIPMENT_INCLUDE }
  });

  return resources.map(resource => {
    const bundle = getBundleInfo(resource);
    return {
      id: resource.id,
      name: resource.name,
      category: resource.category || null,
      location: resource.location || null,
      totalUnits: bundle.totalUnits,
      bundleSize: bundle.bundleSize,
      totalSlots: bundle.totalSlots,
      equipments: (resource.equipments || [])
        .map(l => l.equipment)
        .filter(Boolean)
        .map(e => ({ id: e.id, name: e.name, serialNumber: e.serialNumber || null, status: e.status }))
    };
  });
}

async function checkAvailability({ resourceId, startAt, endAt, requestedUnits = 1 }) {
  const { start, end } = ensureValidDates(startAt, endAt);
  try {
    const availability = await ensureLoanAvailability(prisma, {
      resourceId,
      startAt: start,
      endAt: end,
      requestedUnits
    });
    const bundle = getBundleInfo(availability.resource);
    return {
      available: true,
      resourceId,
      resourceName: availability.resource.name,
      requestedUnits: availability.requestedUnits,
      reservedSlots: availability.reservedSlots,
      remainingSlots: availability.remainingSlots,
      totalSlots: bundle.totalSlots
    };
  } catch (err) {
    if (err.status === 409) {
      return { available: false, resourceId, reason: err.message };
    }
    throw err;
  }
}

async function listReservations({ start, end, status, resourceId } = {}) {
  const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const endDate = end ? new Date(end) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  if (status && !RESERVATION_STATUSES.includes(status)) {
    throw Object.assign(new Error(`Statut invalide. Valeurs acceptées : ${RESERVATION_STATUSES.join(', ')}.`), { status: 400 });
  }

  const where = {
    startAt: { lt: endDate },
    endAt: { gt: startDate },
    ...(status ? { status } : {}),
    ...(resourceId ? { resourceId } : {})
  };

  const reservations = await prisma.loanReservation.findMany({
    where,
    orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
    include: RESERVATION_INCLUDE
  });

  return reservations.map(mapReservation);
}

async function createReservation(input, { userId } = {}) {
  const { start, end } = ensureValidDates(input.startAt, input.endAt);
  const status = input.status && ['PENDING', 'APPROVED'].includes(input.status) ? input.status : 'PENDING';

  const availability = await ensureLoanAvailability(prisma, {
    resourceId: input.resourceId,
    startAt: start,
    endAt: end,
    requestedUnits: input.requestedUnits
  });

  const selectedEquipments = buildSelectedEquipmentSnapshots(availability.resource, input.selectedEquipmentIds);

  const reservation = await prisma.loanReservation.create({
    data: {
      resourceId: availability.resource.id,
      requesterName: String(input.requesterName).trim(),
      requesterEmail: normalizeEmail(input.requesterEmail),
      requesterPhone: input.requesterPhone ? String(input.requesterPhone).trim() : null,
      requesterOrganization: input.requesterOrganization ? String(input.requesterOrganization).trim() : null,
      startAt: start,
      endAt: end,
      requestedUnits: availability.requestedUnits,
      reservedSlots: availability.reservedSlots,
      notes: input.notes ? String(input.notes).trim() : null,
      internalNotes: input.internalNotes ? String(input.internalNotes).trim() : null,
      status,
      createdById: userId || null,
      approvedById: status === 'APPROVED' ? (userId || null) : null,
      selectedEquipments: selectedEquipments.length ? { create: selectedEquipments } : undefined
    },
    include: RESERVATION_INCLUDE
  });

  return mapReservation(reservation);
}

async function updateReservation(id, input, { userId } = {}) {
  const existing = await prisma.loanReservation.findUnique({
    where: { id },
    include: RESERVATION_INCLUDE
  });
  if (!existing) {
    throw Object.assign(new Error('Réservation introuvable'), { status: 404 });
  }

  // Une fiche de prêt déjà signée fige la réservation : refus de toute modification via MCP.
  if (existing.contractSignatureRequestId) {
    const sig = await prisma.signatureRequest.findUnique({
      where: { id: existing.contractSignatureRequestId },
      select: { status: true }
    });
    if (sig?.status === 'SIGNED') {
      throw Object.assign(new Error('Cette réservation possède une fiche de prêt signée et ne peut être modifiée via MCP.'), { status: 409 });
    }
  }

  if (input.status !== undefined && !RESERVATION_STATUSES.includes(input.status)) {
    throw Object.assign(new Error(`Statut invalide. Valeurs acceptées : ${RESERVATION_STATUSES.join(', ')}.`), { status: 400 });
  }

  const next = {
    resourceId: input.resourceId || existing.resourceId,
    requestedUnits: input.requestedUnits !== undefined ? parseInt(input.requestedUnits, 10) : existing.requestedUnits,
    status: input.status !== undefined ? input.status : existing.status
  };

  let startAt = existing.startAt;
  let endAt = existing.endAt;
  if (input.startAt !== undefined || input.endAt !== undefined) {
    const dates = ensureValidDates(
      input.startAt !== undefined ? input.startAt : existing.startAt,
      input.endAt !== undefined ? input.endAt : existing.endAt
    );
    startAt = dates.start;
    endAt = dates.end;
  }

  const scheduleChanged =
    next.resourceId !== existing.resourceId ||
    next.requestedUnits !== existing.requestedUnits ||
    new Date(startAt).getTime() !== new Date(existing.startAt).getTime() ||
    new Date(endAt).getTime() !== new Date(existing.endAt).getTime();
  const becomingApproved = input.status === 'APPROVED' && existing.status !== 'APPROVED';

  let availability = null;
  if (scheduleChanged || becomingApproved) {
    availability = await ensureLoanAvailability(prisma, {
      resourceId: next.resourceId,
      startAt,
      endAt,
      requestedUnits: next.requestedUnits,
      excludeReservationId: existing.id
    });
  }

  const data = {
    ...(input.resourceId !== undefined ? { resourceId: next.resourceId } : {}),
    ...(input.requesterName !== undefined ? { requesterName: String(input.requesterName).trim() } : {}),
    ...(input.requesterEmail !== undefined ? { requesterEmail: normalizeEmail(input.requesterEmail) } : {}),
    ...(input.requesterPhone !== undefined ? { requesterPhone: input.requesterPhone ? String(input.requesterPhone).trim() : null } : {}),
    ...(input.requesterOrganization !== undefined ? { requesterOrganization: input.requesterOrganization ? String(input.requesterOrganization).trim() : null } : {}),
    ...(input.startAt !== undefined ? { startAt } : {}),
    ...(input.endAt !== undefined ? { endAt } : {}),
    ...(input.requestedUnits !== undefined ? { requestedUnits: next.requestedUnits } : {}),
    ...(availability ? { reservedSlots: availability.reservedSlots } : {}),
    ...(input.notes !== undefined ? { notes: input.notes ? String(input.notes).trim() : null } : {}),
    ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes ? String(input.internalNotes).trim() : null } : {}),
    ...(input.status !== undefined ? { status: next.status, approvedById: next.status === 'APPROVED' ? (userId || existing.approvedById) : existing.approvedById } : {})
  };

  const updated = await prisma.loanReservation.update({
    where: { id },
    data,
    include: RESERVATION_INCLUDE
  });

  return mapReservation(updated);
}

module.exports = {
  RESERVATION_STATUSES,
  listResources,
  checkAvailability,
  listReservations,
  createReservation,
  updateReservation
};
