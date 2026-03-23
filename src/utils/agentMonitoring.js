const LOW_DISK_TITLE_PREFIX = 'Espace disque faible - ';

function parseAgentAlertState(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeAgentAlertState(state) {
  if (!state || typeof state !== 'object') return null;
  if (!Object.keys(state).length) return null;
  return JSON.stringify(state);
}

function extractLowDiskMountFromTitle(title) {
  if (typeof title !== 'string' || !title.startsWith(LOW_DISK_TITLE_PREFIX)) return null;
  const mount = title.slice(LOW_DISK_TITLE_PREFIX.length).trim();
  return mount || null;
}

function isLowDiskSuppressed(state, mount) {
  return !!state?.lowDisk?.[mount]?.suppressed;
}

function suppressLowDiskAlert(state, mount, interventionId) {
  const next = parseAgentAlertState(state);
  next.lowDisk = next.lowDisk && typeof next.lowDisk === 'object' ? next.lowDisk : {};
  next.lowDisk[mount] = {
    suppressed: true,
    interventionId: interventionId || null,
    acknowledgedAt: new Date().toISOString()
  };
  return next;
}

function clearRecoveredLowDiskSuppressions(state, lowMounts) {
  const next = parseAgentAlertState(state);
  const current = next.lowDisk;
  if (!current || typeof current !== 'object') return { changed: false, state: next };

  let changed = false;
  for (const mount of Object.keys(current)) {
    if (lowMounts.has(mount)) continue;
    delete current[mount];
    changed = true;
  }

  if (changed && Object.keys(current).length === 0) {
    delete next.lowDisk;
  }

  return { changed, state: next };
}

module.exports = {
  LOW_DISK_TITLE_PREFIX,
  parseAgentAlertState,
  serializeAgentAlertState,
  extractLowDiskMountFromTitle,
  isLowDiskSuppressed,
  suppressLowDiskAlert,
  clearRecoveredLowDiskSuppressions
};
