const crypto = require('crypto');
const webpush = require('web-push');
const config = require('../config');
const { readSettings, writeSettings } = require('./settings');

const RULE_METRICS = ['latencyMs', 'httpStatus'];
const RULE_OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq', 'ne'];

function parseAgentInfo(agentInfo) {
  if (!agentInfo) return {};
  if (typeof agentInfo === 'object') return agentInfo;
  try { return JSON.parse(agentInfo); } catch { return {}; }
}

function stableId(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 16);
}

function normalizeAlertRule(input = {}) {
  const metric = RULE_METRICS.includes(input.metric) ? input.metric : 'latencyMs';
  const operator = RULE_OPERATORS.includes(input.operator) ? input.operator : 'gt';
  const threshold = Number(input.threshold);
  if (!Number.isFinite(threshold)) return null;

  const id = input.id || stableId(`${input.label || ''}|${input.equipmentType || ''}|${input.harvestName || ''}|${metric}|${operator}|${threshold}`);
  return {
    id,
    label: String(input.label || 'Règle de supervision').slice(0, 120),
    enabled: input.enabled !== false,
    equipmentType: String(input.equipmentType || '').trim().slice(0, 80),
    harvestName: String(input.harvestName || '').trim().slice(0, 120),
    metric,
    operator,
    threshold,
    severity: ['NORMAL', 'HIGH', 'CRITICAL'].includes(input.severity) ? input.severity : 'HIGH'
  };
}

function normalizeAlertRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map(normalizeAlertRule).filter(Boolean).slice(0, 100);
}

function compare(value, operator, threshold) {
  if (!Number.isFinite(Number(value))) return false;
  const current = Number(value);
  if (operator === 'gt') return current > threshold;
  if (operator === 'gte') return current >= threshold;
  if (operator === 'lt') return current < threshold;
  if (operator === 'lte') return current <= threshold;
  if (operator === 'eq') return current === threshold;
  if (operator === 'ne') return current !== threshold;
  return false;
}

function getSupervisionSettings() {
  const saved = readSettings().supervision || {};
  return {
    alertRules: normalizeAlertRules(saved.alertRules),
    alertState: saved.alertState && typeof saved.alertState === 'object' ? saved.alertState : {},
    pushEnabled: saved.pushEnabled !== false
  };
}

function saveSupervisionSettings(patch) {
  const current = readSettings().supervision || {};
  const next = {
    ...current,
    ...patch
  };
  if (patch.alertRules) next.alertRules = normalizeAlertRules(patch.alertRules);
  writeSettings({ supervision: next });
  return getSupervisionSettings();
}

function getHarvestLabel(harvest) {
  return [harvest.equipmentName, harvest.name || harvest.target || 'Récolte'].filter(Boolean).join(' - ');
}

function harvestMatchesRule(harvest, equipment, rule) {
  const equipmentType = harvest.equipmentType || equipment.type || '';
  if (rule.equipmentType && String(equipmentType).toLowerCase() !== rule.equipmentType.toLowerCase()) {
    return false;
  }
  if (rule.harvestName && String(harvest.name || '').toLowerCase() !== rule.harvestName.toLowerCase()) {
    return false;
  }
  return true;
}

function evaluateHarvestAlerts(equipment, agentInfo, settings = getSupervisionSettings()) {
  const harvests = Array.isArray(agentInfo?.harvests) ? agentInfo.harvests : [];
  const alerts = [];

  for (const harvest of harvests) {
    const label = getHarvestLabel(harvest);
    if (harvest.status === 'DOWN') {
      alerts.push({
        key: stableId(`${equipment.id}|down|${label}`),
        type: 'DOWN',
        title: `Supervision indisponible - ${label}`,
        message: harvest.message || `${label} est indisponible.`,
        severity: 'HIGH',
        harvest,
        equipment
      });
    }

    for (const rule of settings.alertRules) {
      if (!rule.enabled || !harvestMatchesRule(harvest, equipment, rule)) continue;
      if (!compare(harvest[rule.metric], rule.operator, rule.threshold)) continue;
      alerts.push({
        key: stableId(`${equipment.id}|rule|${rule.id}|${label}`),
        type: 'RULE',
        rule,
        title: `Limite supervision dépassée - ${label}`,
        message: `${rule.label}: ${rule.metric}=${harvest[rule.metric]} (${rule.operator} ${rule.threshold})`,
        severity: rule.severity,
        harvest,
        equipment
      });
    }
  }

  return alerts;
}

