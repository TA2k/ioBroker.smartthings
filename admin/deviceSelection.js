'use strict';

/* global window */

function parseExcludedDevices(value) {
  return typeof value === 'string' ? value.replace(/ /g, '').split(',').filter(Boolean) : [];
}

/**
 * Preserve exclusions for devices that are currently undiscoverable while
 * replacing only the entries represented by visible checkboxes.
 * @param {string} existing Existing comma-separated exclusion setting.
 * @param {Array<{id: string}>} discovered Current non-secret discovery list.
 * @param {Set<string>} enabledIds Enabled visible device IDs.
 * @returns {string} Backwards-compatible comma-separated exclusions.
 */
function mergeExcludedDevices(existing, discovered, enabledIds) {
  const discoveredIds = new Set(discovered.map((device) => device.id));
  const result = parseExcludedDevices(existing).filter((id) => !discoveredIds.has(id));
  for (const device of discovered) {
    if (!enabledIds.has(device.id)) result.push(device.id);
  }
  return [...new Set(result)].join(',');
}

function filterDevices(devices, query) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!needle) return devices.slice();
  return devices.filter((device) => [device.name, device.id, device.roomName, device.roomId]
    .some((value) => typeof value === 'string' && value.toLowerCase().includes(needle)));
}

const smartthingsDeviceSelection = { parseExcludedDevices, mergeExcludedDevices, filterDevices };
if (typeof module !== 'undefined' && module.exports) module.exports = smartthingsDeviceSelection;
if (typeof window !== 'undefined') window.smartthingsDeviceSelection = smartthingsDeviceSelection;
