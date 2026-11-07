'use strict';

const assert = require('node:assert/strict');
const { parseExcludedDevices, mergeExcludedDevices, filterDevices } = require('./admin/deviceSelection');

describe('admin device selection', () => {
  const devices = [
    { id: 'dev-a', name: 'Kitchen light', roomName: 'Kitchen', roomId: 'room-a' },
    { id: 'dev-b', name: 'Hall sensor', roomName: 'Hall', roomId: 'room-b' },
  ];

  it('preserves legacy exclusion parsing semantics', () => {
    assert.deepEqual(parseExcludedDevices(' dev-a, unknown ,, dev-b '), ['dev-a', 'unknown', 'dev-b']);
  });

  it('preserves unknown exclusions and defaults newly discovered devices to enabled', () => {
    const initiallyEnabled = new Set(devices
      .filter((device) => !new Set(parseExcludedDevices('dev-a,offline-device')).has(device.id))
      .map((device) => device.id));
    assert.equal(mergeExcludedDevices('dev-a,offline-device', devices, initiallyEnabled), 'offline-device,dev-a');
    initiallyEnabled.add('dev-a');
    initiallyEnabled.delete('dev-b');
    assert.equal(mergeExcludedDevices('dev-a,offline-device', devices, initiallyEnabled), 'offline-device,dev-b');
  });

  it('filters by name, stable ID, and room assignment', () => {
    assert.deepEqual(filterDevices(devices, 'kitchen').map((device) => device.id), ['dev-a']);
    assert.deepEqual(filterDevices(devices, 'dev-b').map((device) => device.id), ['dev-b']);
    assert.deepEqual(filterDevices(devices, 'missing'), []);
  });
});