function buildSupervisionSnapshot(equipmentList, settings = getSupervisionSettings()) {
  const harvests = [];
  const groups = {};

  for (const equipment of equipmentList || []) {
    const agentInfo = parseAgentInfo(equipment.agentInfo);
    for (const harvest of Array.isArray(agentInfo.harvests) ? agentInfo.harvests : []) {
      const item = {
        id: stableId(`${equipment.id}|${getHarvestLabel(harvest)}|${harvest.target || ''}`),
        equipmentId: equipment.id,
        equipmentName: harvest.equipmentName || equipment.name,
        equipmentType: harvest.equipmentType || equipment.type || 'Autre',
        pullerName: equipment.agentHostname || equipment.name,
        name: harvest.name || harvest.target || 'Récolte',
        type: harvest.type || 'HTTPS',
        target: harvest.target || '',
        status: harvest.status || 'DOWN',
        httpStatus: harvest.httpStatus,
        latencyMs: harvest.latencyMs,
        checkedAt: harvest.checkedAt,
        message: harvest.message || ''
      };
      harvests.push(item);
      groups[item.equipmentType] = groups[item.equipmentType] || { type: item.equipmentType, total: 0, up: 0, down: 0, warn: 0 };
      groups[item.equipmentType].total += 1;
      if (item.status === 'UP') groups[item.equipmentType].up += 1;
      else if (item.status === 'WARN') groups[item.equipmentType].warn += 1;
      else groups[item.equipmentType].down += 1;
    }
  }

  const activeAlerts = [];
  for (const equipment of equipmentList || []) {
    activeAlerts.push(...evaluateHarvestAlerts(equipment, parseAgentInfo(equipment.agentInfo), settings));
  }

  return {
    summary: {
      total: harvests.length,
      up: harvests.filter(item => item.status === 'UP').length,
      down: harvests.filter(item => item.status === 'DOWN').length,
      warn: harvests.filter(item => item.status === 'WARN').length,
      alerts: activeAlerts.length
    },
    groups: Object.values(groups).sort((a, b) => a.type.localeCompare(b.type)),
    harvests: harvests.sort((a, b) => {
      const statusOrder = { DOWN: 0, WARN: 1, UP: 2 };
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || a.equipmentName.localeCompare(b.equipmentName);
    }),
    alerts: activeAlerts.map(alert => ({
      key: alert.key,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      equipmentName: alert.harvest.equipmentName || alert.equipment.name,
      harvestName: alert.harvest.name || alert.harvest.target || 'Récolte'
    }))
  };
}

function getPushConfig() {
  return {
    publicKey: config.push.vapidPublicKey || '',
    privateKey: config.push.vapidPrivateKey || '',
    subject: config.push.vapidSubject || `mailto:admin@${new URL(config.appUrl).hostname}`
  };
}

function isPushConfigured() {
  const pushConfig = getPushConfig();
  return !!(pushConfig.publicKey && pushConfig.privateKey);
}

async function notifySupervisionAlert(alert) {
  const settings = readSettings();
  const supervision = settings.supervision || {};
  const subscriptions = Array.isArray(supervision.pushSubscriptions) ? supervision.pushSubscriptions : [];
  if (!subscriptions.length || supervision.pushEnabled === false || !isPushConfigured()) return { sent: 0 };

  const pushConfig = getPushConfig();
  webpush.setVapidDetails(pushConfig.subject, pushConfig.publicKey, pushConfig.privateKey);

  const payload = JSON.stringify({
    title: alert.title,
    body: alert.message,
    url: '/supervision.html',
    tag: `supervision-${alert.key}`
  });

  let sent = 0;
  const aliveSubscriptions = [];
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload);
      sent += 1;
      aliveSubscriptions.push(subscription);
    } catch (err) {
      if (![404, 410].includes(err.statusCode)) aliveSubscriptions.push(subscription);
    }
  }

  if (aliveSubscriptions.length !== subscriptions.length) {
    writeSettings({
      supervision: {
        ...supervision,
        pushSubscriptions: aliveSubscriptions
      }
    });
  }

  return { sent };
}

async function notifyNewAlertsOnce(alerts) {
  const current = getSupervisionSettings();
  const now = new Date().toISOString();
  const nextState = { ...current.alertState };
  const activeKeys = new Set(alerts.map(alert => alert.key));
  let sent = 0;

  for (const alert of alerts) {
    if (nextState[alert.key]?.active) continue;
    nextState[alert.key] = { active: true, firstSeenAt: now, title: alert.title };
    const result = await notifySupervisionAlert(alert);
    sent += result.sent || 0;
  }

  for (const key of Object.keys(nextState)) {
    if (!activeKeys.has(key) && nextState[key]?.active) {
      nextState[key] = { ...nextState[key], active: false, recoveredAt: now };
    }
  }

  saveSupervisionSettings({ alertState: nextState });
  return { sent };
}

module.exports = {
  parseAgentInfo,
  normalizeAlertRules,
  getSupervisionSettings,
  saveSupervisionSettings,
  evaluateHarvestAlerts,
  buildSupervisionSnapshot,
  isPushConfigured,
  getPushConfig,
  notifyNewAlertsOnce
};
