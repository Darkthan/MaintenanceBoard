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
const DISPLAY_DEFAULT_WIDGETS = ['overview', 'interventions', 'repairs', 'stockAlerts'];
const DISPLAY_DEFAULT_REFRESH_SECONDS = 30;

function createDisplayError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
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

function normalizeDisplayScreens(rawScreens) {
  if (!Array.isArray(rawScreens)) return [];

  return rawScreens
    .map(screen => {
      if (!screen || typeof screen !== 'object') return null;
      const widgets = normalizeDisplayWidgets(screen.widgets);
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

  const widgets = normalizeDisplayWidgets(
    input.widgets !== undefined
      ? input.widgets
      : current.widgets !== undefined
        ? current.widgets
        : DISPLAY_DEFAULT_WIDGETS
  );

  if (!widgets.length) {
    throw createDisplayError('Sélectionnez au moins un bloc à afficher.');
  }

  return {
    name,
    refreshSeconds: Math.round(refreshValue),
    widgets
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
    refreshSeconds: screen.refreshSeconds,
    widgets: screen.widgets,
    widgetLabels: screen.widgets.map(widgetId => DISPLAY_WIDGET_LABELS[widgetId] || widgetId),
    publicUrl: buildDisplayPublicUrl(appUrl, screen.token),
    createdAt: screen.createdAt,
    updatedAt: screen.updatedAt
  };
}

module.exports = {
  DISPLAY_WIDGET_OPTIONS,
  DISPLAY_WIDGET_LABELS,
  DISPLAY_DEFAULT_WIDGETS,
  DISPLAY_DEFAULT_REFRESH_SECONDS,
  normalizeDisplayScreens,
  normalizeDisplayScreenInput,
  createDisplayScreen,
  updateDisplayScreen,
  regenerateDisplayScreenToken,
  serializeDisplayScreen
};
