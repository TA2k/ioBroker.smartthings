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
  // Preserve the historic exclusion matching semantics (all ASCII spaces
  // are removed, even inside entries) for existing adapter configurations.
  return typeof value === 'string' ? value.replace(/ /g, '').split(',').filter(Boolean) : [];
}

/**
 * @param {unknown} value Raw polling interval.
 * @returns {boolean} True if the value requires a safety fallback or clamp.
 */
function isPollingIntervalAdjusted(value) {
  const number = parseIntervalNumber(value);
  return !Number.isFinite(number) || number < 1 || number > MAX_INTERVAL_SECONDS;
}

/**
 * @param {unknown} value Token lifetime in seconds.
 * @returns {number} Bounded lifetime in seconds, defaulting to one day.
 */
function normalizeSessionExpiry(value) {
  const seconds = parseIntervalNumber(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 86400;
  }
  return Math.max(60, Math.min(MAX_INTERVAL_SECONDS, Math.floor(seconds)));
}

/**
 * Schedule a refresh before the access token expires. Short-lived tokens
 * use half their remaining lifetime rather than a fixed five-minute buffer.
 * @param {unknown} value Session expiry in seconds.
 * @returns {number} Safe Node.js timeout delay in milliseconds.
 */
function getTokenRefreshDelayMs(value) {
  const seconds = normalizeSessionExpiry(value);
  return (seconds - Math.min(300, Math.floor(seconds / 2))) * 1000;
}

/**
 * @param {unknown} value Potential SmartThings access token.
 * @returns {value is string} Whether the response contains a nonblank token.
 */
function hasAccessToken(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Preserve the previous refresh token if Samsung rotates only the access
 * token. Do not overwrite a valid session with a malformed token response.
 * @param {{ refresh_token?: unknown, access_token?: unknown, expires_in?: unknown }} previous Existing session.
 * @param {unknown} incoming SmartThings refresh response body.
 * @returns {{ access_token: string, refresh_token: string, expires_in?: unknown }|null} Safe merged session or null on invalid responses.
 */
function mergeRefreshedSession(previous, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return null;
  }
  /** @type {{ access_token?: unknown, refresh_token?: unknown, expires_in?: unknown }} */
  const tokens = incoming;
  const accessToken = tokens.access_token;
  if (!hasAccessToken(accessToken)) {
    return null;
  }
  const oldRefreshToken = previous && typeof previous.refresh_token === 'string' ? previous.refresh_token : '';
  const newRefreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token : oldRefreshToken;
  if (!newRefreshToken) {
    return null;
  }
  return { ...previous, ...tokens, access_token: accessToken, refresh_token: newRefreshToken };
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
    const safeError = /** @type {{ response?: { status?: number }, code?: unknown }} */ (error);
    const status = safeError.response && safeError.response.status;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return `HTTP ${status}`;
    }
    // Only fixed network error identifiers are safe to reproduce verbatim.
    const safeCodes = ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
      'ERR_NETWORK', 'ERR_CANCELED', 'ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE'];
    if (typeof safeError.code === 'string' && safeCodes.includes(safeError.code)) {
      return `Request failed (${safeError.code})`;
    }
  }
  return 'Request failed (details omitted)';
}

module.exports = {
  normalizePollingInterval,
  normalizeVirtualInterval,
  isPollingIntervalAdjusted,
  normalizeSessionExpiry,
  getTokenRefreshDelayMs,
  hasAccessToken,
  mergeRefreshedSession,
  parseExclusionList,
  parseStoredSession,
  formatRequestError,
};
