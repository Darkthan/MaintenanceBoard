const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const prisma = require('../lib/prisma');
const {
  normalizeAlertRules,
  getSupervisionSettings,
  saveSupervisionSettings,
  buildSupervisionSnapshot,
  isPushConfigured,
  getPushConfig
} = require('../utils/supervision');
const { readSettings, writeSettings } = require('../utils/settings');

router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const settings = getSupervisionSettings();
    const equipment = await prisma.equipment.findMany({
      where: { agentInfo: { not: null } },
      select: {
        id: true,
        name: true,
        type: true,
        agentHostname: true,
        agentInfo: true,
        lastSeenAt: true
      },
      orderBy: { lastSeenAt: 'desc' }
    });

    res.json({
      ...buildSupervisionSnapshot(equipment, settings),
      settings: {
        alertRules: settings.alertRules,
        pushEnabled: settings.pushEnabled,
        pushConfigured: isPushConfigured(),
        vapidPublicKey: getPushConfig().publicKey
      }
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/settings', requireAuth, requireAdmin, (req, res) => {
  const current = getSupervisionSettings();
  const patch = {};

  if (req.body.alertRules !== undefined) {
    patch.alertRules = normalizeAlertRules(req.body.alertRules);
  }
  if (req.body.pushEnabled !== undefined) {
    patch.pushEnabled = !!req.body.pushEnabled;
  }

  const settings = saveSupervisionSettings({
    ...patch,
    alertState: current.alertState
  });
  res.json({ message: 'Paramètres de supervision enregistrés', settings });
});

router.post('/push-subscriptions', requireAuth, (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Abonnement push invalide' });
  }

  const settings = readSettings();
  const supervision = settings.supervision || {};
  const subscriptions = Array.isArray(supervision.pushSubscriptions) ? supervision.pushSubscriptions : [];
  const nextSubscriptions = subscriptions.filter(item => item.endpoint !== subscription.endpoint);
  nextSubscriptions.push(subscription);

  writeSettings({
    supervision: {
      ...supervision,
      pushSubscriptions: nextSubscriptions.slice(-200)
    }
  });

  res.status(201).json({ message: 'Notifications supervision activées' });
});

router.delete('/push-subscriptions', requireAuth, (req, res) => {
  const endpoint = req.body?.endpoint;
  const settings = readSettings();
  const supervision = settings.supervision || {};
  const subscriptions = Array.isArray(supervision.pushSubscriptions) ? supervision.pushSubscriptions : [];
  const nextSubscriptions = endpoint ? subscriptions.filter(item => item.endpoint !== endpoint) : subscriptions;

  writeSettings({
    supervision: {
      ...supervision,
      pushSubscriptions: nextSubscriptions
    }
  });

  res.json({ message: 'Abonnement supprimé' });
});

module.exports = router;
