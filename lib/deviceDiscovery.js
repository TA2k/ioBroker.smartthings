'use strict';

/**
 * Reduce SmartThings device data to the non-secret fields needed by the admin
 * selection UI. Device IDs remain the only stable selection keys.
 * @param {unknown} items SmartThings device-list items.
 * @param {Map<string, string>} roomNames Room ID to display name.
 * @returns {Array<{id: string, name: string, roomId: string, roomName: string, locationId: string, type: string}>}
 */
function normalizeDiscoveredDevices(items, roomNames) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((device) => device && typeof device === 'object' &&
      typeof device.deviceId === 'string' && device.deviceId.length > 0)
    .map((device) => {
      const roomId = typeof device.roomId === 'string' ? device.roomId : '';
      return {
        id: device.deviceId,
        name: typeof device.label === 'string' && device.label ? device.label : device.deviceId,
        roomId,
        roomName: roomNames.get(roomId) || '',
        locationId: typeof device.locationId === 'string' ? device.locationId : '',
        type: typeof device.deviceTypeName === 'string' ? device.deviceTypeName : '',
      };
    });
}

module.exports = { normalizeDiscoveredDevices };
