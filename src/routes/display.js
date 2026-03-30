const express = require('express');
const prisma = require('../lib/prisma');
const { readSettings } = require('../utils/settings');
const { normalizeDisplayScreens, DISPLAY_WIDGET_LABELS } = require('../utils/displayScreens');
const { fetchGlobalCalendarEntries, formatCalendarDate, formatRoomLabel } = require('../utils/globalCalendar');

const router = express.Router();

const INTERVENTION_VISIBLE_STATUSES = ['OPEN', 'IN_PROGRESS'];
const INTERVENTION_RED_STATUSES = ['OPEN'];
const FOLLOW_UP_ORDER_STATUSES = ['PENDING', 'ORDERED', 'PARTIAL'];
const LOAN_VISIBLE_STATUSES = ['PENDING', 'APPROVED'];
const PARIS_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const PARIS_TIME_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function toneFromAlert(alert) {
  return alert ? 'alert' : 'neutral';
}

function isSameParisDay(a, b) {
  return PARIS_DAY_FORMATTER.format(new Date(a)) === PARIS_DAY_FORMATTER.format(new Date(b));
}

function getParisDayKey(value) {
  return PARIS_DAY_FORMATTER.format(new Date(value));
}

function getNextParisDayKey(value) {
  const [year, month, day] = getParisDayKey(value).split('-').map(Number);
  return PARIS_DAY_FORMATTER.format(new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0)));
}

function getParisMinutes(value) {
  const [hours, minutes] = PARIS_TIME_FORMATTER.format(new Date(value)).split(':').map(Number);
  return hours * 60 + minutes;
}

function parseOpeningHour(openingHour) {
  const [hours, minutes] = String(openingHour || '08:00').split(':').map(Number);
  return (Number.isInteger(hours) ? hours : 8) * 60 + (Number.isInteger(minutes) ? minutes : 0);
}

function isLoanAlert(startAt, now, openingHour) {
  const startDay = getParisDayKey(startAt);
  const currentDay = getParisDayKey(now);
  if (startDay === currentDay) {
    return true;
  }

  const nextDay = getNextParisDayKey(now);
  if (startDay !== nextDay) {
    return false;
  }

  return getParisMinutes(now) < parseOpeningHour(openingHour);
}

function applyAlertsPreference(widget, alertsEnabled) {
  if (alertsEnabled) return widget;
  return {
    ...widget,
    tone: 'neutral',
    stats: Array.isArray(widget.stats)
      ? widget.stats.map(stat => ({ ...stat, alert: false }))
      : widget.stats,
    items: Array.isArray(widget.items)
      ? widget.items.map(item => ({ ...item, alert: false }))
      : widget.items
  };
}

function rankAutoWidget(widget) {
  const priorityById = {
    overview: 0,
    interventions: 1,
    repairs: 2,
    stockAlerts: 3,
    pendingAgents: 4,
    orders: 5,
    upcomingLoans: 6,
    globalCalendar: 7
  };

  return [
    widget.tone === 'alert' ? 0 : 1,
    priorityById[widget.id] ?? 99
  ];
}

function compareAutoWidgets(a, b) {
  const rankA = rankAutoWidget(a);
  const rankB = rankAutoWidget(b);
  if (rankA[0] !== rankB[0]) return rankA[0] - rankB[0];
  return rankA[1] - rankB[1];
}

function getManualSize(widgetLayouts, widgetId) {
  return widgetLayouts.find(layout => layout.id === widgetId)?.size || 'compact';
}

function inferAutoSize(widget) {
  if (widget.id === 'overview') return 'hero';
  if (widget.id === 'globalCalendar') return 'hero';
  if (widget.tone === 'alert') return 'wide';
  if (widget.id === 'upcomingLoans' && (widget.items?.length || 0) >= 4) return 'wide';
  if ((widget.items?.length || 0) >= 6) return 'wide';
  return 'compact';
}

function getWidgetLayout(widget, screen) {
  const size = screen.layoutMode === 'MANUAL'
    ? getManualSize(screen.widgetLayouts || [], widget.id)
    : inferAutoSize(widget);
  return { size };
}


