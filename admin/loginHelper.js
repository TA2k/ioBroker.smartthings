'use strict';

/* global window */

/**
 * Extract an existing Samsung app callback from a copied link or a browser
 * console message. This DOES NOT initiate or complete OAuth; it merely
 * validates the callback before the adapter's existing login flow consumes it.
 *
 * Never log or display this URL: it contains short-lived authorization data.
 *
 * @param {unknown} input Pasted callback or console message.
 * @returns {string|null} Complete validated callback, or null.
 */
function extractSamsungCallback(input) {
  if (typeof input !== 'string' || input.length > 16384) return null;

  // Console output commonly prefixes the failing custom-scheme redirect.
  const found = /samsungconnect:\/\/samsungaccount\/callback\?[^\s"'<>\\`]+/i.exec(input);
  if (!found) return null;

  const callback = found[0].replace(/[),.;\]}]+$/, '');
  if (!callback || callback.length > 8192) return null;

  let parsed;
  try {
    parsed = new URL(callback);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'samsungconnect:' ||
      parsed.hostname !== 'samsungaccount' ||
      parsed.pathname !== '/callback' ||
      parsed.port || parsed.username || parsed.password || parsed.hash ||
      parsed.searchParams.get('action') !== 'authorize') {
    return null;
  }

  // The existing Samsung login requires all three encrypted callback values.
  // Reject truncated/malformed and ambiguous duplicate parameters.
  for (const key of ['action', 'code', 'retValue', 'state']) {
    const values = parsed.searchParams.getAll(key);
    if (values.length !== 1 || !values[0] || !values[0].trim()) return null;
  }

  return callback;
}

const smartthingsLoginHelper = { extractSamsungCallback };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = smartthingsLoginHelper;
}
if (typeof window !== 'undefined') {
  window.smartthingsLoginHelper = smartthingsLoginHelper;
}
