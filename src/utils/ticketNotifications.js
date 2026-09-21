const webpush = require('web-push');
const { readSettings, writeSettings } = require('./settings');
const { getPushConfig, isPushConfigured } = require('./supervision');

function parsePushSubscription(value) {
  if (!value) return null;
  try {
    const subscription = typeof value === 'string' ? JSON.parse(value) : value;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return null;
    return {
      endpoint: String(subscription.endpoint),
      expirationTime: subscription.expirationTime || null,
      keys: {
        p256dh: String(subscription.keys.p256dh),
        auth: String(subscription.keys.auth)
      }
    };
  } catch {
    return null;
  }
}

async function sendBrowserPush(subscriptionValue, payload) {
  const subscription = parsePushSubscription(subscriptionValue);
  if (!subscription || !isPushConfigured()) return { sent: false, expired: false };

  const config = getPushConfig();
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { sent: true, expired: false };
  } catch (error) {
    return { sent: false, expired: [404, 410].includes(error.statusCode) };
  }
}

async function notifyAdminsOfNewTicket(ticket) {
  const settings = readSettings();
  const ticketNotifications = settings.ticketNotifications || {};
  const subscriptions = Array.isArray(ticketNotifications.adminPushSubscriptions)
    ? ticketNotifications.adminPushSubscriptions.map(parsePushSubscription).filter(Boolean)
    : [];
  if (!subscriptions.length) return { sent: 0 };

  const payload = {
    title: 'Nouvelle demande d’intervention',
    body: String(ticket.title || 'Une nouvelle demande a été créée.').slice(0, 180),
    url: `/messages-ticket.html?id=${encodeURIComponent(ticket.id)}`,
    tag: `ticket-new-${ticket.id}`
  };

  let sent = 0;
  const alive = [];
  for (const subscription of subscriptions) {
    const result = await sendBrowserPush(subscription, payload);
    if (result.sent) sent += 1;
    if (!result.expired) alive.push(subscription);
  }

  if (alive.length !== subscriptions.length) {
    writeSettings({
      ticketNotifications: {
        ...ticketNotifications,
        adminPushSubscriptions: alive
      }
    });
  }

  return { sent };
}

module.exports = {
  notifyAdminsOfNewTicket,
  parsePushSubscription,
  sendBrowserPush
};
