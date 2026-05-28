const { readSettings, writeSettings } = require('./settings');

const ACTIVE_LOAN_STATUSES = ['PENDING', 'APPROVED'];

function toPositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
}

function getBundleInfo(resource) {
  const totalUnits = toPositiveInt(resource?.totalUnits, 1);
  const usesBundles = resource?.usesBundles !== false;

  if (!usesBundles) {
    // Mode sans lots : 1 seul lot avec toutes les unités
    return { totalUnits, bundleSize: totalUnits, totalSlots: 1 };
  }

  const bundleSize = Math.min(totalUnits, toPositiveInt(resource?.bundleSize, 1));
  const totalSlots = Math.max(1, Math.floor(totalUnits / bundleSize));
  return { totalUnits, bundleSize, totalSlots };
}

function computeReservedSlots(resource, requestedUnits) {
  const { bundleSize } = getBundleInfo(resource);
  return Math.max(1, Math.ceil(toPositiveInt(requestedUnits, 1) / bundleSize));
}

function overlaps(startA, endA, startB, endB) {
  return new Date(startA).getTime() < new Date(endB).getTime()
    && new Date(endA).getTime() > new Date(startB).getTime();
}

const LOAN_EQUIPMENT_INCLUDE = {
  equipments: {
    include: {
      equipment: {
        select: { id: true, name: true, serialNumber: true, status: true, type: true, brand: true, model: true }
      }
    }
  }
};

/**
 * Vérifie la disponibilité d'une ressource de prêt sur une période et calcule
 * les lots à réserver. Source unique de vérité partagée par les routes HTTP et
 * les outils MCP — toute évolution des règles anti-surréservation reste centralisée ici.
 *
 * Lève une Error avec .status (404/409) en cas d'indisponibilité.
 * Retourne { resource, requestedUnits, reservedSlots, remainingSlots }.
 */
async function ensureLoanAvailability(prisma, { resourceId, startAt, endAt, requestedUnits, excludeReservationId = null }) {
  const resource = await prisma.loanResource.findUnique({
    where: { id: resourceId },
    include: { ...LOAN_EQUIPMENT_INCLUDE }
  });
  if (!resource || !resource.isActive) {
    throw Object.assign(new Error('Ressource de prêt introuvable'), { status: 404 });
  }

  const linkedEquipments = (resource.equipments || []).map(e => e.equipment).filter(Boolean);
  if (linkedEquipments.length > 0 && linkedEquipments.some(e => e.status === 'REPAIR')) {
    throw Object.assign(new Error('Cette ressource est temporairement indisponible : un équipement lié est en cours de réparation.'), { status: 409 });
  }

  const bundle = getBundleInfo(resource);
  const requested = Math.max(1, Math.min(bundle.totalUnits, Math.round(Number(requestedUnits) || 1)));
  const reservedSlots = computeReservedSlots(resource, requested);

  const overlapsWhere = {
    resourceId,
    status: { in: ACTIVE_LOAN_STATUSES },
    startAt: { lt: new Date(endAt) },
    endAt: { gt: new Date(startAt) }
  };
  if (excludeReservationId) {
    overlapsWhere.id = { not: excludeReservationId };
  }

  const overlapping = await prisma.loanReservation.findMany({ where: overlapsWhere });
  const usedSlots = overlapping.reduce((sum, item) => sum + (item.reservedSlots || 0), 0);

  if (usedSlots + reservedSlots > bundle.totalSlots) {
    throw Object.assign(new Error(`Disponibilité insuffisante sur cette période. ${bundle.totalSlots - usedSlots} lot(s) restant(s).`), { status: 409 });
  }

  return {
    resource,
    requestedUnits: requested,
    reservedSlots,
    remainingSlots: Math.max(0, bundle.totalSlots - usedSlots - reservedSlots)
  };
}

function getCalendarFeedToken() {
  const settings = readSettings();
  const current = settings.loans?.calendarFeedToken;
  if (current) return current;

  const token = `loan-cal-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  writeSettings({
    loans: {
      ...(settings.loans || {}),
      calendarFeedToken: token
    }
  });
  return token;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toIcsDate(value) {
  const date = new Date(value);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

module.exports = {
  ACTIVE_LOAN_STATUSES,
  LOAN_EQUIPMENT_INCLUDE,
  getBundleInfo,
  computeReservedSlots,
  overlaps,
  ensureLoanAvailability,
  getCalendarFeedToken,
  escapeIcsText,
  toIcsDate
};
