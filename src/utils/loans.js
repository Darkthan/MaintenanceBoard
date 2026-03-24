const { readSettings, writeSettings } = require('./settings');

const ACTIVE_LOAN_STATUSES = ['PENDING', 'APPROVED'];

function toPositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
}

function getBundleInfo(resource) {
  const totalUnits = toPositiveInt(resource?.totalUnits, 1);
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
  getBundleInfo,
  computeReservedSlots,
  overlaps,
  getCalendarFeedToken,
  escapeIcsText,
  toIcsDate
};
