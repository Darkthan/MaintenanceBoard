const { randomUUID } = require('crypto');
const { readSettings, writeSettings } = require('./settings');

const GLOBAL_CALENDAR_TOKEN_KEY = 'globalCalendar';
const GLOBAL_CALENDAR_LOAN_STATUSES = ['PENDING', 'APPROVED'];
const GLOBAL_CALENDAR_INTERVENTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

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

function buildIcs(entries, prodId = '-//MaintenanceBoard//GlobalCalendar//FR') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  entries.forEach(entry => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${entry.uid}@maintenanceboard`,
      `DTSTAMP:${toIcsDate(new Date())}`,
      `DTSTART:${toIcsDate(entry.startAt)}`,
      `DTEND:${toIcsDate(entry.endAt)}`,
      `SUMMARY:${escapeIcsText(entry.summary)}`,
      `DESCRIPTION:${escapeIcsText(entry.description || '')}`,
      `LOCATION:${escapeIcsText(entry.location || 'MaintenanceBoard')}`,
      `STATUS:${entry.status || 'CONFIRMED'}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function formatCalendarDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRoomLabel(room) {
  if (!room) return '';
  return room.number ? `${room.name} (${room.number})` : room.name;
}

function buildInterventionLocation(intervention) {
  return formatRoomLabel(intervention.room) || intervention.equipment?.name || 'MaintenanceBoard';
}

function buildInterventionDescription(intervention, type) {
  return [
    type === 'due' ? `Échéance : ${intervention.title}` : `Intervention : ${intervention.title}`,
    `Statut : ${intervention.status}`,
    `Priorité : ${intervention.priority}`,
    intervention.tech?.name ? `Technicien : ${intervention.tech.name}` : null,
    intervention.room ? `Salle : ${formatRoomLabel(intervention.room)}` : null,
    intervention.equipment?.name ? `Équipement : ${intervention.equipment.name}` : null,
    intervention.description ? `Description : ${intervention.description}` : null,
    intervention.dueAt ? `Date due : ${formatCalendarDate(intervention.dueAt)}` : null
  ].filter(Boolean).join('\n');
}

function buildLoanDescription(loan) {
  return [
    `Réservation : ${loan.resource?.name || 'Ressource'}`,
    `Demandeur : ${loan.requesterName}`,
    loan.requesterEmail ? `Email : ${loan.requesterEmail}` : null,
    loan.requesterOrganization ? `Organisation : ${loan.requesterOrganization}` : null,
    `Quantité : ${loan.requestedUnits}`,
    loan.additionalNeeds ? `Besoins : ${loan.additionalNeeds}` : null
  ].filter(Boolean).join('\n');
}

function normalizeInterventionCalendarEntries(interventions) {
  return interventions.flatMap(intervention => {
    const entries = [];

    if (intervention.scheduledStartAt) {
      const startAt = new Date(intervention.scheduledStartAt);
      const endAt = intervention.scheduledEndAt
        ? new Date(intervention.scheduledEndAt)
        : new Date(startAt.getTime() + 60 * 60 * 1000);

      entries.push({
        id: `intervention-scheduled-${intervention.id}`,
        uid: `intervention-scheduled-${intervention.id}`,
        sourceType: 'intervention',
        entryType: 'scheduled',
        title: intervention.title,
        startAt,
        endAt,
        status: intervention.status,
        priority: intervention.priority,
        room: intervention.room,
        equipment: intervention.equipment,
        tech: intervention.tech,
        summary: `Intervention · ${intervention.title}`,
        description: buildInterventionDescription(intervention, 'scheduled'),
        location: buildInterventionLocation(intervention),
        icsStatus: intervention.status === 'RESOLVED' ? 'TENTATIVE' : 'CONFIRMED'
      });
    }

    if (intervention.dueAt) {
      const startAt = new Date(intervention.dueAt);
      const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);

      entries.push({
        id: `intervention-due-${intervention.id}`,
        uid: `intervention-due-${intervention.id}`,
        sourceType: 'intervention',
        entryType: 'due',
        title: intervention.title,
        startAt,
        endAt,
        status: intervention.status,
        priority: intervention.priority,
        room: intervention.room,
        equipment: intervention.equipment,
        tech: intervention.tech,
        summary: `Échéance · ${intervention.title}`,
        description: buildInterventionDescription(intervention, 'due'),
        location: buildInterventionLocation(intervention),
        icsStatus: intervention.status === 'RESOLVED' ? 'TENTATIVE' : 'CONFIRMED'
      });
    }

    return entries;
  });
}

