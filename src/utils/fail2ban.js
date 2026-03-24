const net = require('net');

const FAIL2BAN_DEFAULTS = {
  enabled: false,
  maxAttempts: 5,
  windowMinutes: 15,
  blockMinutes: 60,
  whitelist: [],
  blacklist: [],
  blockedIps: [],
  failures: {}
};

function normalizeIp(value) {
  if (!value) return null;
  let ip = String(value).trim().replace(/^for=/i, '').replace(/^"|"$/g, '');
  if (!ip) return null;

  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.slice(1, ip.indexOf(']'));
  } else if (ip.includes('.') && ip.includes(':') && ip.indexOf(':') === ip.lastIndexOf(':')) {
    ip = ip.slice(0, ip.lastIndexOf(':'));
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  const version = net.isIP(ip);
  if (!version) return null;
  return version === 6 ? ip.toLowerCase() : ip;
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const [a, b, c] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const value = ip.toLowerCase();
  return value === '::1'
    || value === '::'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('fe8')
    || value.startsWith('fe9')
    || value.startsWith('fea')
    || value.startsWith('feb')
    || value.startsWith('2001:db8:');
}

function isPublicIp(value) {
  const ip = normalizeIp(value);
  if (!ip) return false;
  const version = net.isIP(ip);
  if (version === 4) return !isPrivateIpv4(ip);
  if (version === 6) return !isPrivateIpv6(ip);
  return false;
}

function extractPublicIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map(part => normalizeIp(part))
    .filter(Boolean);

  for (const candidate of forwarded) {
    if (isPublicIp(candidate)) return candidate;
  }

  const direct = normalizeIp(req.ip) || normalizeIp(req.socket?.remoteAddress);
  return isPublicIp(direct) ? direct : null;
}

function parseIpList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(/[\n\r,; ]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function normalizePublicIpList(value) {
  const unique = new Set();
  const invalid = [];

  for (const raw of parseIpList(value)) {
    const ip = normalizeIp(raw);
    if (!ip || !isPublicIp(ip)) {
      invalid.push(raw);
      continue;
    }
    unique.add(ip);
  }

  return {
    valid: [...unique],
    invalid
  };
}

function getFail2banState(saved = {}) {
  const blockedIps = Array.isArray(saved.blockedIps)
    ? saved.blockedIps
        .map(entry => {
          const ip = normalizeIp(entry?.ip);
          const blockedUntil = entry?.blockedUntil ? new Date(entry.blockedUntil).toISOString() : null;
          if (!ip || !blockedUntil || Number.isNaN(Date.parse(blockedUntil))) return null;
          return {
            ip,
            blockedUntil,
            reason: entry?.reason === 'blacklist' ? 'blacklist' : 'temporary',
            createdAt: entry?.createdAt ? new Date(entry.createdAt).toISOString() : new Date().toISOString()
          };
        })
        .filter(Boolean)
    : [];

  const failures = {};
  for (const [rawIp, timestamps] of Object.entries(saved.failures || {})) {
    const ip = normalizeIp(rawIp);
    if (!ip || !Array.isArray(timestamps)) continue;
    const validTimes = timestamps
      .map(ts => new Date(ts).toISOString())
      .filter(ts => !Number.isNaN(Date.parse(ts)));
    if (validTimes.length) failures[ip] = validTimes;
  }

  return {
    ...FAIL2BAN_DEFAULTS,
    ...saved,
    enabled: !!saved.enabled,
    maxAttempts: Number(saved.maxAttempts) || FAIL2BAN_DEFAULTS.maxAttempts,
    windowMinutes: Number(saved.windowMinutes) || FAIL2BAN_DEFAULTS.windowMinutes,
    blockMinutes: Number(saved.blockMinutes) || FAIL2BAN_DEFAULTS.blockMinutes,
    whitelist: normalizePublicIpList(saved.whitelist || []).valid,
    blacklist: normalizePublicIpList(saved.blacklist || []).valid,
    blockedIps,
    failures
  };
}

function pruneFail2banState(state, now = new Date()) {
  const cutoff = now.getTime() - state.windowMinutes * 60 * 1000;

  state.blockedIps = state.blockedIps.filter(entry => new Date(entry.blockedUntil).getTime() > now.getTime());

  for (const [ip, timestamps] of Object.entries(state.failures)) {
    const remaining = timestamps.filter(ts => new Date(ts).getTime() >= cutoff);
    if (remaining.length) {
      state.failures[ip] = remaining;
    } else {
      delete state.failures[ip];
    }
  }

  for (const ip of state.whitelist) {
    delete state.failures[ip];
    state.blockedIps = state.blockedIps.filter(entry => entry.ip !== ip);
  }
}

function getBlockStatus(state, ip, now = new Date()) {
  if (!ip) return { blocked: false };

  pruneFail2banState(state, now);

  if (state.whitelist.includes(ip)) {
    return { blocked: false, reason: 'whitelist' };
  }

  if (state.blacklist.includes(ip)) {
    return { blocked: true, reason: 'blacklist', ip };
  }

  const blocked = state.blockedIps.find(entry => entry.ip === ip);
  if (state.enabled && blocked) {
    return {
      blocked: true,
      reason: blocked.reason || 'temporary',
      ip,
      blockedUntil: blocked.blockedUntil
    };
  }

  return { blocked: false, ip };
}

function registerFailedAttempt(state, ip, now = new Date()) {
  if (!ip || !state.enabled || state.whitelist.includes(ip) || state.blacklist.includes(ip)) return;

  pruneFail2banState(state, now);

  const attempts = state.failures[ip] || [];
  attempts.push(now.toISOString());
  state.failures[ip] = attempts;

  if (attempts.length >= state.maxAttempts) {
    const blockedUntil = new Date(now.getTime() + state.blockMinutes * 60 * 1000).toISOString();
    state.blockedIps = state.blockedIps.filter(entry => entry.ip !== ip);
    state.blockedIps.push({
      ip,
      reason: 'temporary',
      createdAt: now.toISOString(),
      blockedUntil
    });
    delete state.failures[ip];
  }
}

function clearFailures(state, ip) {
  if (!ip) return;
  delete state.failures[ip];
}

function unblockIp(state, ip) {
  state.blockedIps = state.blockedIps.filter(entry => entry.ip !== ip);
  delete state.failures[ip];
}

function serializeFail2banForClient(saved = {}) {
  const state = getFail2banState(saved);
  pruneFail2banState(state);
  const blockedIps = [...state.blockedIps]
    .sort((a, b) => new Date(a.blockedUntil).getTime() - new Date(b.blockedUntil).getTime())
    .map(entry => ({
      ip: entry.ip,
      reason: entry.reason,
      blockedUntil: entry.blockedUntil,
      createdAt: entry.createdAt
    }));

  return {
    enabled: state.enabled,
    maxAttempts: state.maxAttempts,
    windowMinutes: state.windowMinutes,
    blockMinutes: state.blockMinutes,
    whitelist: state.whitelist,
    blacklist: state.blacklist,
    blockedIps,
    stats: {
      blockedCount: blockedIps.length,
      blacklistCount: state.blacklist.length,
      whitelistCount: state.whitelist.length
    }
  };
}

module.exports = {
  FAIL2BAN_DEFAULTS,
  normalizeIp,
  isPublicIp,
  extractPublicIp,
  normalizePublicIpList,
  getFail2banState,
  pruneFail2banState,
  getBlockStatus,
  registerFailedAttempt,
  clearFailures,
  unblockIp,
  serializeFail2banForClient
};
