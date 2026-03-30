const { randomUUID } = require('crypto');

const DISPLAY_WIDGET_OPTIONS = [
  {
    id: 'overview',
    label: 'Vue d’ensemble',
    description: 'Compteurs globaux et alertes principales.',
    alert: true
  },
  {
    id: 'interventions',
    label: 'Interventions ouvertes',
    description: 'Tickets en cours à traiter.',
    alert: true
  },
  {
    id: 'repairs',
    label: 'Équipements en réparation',
    description: 'Matériels actuellement en panne.',
    alert: true
  },
  {
    id: 'stockAlerts',
    label: 'Stock bas',
    description: 'Consommables sous le seuil minimal.',
    alert: true
  },
  {
    id: 'pendingAgents',
    label: 'Agents à valider',
    description: 'Équipements détectés en attente de confirmation.',
    alert: true
  },
  {
    id: 'orders',
    label: 'Commandes à suivre',
    description: 'Dernières commandes non terminées.',
    alert: true
  },
  {
    id: 'upcomingLoans',
    label: 'Prêts à venir',
    description: 'Réservations prévues sur les 14 prochains jours.',
    alert: false
  }
];

const DISPLAY_WIDGET_LABELS = Object.fromEntries(DISPLAY_WIDGET_OPTIONS.map(widget => [widget.id, widget.label]));
const DISPLAY_WIDGET_IDS = new Set(DISPLAY_WIDGET_OPTIONS.map(widget => widget.id));
const DISPLAY_WIDGET_SIZE_OPTIONS = [
  { id: 'compact', label: 'Compact' },
  { id: 'wide', label: 'Large' },
  { id: 'hero', label: 'Hero' }
];
const DISPLAY_WIDGET_SIZE_LABELS = Object.fromEntries(DISPLAY_WIDGET_SIZE_OPTIONS.map(size => [size.id, size.label]));
const DISPLAY_WIDGET_SIZE_IDS = new Set(DISPLAY_WIDGET_SIZE_OPTIONS.map(size => size.id));
const DISPLAY_LAYOUT_OPTIONS = [
  { id: 'AUTO', label: 'Auto' },
  { id: 'MANUAL', label: 'Manuel' }
];
const DISPLAY_LAYOUT_IDS = new Set(DISPLAY_LAYOUT_OPTIONS.map(layout => layout.id));
const DISPLAY_DEFAULT_WIDGETS = ['overview', 'interventions', 'repairs', 'stockAlerts'];
const DISPLAY_DEFAULT_LAYOUT_MODE = 'AUTO';
const DISPLAY_DEFAULT_REFRESH_SECONDS = 30;
const DISPLAY_DEFAULT_OPENING_HOUR = '08:00';
const DISPLAY_DEFAULT_WIDGET_LAYOUTS = [
  { id: 'overview', size: 'hero' },
  { id: 'interventions', size: 'wide' },
  { id: 'repairs', size: 'wide' },
  { id: 'stockAlerts', size: 'compact' }
];

