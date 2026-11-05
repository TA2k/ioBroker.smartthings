'use strict';

// Node.js timers overflow above 2^31 - 1 milliseconds.
const MAX_INTERVAL_SECONDS = Math.floor((2 ** 31 - 1) / 1000);

/**
 * @param {unknown} value Configured interval in seconds.
 * @returns {number} A finite interval of at least one second.
 */
function normalizePollingInterval(value) {
  const number = parseIntervalNumber(value);
  return Number.isFinite(number) ? Math.min(MAX_INTERVAL_SECONDS, Math.max(1, number)) : 10;
}

/**
 * @param {unknown} value Additional interval in seconds (0 disables it).
 * @returns {number} A finite nonnegative interval.
 */
function normalizeVirtualInterval(value) {
  const number = parseIntervalNumber(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(1, number));
}

/**
 * @param {unknown} value Configured value.
 * @returns {number} Number or NaN for blank/invalid inputs.
 */
function parseIntervalNumber(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    return Number(value);
  }
  return NaN;
}

/**
 * @param {unknown} value Comma-separated exclusion entries.
 * @returns {string[]} Cleaned entries, or an empty list for legacy settings.
 */
function parseExclusionList(value) {
  return typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

/**
 * @param {unknown} value Serialized legacy session state.
 * @returns {object|null} Valid session data, or null without throwing.
 */
function parseStoredSession(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  try {
    const session = JSON.parse(value);
    return session && typeof session === 'object' && !Array.isArray(session) &&
      typeof session.refresh_token === 'string' && session.refresh_token.length > 0 ? session : null;
  } catch {
    return null;
  }
}

/**
 * Never interpolate an Axios error or response body into logs: request
 * headers, query parameters and server responses may contain credentials.
 *
 * @param {unknown} error An HTTP or other request error.
 * @returns {string} A non-sensitive diagnosis.
 */
function formatRequestError(error) {
  if (error && typeof error === 'object') {
    /** @type {{ response?: { status?: number }, code?: unknown }} */
    const safeError = error;
    const status = safeError.response && safeError.response.status;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return `HTTP ${status}`;
    }
    if (typeof safeError.code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(safeError.code)) {
      return `Request failed (${safeError.code})`;
    }
  }
  return 'Request failed (details omitted)';
}

module.exports = {
  normalizePollingInterval,
  normalizeVirtualInterval,
  parseExclusionList,
  parseStoredSession,
  formatRequestError,
};
