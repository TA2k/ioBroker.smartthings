'use strict';

const assert = require('node:assert/strict');
const { normalizeDiscoveredDevices } = require('./lib/deviceDiscovery');

describe('device discovery data', () => {
  it('keeps stable IDs and available room assignments without API payload details', () => {
    const devices = normalizeDiscoveredDevices([
      { deviceId: 'dev-a', label: 'Kitchen light', roomId: 'room-a', locationId: 'home', deviceTypeName: 'Light', secret: 'omit' },
      { deviceId: 'dev-b', roomId: 'missing-room' },
      { label: 'invalid without ID' },
    ], new Map([['room-a', 'Kitchen']]));
    assert.deepEqual(devices, [
      { id: 'dev-a', name: 'Kitchen light', roomId: 'room-a', roomName: 'Kitchen', locationId: 'home', type: 'Light' },
      { id: 'dev-b', name: 'dev-b', roomId: 'missing-room', roomName: '', locationId: '', type: '' },
    ]);
    assert.equal(JSON.stringify(devices).includes('secret'), false);
  });
});
