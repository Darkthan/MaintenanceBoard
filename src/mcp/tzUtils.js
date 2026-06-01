'use strict';

const PARIS_TZ = 'Europe/Paris';

/**
 * Converts a local date + time to a UTC Date.
 *
 * Algorithm: treat the local values as UTC to get a reference point, then compute
 * the actual UTC offset by formatting that reference in the target timezone, and
 * apply the offset in reverse.
 *
 * Works with Node.js ≥18 (full ICU included by default since v13).
 *
 * @param {string} dateStr  "YYYY-MM-DD"
 * @param {string} timeStr  "HH:MM" or "HH:MM:SS"
 * @param {string} timezone IANA timezone name (e.g. "Europe/Paris")
 * @returns {Date} UTC Date
 */
function localDateTimeToUTC(dateStr, timeStr, timezone = PARIS_TZ) {
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;

  // Step 1: build a Date treating the local values as if they were UTC
  const naiveUTC = new Date(`${dateStr}T${time}Z`);
  if (isNaN(naiveUTC.getTime())) {
    throw Object.assign(new Error(`Date/heure invalide : ${dateStr} ${timeStr}`), { status: 400 });
  }

  // Step 2: ask Intl what that UTC instant looks like in the target timezone
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    })
      .formatToParts(naiveUTC)
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, p.value])
  );
  const h = parts.hour === '24' ? '00' : parts.hour;
  const localAtThatUTC = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${h}:${parts.minute}:${parts.second}Z`
  );

  // Step 3: offset = naiveUTC − localAtThatUTC
  //         result  = naiveUTC + offset  (= 2×naiveUTC − localAtThatUTC)
  //
  // Example (Paris UTC+2, local 09:00):
  //   naiveUTC      = T09:00Z
  //   localAtThatUTC = T11:00Z  (09:00 UTC → 11:00 Paris)
  //   offset        = −7200000 ms
  //   result        = T07:00Z   ✓  (09:00 Paris = 07:00 UTC)
  return new Date(2 * naiveUTC.getTime() - localAtThatUTC.getTime());
}

/**
 * Formats a UTC Date as a local ISO-like string (no offset suffix).
 * e.g. "2024-01-15T09:00:00"
 *
 * @param {Date|string} utcDate
 * @param {string} timezone
 * @returns {string|null}
 */
function utcToLocal(utcDate, timezone = PARIS_TZ) {
  const d = utcDate instanceof Date ? utcDate : new Date(utcDate);
  if (isNaN(d.getTime())) return null;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    })
      .formatToParts(d)
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, p.value])
  );
  const h = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${h}:${parts.minute}:${parts.second}`;
}

/**
 * Returns true if the ISO string already contains timezone information.
 */
function hasTimezoneInfo(isoStr) {
  if (!isoStr || typeof isoStr !== 'string') return false;
  return /[Zz]$/.test(isoStr) || /[+-]\d{2}:\d{2}$/.test(isoStr) || /[+-]\d{4}$/.test(isoStr);
}

/**
 * Normalises an ISO datetime string to a UTC Date.
 * If no timezone offset is present, interprets as local time in `timezone`.
 *
 * @param {string} isoStr
 * @param {string} timezone  Default: Europe/Paris
 * @returns {Date}
 */
function normalizeToUTC(isoStr, timezone = PARIS_TZ) {
  if (!isoStr) return null;
  if (hasTimezoneInfo(isoStr)) return new Date(isoStr);

  const tIdx = isoStr.indexOf('T');
  if (tIdx === -1) {
    // Date-only → midnight local
    return localDateTimeToUTC(isoStr, '00:00:00', timezone);
  }
  return localDateTimeToUTC(isoStr.slice(0, tIdx), isoStr.slice(tIdx + 1), timezone);
}

/**
 * Validates a timezone string against the Intl API.
 * Returns the original string if valid, or `PARIS_TZ` as fallback.
 *
 * @param {string|undefined} tz
 * @returns {string}
 */
function validateTimezone(tz) {
  if (!tz) return PARIS_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return PARIS_TZ;
  }
}

/**
 * Parses booking date inputs from MCP tool arguments.
 *
 * Supports two modes (structured mode preferred):
 *   1. Structured  : { date, startTime, [endDate], endTime, [timezone] }
 *   2. Legacy ISO  : { startAt, endAt, [timezone] }
 *
 * In both modes, any datetime without an explicit offset is interpreted in
 * `timezone` (default Europe/Paris) and converted to UTC.
 *
 * @param {object} input  MCP tool arguments
 * @returns {{ start: Date, end: Date, timezone: string }}
 */
function parseDateInput(input) {
  const tz = validateTimezone(input.timezone);

  // ── Structured mode ──────────────────────────────────────────────────────
  if (input.date && input.startTime && input.endTime) {
    const startDate = input.date;
    const endDate = input.endDate || input.date;

    const start = localDateTimeToUTC(startDate, input.startTime, tz);
    const end = localDateTimeToUTC(endDate, input.endTime, tz);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw Object.assign(
        new Error('Date ou heure invalide dans les paramètres de réservation.'),
        { status: 400 }
      );
    }
    if (end <= start) {
      throw Object.assign(
        new Error("L'heure de fin doit être après l'heure de début."),
        { status: 400 }
      );
    }
    return { start, end, timezone: tz };
  }

  // ── Legacy ISO mode ──────────────────────────────────────────────────────
  if (input.startAt || input.endAt) {
    const start = normalizeToUTC(input.startAt, tz);
    const end = normalizeToUTC(input.endAt, tz);

    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw Object.assign(
        new Error('Les dates de prêt sont invalides (format ISO 8601 attendu).'),
        { status: 400 }
      );
    }
    if (end <= start) {
      throw Object.assign(
        new Error('La date de fin doit être postérieure à la date de début.'),
        { status: 400 }
      );
    }
    return { start, end, timezone: tz };
  }

  throw Object.assign(
    new Error(
      'Paramètres de date manquants. ' +
      'Utilisez date + startTime + endTime (recommandé) ou startAt + endAt.'
    ),
    { status: 400 }
  );
}

module.exports = {
  PARIS_TZ,
  localDateTimeToUTC,
  utcToLocal,
  hasTimezoneInfo,
  normalizeToUTC,
  validateTimezone,
  parseDateInput
};