function formatCalendarDayLabel(value) {
  return new Date(value).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

function formatCalendarTime(value) {
  return new Date(value).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatInterventionStatus(status) {
  return {
    OPEN: 'Ouvert',
    IN_PROGRESS: 'En cours',
    RESOLVED: 'Résolu',
    CLOSED: 'Fermé'
  }[status] || status;
}

function formatCountdown(targetDate, now = new Date()) {
  const diffMs = new Date(targetDate).getTime() - new Date(now).getTime();
  if (diffMs <= 0) {
    return 'Maintenant';
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days > 0) parts.push(`${days}j`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}min`);

  return `Dans ${parts.join(' ')}`;
}

function compareLoanStart(a, b) {
  const startDiff = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  if (startDiff !== 0) return startDiff;
  const createdDiff = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  if (createdDiff !== 0) return createdDiff;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

async function fetchUpcomingLoanReservations(now, limit = null) {
  const query = {
    where: {
      status: { in: LOAN_VISIBLE_STATUSES },
      startAt: { gte: now }
    },
    orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
    include: {
      resource: { select: { name: true, location: true } }
    }
  };

  if (Number.isInteger(limit) && limit > 0) {
    query.take = limit;
  }

  const items = await prisma.loanReservation.findMany(query);
  return items.slice().sort(compareLoanStart);
}

async function buildOverviewWidget() {
  const now = new Date();
  const [roomsCount, equipmentCount, interventionsCount, repairsCount, stockItems, upcomingLoans] = await Promise.all([
    prisma.room.count(),
    prisma.equipment.count(),
    prisma.intervention.count(),
    prisma.equipment.count({ where: { status: 'REPAIR' } }),
    prisma.stockItem.findMany({
      select: { id: true, quantity: true, minQuantity: true }
    }),
    fetchUpcomingLoanReservations(now)
  ]);
  const nextLoan = [...upcomingLoans].sort(compareLoanStart)[0] || null;

  const lowStockCount = stockItems.filter(item => item.quantity <= item.minQuantity).length;
  const nextLoanDescription = nextLoan
    ? [
        formatCalendarDate(nextLoan.startAt),
        nextLoan.requesterName,
        nextLoan.resource?.name || 'Ressource'
      ].filter(Boolean).join(' · ')
    : 'Aucune réservation planifiée';
  const stats = [
    {
      key: 'rooms',
      label: 'Salles',
      value: roomsCount,
      description: 'Espaces référencés',
      alert: false
    },
    {
      key: 'equipment',
      label: 'Équipements',
      value: equipmentCount,
      description: 'Parc total',
      alert: false
    },
    {
      key: 'interventions',
      label: 'Interventions',
      value: interventionsCount,
      description: 'Tous statuts confondus',
      alert: false
    },
    {
      key: 'repairs',
      label: 'En réparation',
      value: repairsCount,
      description: repairsCount ? 'Matériels immobilisés' : 'Aucune panne ouverte',
      alert: repairsCount > 0
    },
    {
      key: 'stock',
      label: 'Stock bas',
      value: lowStockCount,
      description: lowStockCount ? 'Consommables à réapprovisionner' : 'Seuils respectés',
      alert: lowStockCount > 0
    },
    {
      key: 'nextLoan',
      label: 'Prochaine réservation',
      value: nextLoan ? formatCountdown(nextLoan.startAt, now) : 'Aucune',
      description: nextLoanDescription,
      countdownTo: nextLoan?.startAt ? new Date(nextLoan.startAt).toISOString() : null,
      alert: false
    }
  ];

  return {
    id: 'overview',
    kind: 'overview',
    title: DISPLAY_WIDGET_LABELS.overview,
    tone: toneFromAlert(stats.some(stat => stat.alert)),
    stats
  };
}

async function buildInterventionsWidget() {
  const [count, items] = await Promise.all([
    prisma.intervention.count({ where: { status: { in: INTERVENTION_RED_STATUSES } } }),
    prisma.intervention.findMany({
      where: { status: { in: INTERVENTION_VISIBLE_STATUSES } },
      orderBy: [{ createdAt: 'desc' }],
      take: 8,
      include: {
        room: { select: { name: true, number: true } },
        equipment: { select: { name: true } }
      }
    })
  ]);

  return {
    id: 'interventions',
    kind: 'list',
    title: DISPLAY_WIDGET_LABELS.interventions,
    tone: toneFromAlert(count > 0),
    emptyLabel: 'Aucune intervention ouverte.',
    items: items.map(item => ({
      title: item.title,
      subtitle: [formatRoomLabel(item.room), item.equipment?.name].filter(Boolean).join(' · ') || 'Intervention',
      meta: [item.status, item.priority].filter(Boolean).join(' · '),
      alert: INTERVENTION_RED_STATUSES.includes(item.status)
    }))
  };
}

async function buildRepairsWidget() {
  const [count, items] = await Promise.all([
    prisma.equipment.count({ where: { status: 'REPAIR' } }),
    prisma.equipment.findMany({
      where: { status: 'REPAIR' },
      orderBy: [{ updatedAt: 'desc' }],
      take: 8,
      include: {
        room: { select: { name: true, number: true } }
      }
    })
  ]);

  return {
    id: 'repairs',
    kind: 'list',
    title: DISPLAY_WIDGET_LABELS.repairs,
    tone: toneFromAlert(count > 0),
    emptyLabel: 'Aucun équipement en réparation.',
    items: items.map(item => ({
      title: item.name,
      subtitle: [item.type, formatRoomLabel(item.room)].filter(Boolean).join(' · '),
      meta: item.brand || item.model ? [item.brand, item.model].filter(Boolean).join(' ') : 'Suivi maintenance',
      alert: true
    }))
  };
}

async function buildStockAlertsWidget() {
  const stockItems = await prisma.stockItem.findMany({
    orderBy: [{ name: 'asc' }],
    include: {
      supplier: { select: { name: true } }
    }
  });

  const items = stockItems
    .filter(item => item.quantity <= item.minQuantity)
    .slice(0, 8);

  return {
    id: 'stockAlerts',
    kind: 'list',
    title: DISPLAY_WIDGET_LABELS.stockAlerts,
    tone: toneFromAlert(items.length > 0),
    emptyLabel: 'Aucun article en rupture ou sous seuil.',
    items: items.map(item => ({
      title: item.name,
      subtitle: [item.category, item.location].filter(Boolean).join(' · ') || 'Stock',
      meta: `${item.quantity} restant(s) / seuil ${item.minQuantity}`,
      alert: true
    }))
  };
}

async function buildPendingAgentsWidget() {
  const [count, items] = await Promise.all([
    prisma.equipment.count({
      where: {
        discoverySource: 'AGENT',
        discoveryStatus: 'PENDING'
      }
    }),
    prisma.equipment.findMany({
      where: {
        discoverySource: 'AGENT',
        discoveryStatus: 'PENDING'
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 8,
      include: {
        room: { select: { name: true, number: true } }
      }
    })
  ]);

  return {
    id: 'pendingAgents',
    kind: 'list',
    title: DISPLAY_WIDGET_LABELS.pendingAgents,
    tone: toneFromAlert(count > 0),
    emptyLabel: 'Aucun équipement agent à valider.',
    items: items.map(item => ({
      title: item.name,
      subtitle: [item.agentHostname, formatRoomLabel(item.room)].filter(Boolean).join(' · ') || 'Découverte agent',
      meta: item.type || 'Équipement détecté',
      alert: true
    }))
  };
}

async function buildOrdersWidget() {
  const items = await prisma.order.findMany({
    where: {
      status: { in: FOLLOW_UP_ORDER_STATUSES }
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 8,
    include: {
      requester: { select: { name: true } }
    }
  });

  return {
    id: 'orders',
    kind: 'list',
    title: DISPLAY_WIDGET_LABELS.orders,
    tone: toneFromAlert(items.length > 0),
    emptyLabel: 'Aucune commande à suivre.',
    items: items.map(item => ({
      title: item.title,
      subtitle: [item.supplier, item.requester?.name].filter(Boolean).join(' · ') || 'Commande',
      meta: item.status,
      alert: item.status === 'PENDING' || item.status === 'PARTIAL'
    }))
  };
}

async function buildUpcomingLoansWidget(screen) {
  const now = new Date();
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const items = (await fetchUpcomingLoanReservations(now, 32))
    .filter(item => new Date(item.startAt) <= end)
    .slice(0, 8);

  return {
    id: 'upcomingLoans',
    kind: 'list',
    title: DISPLAY_WIDGET_LABELS.upcomingLoans,
    tone: toneFromAlert(items.some(item => isLoanAlert(item.startAt, now, screen?.openingHour))),
    emptyLabel: 'Aucune réservation prévue sur 14 jours.',
    items: items.map(item => ({
      title: item.resource?.name || 'Ressource',
      subtitle: [item.requesterName, item.requesterOrganization].filter(Boolean).join(' · '),
      meta: `${formatCalendarDate(item.startAt)} → ${formatCalendarDate(item.endAt)}`,
      alert: isLoanAlert(item.startAt, now, screen?.openingHour)
    }))
  };
}

function isCalendarEntryAlert(entry, now, screen) {
  if (entry.sourceType === 'loan') {
    return isLoanAlert(entry.startAt, now, screen?.openingHour);
  }

  if (entry.entryType === 'due') {
    const dayKey = getParisDayKey(entry.startAt);
    return ['OPEN', 'IN_PROGRESS'].includes(entry.status) && dayKey <= getParisDayKey(now);
  }

  return false;
}

async function buildGlobalCalendarWidget(screen) {
  const now = new Date();
  const startAt = new Date(now);
  startAt.setHours(0, 0, 0, 0);
  const endAt = new Date(startAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  const entries = await fetchGlobalCalendarEntries(prisma, { startAt, endAt });
  const limitedEntries = entries.slice(0, 18);
  const groups = new Map();

  limitedEntries.forEach(entry => {
    const dayKey = getParisDayKey(entry.startAt);
    if (!groups.has(dayKey)) {
      groups.set(dayKey, {
        dayKey,
        label: formatCalendarDayLabel(entry.startAt),
        items: []
      });
    }

    const subtitle = entry.sourceType === 'loan'
      ? [entry.requesterName, entry.requesterOrganization].filter(Boolean).join(' · ')
      : [formatRoomLabel(entry.room), entry.equipment?.name].filter(Boolean).join(' · ');
    const metaPrefix = entry.entryType === 'due'
      ? `Due ${formatCalendarTime(entry.startAt)}`
      : `${formatCalendarTime(entry.startAt)} → ${formatCalendarTime(entry.endAt)}`;

    groups.get(dayKey).items.push({
      title: entry.sourceType === 'loan'
        ? `Prêt · ${entry.title}`
        : `${entry.entryType === 'due' ? 'Échéance' : 'Intervention'} · ${entry.title}`,
      subtitle: subtitle || (entry.sourceType === 'loan' ? 'Réservation' : 'Intervention planifiée'),
      meta: [metaPrefix, entry.sourceType === 'loan' ? (entry.status === 'APPROVED' ? 'Approuvé' : 'En attente') : formatInterventionStatus(entry.status)].filter(Boolean).join(' · '),
      alert: isCalendarEntryAlert(entry, now, screen)
    });
  });

  const dayGroups = [...groups.values()].slice(0, 8);

  return {
    id: 'globalCalendar',
    kind: 'calendar',
    title: DISPLAY_WIDGET_LABELS.globalCalendar,
    tone: toneFromAlert(dayGroups.some(group => group.items.some(item => item.alert))),
    emptyLabel: 'Aucun événement planifié sur les 14 prochains jours.',
    groups: dayGroups
  };
}

const WIDGET_BUILDERS = {
  overview: buildOverviewWidget,
  interventions: buildInterventionsWidget,
  repairs: buildRepairsWidget,
  stockAlerts: buildStockAlertsWidget,
  pendingAgents: buildPendingAgentsWidget,
  orders: buildOrdersWidget,
  upcomingLoans: buildUpcomingLoansWidget,
  globalCalendar: buildGlobalCalendarWidget
};

router.get('/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    const screens = normalizeDisplayScreens(readSettings().displayScreens);
    const screen = screens.find(item => item.token === token);

    if (!screen) {
      return res.status(404).json({ error: 'Écran introuvable' });
    }

    const widgets = await Promise.all(
      screen.widgets
        .map(widgetId => WIDGET_BUILDERS[widgetId])
        .filter(Boolean)
        .map(builder => builder(screen))
    );
    const renderedWidgets = widgets.map(widget => applyAlertsPreference(widget, screen.alertsEnabled !== false));
    const orderedWidgets = screen.layoutMode === 'MANUAL'
      ? (screen.widgetLayouts || []).map(layout => renderedWidgets.find(widget => widget.id === layout.id)).filter(Boolean)
      : renderedWidgets.slice().sort(compareAutoWidgets);
    const widgetsWithLayout = orderedWidgets.map(widget => ({
      ...widget,
      layout: getWidgetLayout(widget, screen)
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      screen: {
        id: screen.id,
        name: screen.name,
        alertsEnabled: screen.alertsEnabled !== false,
        layoutMode: screen.layoutMode,
        presentationMode: screen.presentationMode || 'GRID',
        rotationSeconds: screen.rotationSeconds || 15,
        refreshSeconds: screen.refreshSeconds,
        widgets: screen.widgets
      },
      generatedAt: new Date().toISOString(),
      alertCount: widgetsWithLayout.filter(widget => widget.tone === 'alert').length,
      widgets: widgetsWithLayout
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