function createDisplayError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeOpeningHour(value, fallback = DISPLAY_DEFAULT_OPENING_HOUR) {
  const text = String(value ?? fallback ?? DISPLAY_DEFAULT_OPENING_HOUR).trim();
  if (!/^\d{2}:\d{2}$/.test(text)) {
    throw createDisplayError("L'heure d'ouverture doit être au format HH:MM.");
  }

  const [hours, minutes] = text.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw createDisplayError("L'heure d'ouverture doit être comprise entre 00:00 et 23:59.");
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeDisplayWidgets(rawWidgets) {
  const list = Array.isArray(rawWidgets)
    ? rawWidgets
    : rawWidgets == null
      ? []
      : [rawWidgets];

  return [...new Set(
    list
      .map(widget => String(widget || '').trim())
      .filter(widget => DISPLAY_WIDGET_IDS.has(widget))
  )];
}

function getDefaultWidgetLayout(widgetId) {
  return DISPLAY_DEFAULT_WIDGET_LAYOUTS.find(layout => layout.id === widgetId) || { id: widgetId, size: 'compact' };
}

function normalizeWidgetLayouts(rawLayouts, fallbackWidgets = []) {
  const source = Array.isArray(rawLayouts) && rawLayouts.length
    ? rawLayouts
    : normalizeDisplayWidgets(fallbackWidgets).map(widgetId => getDefaultWidgetLayout(widgetId));

  const layouts = [];
  const seen = new Set();

  source.forEach(item => {
    const id = typeof item === 'string' ? item.trim() : String(item?.id || '').trim();
    if (!DISPLAY_WIDGET_IDS.has(id) || seen.has(id)) return;
    const size = typeof item === 'object' && DISPLAY_WIDGET_SIZE_IDS.has(item?.size) ? item.size : getDefaultWidgetLayout(id).size;
    seen.add(id);
    layouts.push({ id, size });
  });

  return layouts;
}

function normalizeDisplayScreens(rawScreens) {
  if (!Array.isArray(rawScreens)) return [];

  return rawScreens
    .map(screen => {
      if (!screen || typeof screen !== 'object') return null;
      const widgetLayouts = normalizeWidgetLayouts(screen.widgetLayouts, screen.widgets);
      const widgets = widgetLayouts.map(layout => layout.id);
      const name = String(screen.name || '').trim();
      const token = String(screen.token || '').trim();
      const id = String(screen.id || '').trim();
      if (!id || !name || !token || !widgets.length) return null;

      const refreshValue = Number(screen.refreshSeconds);
      return {
        id,
        name,
        token,
        widgets,
        widgetLayouts,
        layoutMode: DISPLAY_LAYOUT_IDS.has(screen.layoutMode) ? screen.layoutMode : DISPLAY_DEFAULT_LAYOUT_MODE,
        alertsEnabled: screen.alertsEnabled !== false,
        openingHour: normalizeOpeningHour(screen.openingHour, DISPLAY_DEFAULT_OPENING_HOUR),
        refreshSeconds: Number.isFinite(refreshValue) ? Math.max(15, Math.min(3600, Math.round(refreshValue))) : DISPLAY_DEFAULT_REFRESH_SECONDS,
        createdAt: screen.createdAt || null,
        updatedAt: screen.updatedAt || null
      };
    })
    .filter(Boolean);
}

function normalizeDisplayScreenInput(input = {}, current = {}) {
  const name = String(input.name ?? current.name ?? '').trim();
  if (!name) {
    throw createDisplayError('Le nom de l’écran est obligatoire.');
  }

  const refreshValue = Number(input.refreshSeconds ?? current.refreshSeconds ?? DISPLAY_DEFAULT_REFRESH_SECONDS);
  if (!Number.isFinite(refreshValue) || refreshValue < 15 || refreshValue > 3600) {
    throw createDisplayError('Le rafraîchissement doit être compris entre 15 et 3600 secondes.');
  }

  const openingHour = normalizeOpeningHour(
    input.openingHour !== undefined ? input.openingHour : current.openingHour,
    DISPLAY_DEFAULT_OPENING_HOUR
  );

  const widgets = normalizeDisplayWidgets(
    input.widgets !== undefined
      ? input.widgets
      : current.widgets !== undefined
        ? current.widgets
        : DISPLAY_DEFAULT_WIDGETS
  );
  const widgetLayouts = normalizeWidgetLayouts(
    input.widgetLayouts !== undefined
      ? input.widgetLayouts
      : current.widgetLayouts !== undefined
        ? current.widgetLayouts
        : widgets
  ).filter(layout => widgets.includes(layout.id));

  if (!widgets.length) {
    throw createDisplayError('Sélectionnez au moins un bloc à afficher.');
  }

  if (!widgetLayouts.length) {
    throw createDisplayError('Définissez l’agencement des blocs sélectionnés.');
  }

  const layoutMode = DISPLAY_LAYOUT_IDS.has(input.layoutMode)
    ? input.layoutMode
    : DISPLAY_LAYOUT_IDS.has(current.layoutMode)
      ? current.layoutMode
      : DISPLAY_DEFAULT_LAYOUT_MODE;

  return {
    name,
    layoutMode,
    alertsEnabled: input.alertsEnabled !== undefined ? !!input.alertsEnabled : current.alertsEnabled !== false,
    openingHour,
    refreshSeconds: Math.round(refreshValue),
    widgets: widgetLayouts.map(layout => layout.id),
    widgetLayouts
  };
}

function createDisplayScreen(input = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    token: randomUUID(),
    ...normalizeDisplayScreenInput(input),
    createdAt: now,
    updatedAt: now
  };
}

function updateDisplayScreen(current, input = {}) {
  return {
    ...current,
    ...normalizeDisplayScreenInput(input, current),
    updatedAt: new Date().toISOString()
  };
}

function regenerateDisplayScreenToken(current) {
  return {
    ...current,
    token: randomUUID(),
    updatedAt: new Date().toISOString()
  };
}

function buildDisplayPublicUrl(appUrl, token) {
  return `${String(appUrl || '').replace(/\/+$/, '')}/screen/${encodeURIComponent(token)}`;
}

function serializeDisplayScreen(screen, appUrl) {
  return {
    id: screen.id,
    name: screen.name,
    token: screen.token,
    alertsEnabled: screen.alertsEnabled !== false,
    openingHour: normalizeOpeningHour(screen.openingHour, DISPLAY_DEFAULT_OPENING_HOUR),
    refreshSeconds: screen.refreshSeconds,
    layoutMode: screen.layoutMode || DISPLAY_DEFAULT_LAYOUT_MODE,
    widgets: screen.widgets,
    widgetLabels: screen.widgets.map(widgetId => DISPLAY_WIDGET_LABELS[widgetId] || widgetId),
    widgetLayouts: screen.widgetLayouts.map(layout => ({
      id: layout.id,
      label: DISPLAY_WIDGET_LABELS[layout.id] || layout.id,
      size: layout.size,
      sizeLabel: DISPLAY_WIDGET_SIZE_LABELS[layout.size] || layout.size
    })),
    publicUrl: buildDisplayPublicUrl(appUrl, screen.token),
    createdAt: screen.createdAt,
    updatedAt: screen.updatedAt
  };
}

module.exports = {
  DISPLAY_WIDGET_OPTIONS,
  DISPLAY_WIDGET_LABELS,
  DISPLAY_WIDGET_SIZE_OPTIONS,
  DISPLAY_WIDGET_SIZE_LABELS,
  DISPLAY_LAYOUT_OPTIONS,
  DISPLAY_DEFAULT_WIDGETS,
  DISPLAY_DEFAULT_LAYOUT_MODE,
  DISPLAY_DEFAULT_REFRESH_SECONDS,
  DISPLAY_DEFAULT_OPENING_HOUR,
  normalizeDisplayScreens,
  normalizeDisplayScreenInput,
  createDisplayScreen,
  updateDisplayScreen,
  regenerateDisplayScreenToken,
  serializeDisplayScreen
};
