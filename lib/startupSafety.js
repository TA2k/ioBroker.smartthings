'use strict';

/**
 * Normalize the regular polling interval. Empty/invalid values must not
 * create a tight timer loop; existing valid intervals are left unchanged.
 *
 * @param {unknown} value Configured interval in seconds.
 * @returns {number} A finite interval of at least one second.
 */
function normalizePollingInterval(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(1, number) : 10;
}

/**
 * @param {unknown} value Configured additional interval in seconds.
 * @returns {number} A finite nonnegative interval (zero disables polling).
 */
function normalizeVirtualInterval(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(0, number) : 0;
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
    const status = error.response && error.response.status;
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return `HTTP ${status}`;
    }
    if (typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(error.code)) {
      return `Request failed (${error.code})`;
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
