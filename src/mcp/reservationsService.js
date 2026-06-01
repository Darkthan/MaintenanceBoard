const prisma = require('../lib/prisma');
const {
  ACTIVE_LOAN_STATUSES,
  LOAN_EQUIPMENT_INCLUDE,
  getBundleInfo,
  ensureLoanAvailability
} = require('../utils/loans');
const { normalizeEmail, resolveLoanRequesterEmail } = require('../utils/loanReservationEmail');
const {
  PARIS_TZ,
  utcToLocal,
  normalizeToUTC,
  parseDateInput
} = require('./tzUtils');

const RESERVATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURNED'];

// Vue compacte d'un emprunt, adaptée à une réponse textuelle MCP.
// Retourne toujours l'heure UTC (startAt/endAt) et l'heure locale Paris (startAtLocal/endAtLocal).
function mapReservation(r) {
  return {
    id: r.id,
    resource: r.resource ? { id: r.resource.id, name: r.resource.name } : null,
    requesterName: r.requesterName,
    requesterEmail: r.requesterEmail,
    requesterOrganization: r.requesterOrganization || null,
    startAt: r.startAt,
    endAt: r.endAt,
    startAtLocal: utcToLocal(r.startAt, PARIS_TZ),
    endAtLocal: utcToLocal(r.endAt, PARIS_TZ),
    timezone: PARIS_TZ,
    requestedUnits: r.requestedUnits,
    reservedSlots: r.reservedSlots,
    notes: r.notes || null,
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

function toSimpleBooking(input, availability, requesterEmail, selectedEquipments = []) {
  return {
    resourceId: availability.resource.id,
    resourceName: availability.resource.name,
    requesterName: String(input.requesterName || '').trim(),
    requesterEmail,
    startAt: availability.startAt || new Date(input.startAt),
    endAt: availability.endAt || new Date(input.endAt),
    requestedUnits: availability.requestedUnits,
    reservedSlots: availability.reservedSlots,
    notes: input.notes ? String(input.notes).trim() : null,
    selectedEquipments
  };
}

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

async function checkAvailability(input) {
  const { start, end } = parseDateInput(input);
  try {
    const availability = await ensureLoanAvailability(prisma, {
      resourceId: input.resourceId,
      startAt: start,
      endAt: end,
      requestedUnits: input.requestedUnits ?? 1
    });
    const bundle = getBundleInfo(availability.resource);
    return {
      available: true,
      resourceId: input.resourceId,
      resourceName: availability.resource.name,
      requestedUnits: availability.requestedUnits,
      reservedSlots: availability.reservedSlots,
      remainingSlots: availability.remainingSlots,
      totalSlots: bundle.totalSlots,
      period: {
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        startAtLocal: utcToLocal(start, PARIS_TZ),
        endAtLocal: utcToLocal(end, PARIS_TZ),
        timezone: PARIS_TZ
      }
    };
  } catch (err) {
    if (err.status === 409) {
      return { available: false, resourceId: input.resourceId, reason: err.message };
    }
    throw err;
  }
}

async function findTabletCaseResource() {
  const resources = await prisma.loanResource.findMany({
    where: { isActive: true },
    include: { ...LOAN_EQUIPMENT_INCLUDE }
  });
  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const exact = resources.find(resource => normalize(resource.name) === 'tablettes valise');
  if (exact) return exact;
  const matching = resources.find(resource => {
    const name = normalize(resource.name);
    return name.includes('tablette') && name.includes('valise');
  });
  if (!matching) {
    throw Object.assign(new Error('Ressource "Tablettes Valise" introuvable parmi le matériel informatique scolaire empruntable.'), { status: 404 });
  }
  return matching;
}

async function listReservations({ start, end, status, resourceId } = {}) {
  // Les filtres start/end sont aussi normalisés : si pas d'offset → Europe/Paris
  const startDate = start
    ? normalizeToUTC(start, PARIS_TZ)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const endDate = end
    ? normalizeToUTC(end, PARIS_TZ)
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

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

async function createReservation(input, { userId, user } = {}) {
  const { start, end, timezone } = parseDateInput(input);
  const status = input.status && ['PENDING', 'APPROVED'].includes(input.status) ? input.status : 'PENDING';
  const requesterEmail = resolveLoanRequesterEmail(input.requesterEmail, user);
  if (!requesterEmail) {
    throw Object.assign(new Error('Aucun email disponible pour cet emprunt de matériel informatique scolaire.'), { status: 400 });
  }

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
      requesterEmail,
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

async function createEquipmentBooking(input, { userId, user } = {}) {
  return createReservation({
    resourceId: input.resourceId,
    requesterName: input.requesterName,
    requesterEmail: input.requesterEmail,
    // Structured mode params
    date: input.date,
    endDate: input.endDate,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone: input.timezone,
    // Legacy ISO fallback
    startAt: input.startAt,
    endAt: input.endAt,
    requestedUnits: input.requestedUnits,
    notes: input.notes,
    status: 'PENDING'
  }, { userId, user });
}

async function bookTabletCase(input, { userId, user } = {}) {
  const resource = await findTabletCaseResource();
  return createEquipmentBooking({ ...input, resourceId: resource.id }, { userId, user });
}

async function previewEquipmentBooking(input, { user } = {}) {
  const { start, end, timezone } = parseDateInput(input);
  const requesterEmail = resolveLoanRequesterEmail(input.requesterEmail, user);
  if (!requesterEmail) {
    throw Object.assign(new Error('Aucun email disponible pour cet emprunt de matériel informatique scolaire.'), { status: 400 });
  }

  const availability = await ensureLoanAvailability(prisma, {
    resourceId: input.resourceId,
    startAt: start,
    endAt: end,
    requestedUnits: input.requestedUnits
  });

  const startAtLocal = utcToLocal(start, timezone);
  const endAtLocal = utcToLocal(end, timezone);

  const booking = {
    ...toSimpleBooking(input, { ...availability, startAt: start, endAt: end }, requesterEmail),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    startAtLocal,
    endAtLocal,
    timezone
  };

  // Affichage explicite : heure locale interprétée et UTC stockée
  const fmtLocal = (s) => s ? s.replace('T', ' ').slice(0, 16) : '?';
  const fmtUTC = (d) => d ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '?';

  return {
    wouldCreate: true,
    booking,
    interpretation: `${fmtLocal(startAtLocal)} → ${fmtLocal(endAtLocal)} ${timezone}  (= ${fmtUTC(start)} → ${fmtUTC(end)})`,
    databaseChanged: false
  };
}

async function updateReservation(id, input, { userId } = {}) {
  const existing = await prisma.loanReservation.findUnique({
    where: { id },
    include: RESERVATION_INCLUDE
  });
  if (!existing) {
    throw Object.assign(new Error('Réservation introuvable'), { status: 404 });
  }

  // Une fiche de prêt déjà signée fige l'emprunt : refus de modification via MCP.
  if (existing.contractSignatureRequestId) {
    const sig = await prisma.signatureRequest.findUnique({
      where: { id: existing.contractSignatureRequestId },
      select: { status: true }
    });
    if (sig?.status === 'SIGNED') {
      throw Object.assign(new Error('Cet emprunt possède une fiche de prêt signée et ne peut être modifié via MCP.'), { status: 409 });
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

  // Détecter si des champs de date sont fournis (mode structuré ou legacy)
  const hasDateInput = input.date || input.startAt || input.endAt;
  let startAt = existing.startAt;
  let endAt = existing.endAt;

  if (hasDateInput) {
    // Construire un input de date minimal depuis les champs fournis + existants si partiels
    const dateInput = {
      date: input.date,
      endDate: input.endDate,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: input.timezone,
      startAt: input.startAt !== undefined ? input.startAt : (input.date ? undefined : existing.startAt.toISOString()),
      endAt: input.endAt !== undefined ? input.endAt : (input.date ? undefined : existing.endAt.toISOString())
    };

    // Si mode structuré partiel (ex: seulement endTime), compléter avec l'existant
    if (input.date || input.startTime || input.endTime) {
      if (!dateInput.date) dateInput.date = utcToLocal(existing.startAt, PARIS_TZ).slice(0, 10);
      if (!dateInput.startTime) dateInput.startTime = utcToLocal(existing.startAt, PARIS_TZ).slice(11, 16);
      if (!dateInput.endTime) dateInput.endTime = utcToLocal(existing.endAt, PARIS_TZ).slice(11, 16);
    }

    const parsed = parseDateInput(dateInput);
    startAt = parsed.start;
    endAt = parsed.end;
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
    ...(hasDateInput ? { startAt, endAt } : {}),
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
  findTabletCaseResource,
  listReservations,
  createReservation,
  createEquipmentBooking,
  bookTabletCase,
  previewEquipmentBooking,
  updateReservation
};