function normalizeLoanCalendarEntries(loans) {
  return loans.map(loan => ({
    id: `loan-${loan.id}`,
    uid: `loan-${loan.id}`,
    sourceType: 'loan',
    entryType: 'loan',
    title: loan.resource?.name || 'Ressource',
    startAt: new Date(loan.startAt),
    endAt: new Date(loan.endAt),
    status: loan.status,
    requesterName: loan.requesterName,
    requesterOrganization: loan.requesterOrganization,
    resource: loan.resource,
    summary: `Prêt · ${loan.resource?.name || 'Ressource'} · ${loan.requesterName}`,
    description: buildLoanDescription(loan),
    location: loan.resource?.location || 'MaintenanceBoard',
    icsStatus: loan.status === 'APPROVED' ? 'CONFIRMED' : 'TENTATIVE'
  }));
}

function compareCalendarEntries(a, b) {
  const startDiff = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  if (startDiff !== 0) return startDiff;
  const typeRank = { due: 0, scheduled: 1, loan: 2 };
  const rankDiff = (typeRank[a.entryType] ?? 99) - (typeRank[b.entryType] ?? 99);
  if (rankDiff !== 0) return rankDiff;
  return String(a.id).localeCompare(String(b.id));
}

async function fetchGlobalCalendarEntries(prisma, { startAt, endAt }) {
  const [interventions, loans] = await Promise.all([
    prisma.intervention.findMany({
      where: {
        mergedIntoId: null,
        status: { in: GLOBAL_CALENDAR_INTERVENTION_STATUSES },
        OR: [
          { scheduledStartAt: { gte: startAt, lt: endAt } },
          { dueAt: { gte: startAt, lt: endAt } }
        ]
      },
      orderBy: [{ scheduledStartAt: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
      include: {
        room: { select: { name: true, number: true } },
        equipment: { select: { name: true, type: true } },
        tech: { select: { name: true, email: true } }
      }
    }),
    prisma.loanReservation.findMany({
      where: {
        status: { in: GLOBAL_CALENDAR_LOAN_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt }
      },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      include: {
        resource: { select: { name: true, location: true } }
      }
    })
  ]);

  return [
    ...normalizeInterventionCalendarEntries(interventions),
    ...normalizeLoanCalendarEntries(loans)
  ].sort(compareCalendarEntries);
}

function buildGlobalCalendarIcs(entries) {
  return buildIcs(entries.map(entry => ({
    uid: entry.uid,
    startAt: entry.startAt,
    endAt: entry.endAt,
    summary: entry.summary,
    description: entry.description,
    location: entry.location,
    status: entry.icsStatus
  })));
}

let _cachedFeedToken = null;

function getGlobalCalendarFeedToken() {
  if (_cachedFeedToken) return _cachedFeedToken;

  const settings = readSettings();
  const existing = settings?.[GLOBAL_CALENDAR_TOKEN_KEY]?.token;
  if (existing) {
    _cachedFeedToken = existing;
    return existing;
  }

  const token = randomUUID();
  writeSettings({
    [GLOBAL_CALENDAR_TOKEN_KEY]: {
      token,
      createdAt: new Date().toISOString()
    }
  });
  _cachedFeedToken = token;
  return token;
}

module.exports = {
  GLOBAL_CALENDAR_LOAN_STATUSES,
  GLOBAL_CALENDAR_INTERVENTION_STATUSES,
  escapeIcsText,
  toIcsDate,
  buildIcs,
  formatCalendarDate,
  formatRoomLabel,
  fetchGlobalCalendarEntries,
  buildGlobalCalendarIcs,
  getGlobalCalendarFeedToken,
  compareCalendarEntries
};
