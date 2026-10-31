'use strict';

/**
 * Returns true for SmartThings leaf values that do not carry information.
 *
 * @param {*} value Value to inspect.
 * @returns {boolean} Whether the value is empty.
 */
function isEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

/**
 * Recursively removes persistently empty object properties.
 *
 * Empty values are retained for one update when the previous value was
 * meaningful. This lets json2iob clear an existing state instead of leaving
 * stale data behind. Arrays keep their indexes because SmartThings payloads
 * may use their position as part of the data model.
 *
 * @param {*} current Current SmartThings value.
 * @param {*} previous Previous raw SmartThings value at the same path.
 * @returns {*} Compacted value or undefined when it can be omitted.
 */
function compactValue(current, previous) {
  if (isEmptyValue(current)) {
    return isEmptyValue(previous) ? undefined : current;
  }

  if (Array.isArray(current)) {
    if (current.length === 0 && (!Array.isArray(previous) || previous.length === 0)) {
      return undefined;
    }
    return current.slice();
  }

  if (typeof current !== 'object') {
    return current;
  }

  const previousObject =
    previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const compacted = {};

  for (const [key, value] of Object.entries(current)) {
    const compactedValue = compactValue(value, previousObject[key]);
    if (compactedValue !== undefined) {
      compacted[key] = compactedValue;
    }
  }

  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

/**
 * Creates a compact copy of a SmartThings status response.
 *
 * @param {*} current Current status response.
 * @param {*} previous Previous raw status response.
 * @returns {object} Compacted response suitable for json2iob.
 */
function compactStatus(current, previous) {
  return compactValue(current, previous) || {};
}

module.exports = {
  compactStatus,
};
