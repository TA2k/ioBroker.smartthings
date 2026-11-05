'use strict';

const assert = require('node:assert/strict');
const { unwrapStatusPayload, writeDeviceStatus, changedDeviceId, StatusCoordinator } = require('./lib/sseStatus');

function fakeClock() {
  const timers = new Map();
  let index = 0;
  return {
    timers,
    schedule(fn) { const id = ++index; timers.set(id, fn); return id; },
    cancel(id) { timers.delete(id); },
    async flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((fn) => fn());
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe('SSE canonical status updates', () => {
  it('retains single-component main paths', () => {
    const status = { components: { main: { switch: { switch: { value: 'on' } } } } };
    assert.deepEqual(unwrapStatusPayload(status), status.components.main);
  });

  it('retains multi-component IDs including cooler', () => {
    const status = { components: { main: { switch: {} }, cooler: { contactSensor: { contact: { value: 'open' } } } } };
    assert.deepEqual(unwrapStatusPayload(status), status.components);
  });

  it('retains legacy healthState responses without changing the object tree', () => {
    const status = { components: { main: { switch: {} } }, healthState: { state: 'ONLINE' } };
    assert.deepEqual(unwrapStatusPayload(status), status);
  });

  it('writes nested array/object values using the same parser and status path', async () => {
    const cache = {};
    const rawCache = {};
    const writes = [];
    const payload = { components: { main: { custom: { settings: { value: [1, { nested: 'x' }] } } } } };
    await writeDeviceStatus('dev-a', payload, {
      parse: async (path, data, options) => writes.push({ path, data, options }),
      cache, rawCache, compactMode: false, excludeEndings: ['Cycle'],
    });
    assert.equal(writes[0].path, 'dev-a.status');
    assert.deepEqual(writes[0].data, payload.components.main);
    assert.deepEqual(writes[0].options.excludeStateWithEnding, ['Cycle']);
    assert.deepEqual(cache['dev-a.status'], payload.components.main);
    assert.deepEqual(rawCache['dev-a.status'], payload.components.main);
  });

  it('preserves compact mode and previous-state caches', async () => {
    const cache = {};
    const rawCache = {};
    const writes = [];
    const options = {
      parse: async (path, data, opts) => writes.push({ path, data, opts }),
      cache, rawCache, compactMode: true, excludeEndings: [],
      compact: (data, previous) => data.switch.switch.value === null &&
        previous && previous.switch.switch.value === null ? {} : data,
    };
    const payload = (value) => ({ components: { main: { switch: { switch: { value } } } } });
    await writeDeviceStatus('dev-a', payload('on'), options);
    await writeDeviceStatus('dev-a', payload(null), options);
    await writeDeviceStatus('dev-a', payload(null), options);
    assert.deepEqual(writes[1].data, { switch: { switch: { value: null } } });
    assert.deepEqual(writes[2].data, {});
    assert.deepEqual(writes[1].opts.previousData, writes[0].data);
  });

  it('does not update caches when parser fails', async () => {
    const cache = {};
    const rawCache = {};
    await assert.rejects(writeDeviceStatus('dev-a', { components: { main: { switch: {} } } }, {
      parse: async () => { throw new Error('parse failed'); },
      cache, rawCache, excludeEndings: [], compactMode: false,
    }), /parse failed/);
    assert.deepEqual(cache, {});
    assert.deepEqual(rawCache, {});
  });

  it('accepts named DEVICE_EVENT and unnamed message frames', () => {
    const de = { deviceId: 'dev-a', componentId: 'cooler', stateChange: true };
    assert.equal(changedDeviceId(JSON.stringify({ eventType: 'DEVICE_EVENT', deviceEvent: de }), 'message'), 'dev-a');
    assert.equal(changedDeviceId(JSON.stringify({ deviceEvent: de }), 'DEVICE_EVENT'), 'dev-a');
  });

  it('rejects invalid, non-state-change, and unrelated SSE data', () => {
    assert.equal(changedDeviceId('{broken', 'DEVICE_EVENT'), null);
    assert.equal(changedDeviceId('null', 'message'), null);
    assert.equal(changedDeviceId('{"eventType":"DEVICE_HEALTH_EVENT"}', 'message'), null);
    assert.equal(changedDeviceId('{"eventType":"DEVICE_EVENT","deviceEvent":{"deviceId":"dev-a","stateChange":false}}', 'message'), null);
  });

  it('deduplicates repeated frames for one known device', async () => {
    const clock = fakeClock();
    const calls = [];
    const coordinator = new StatusCoordinator({
      refresh: async (id) => calls.push(id),
      isKnownDevice: (id) => id === 'dev-a',
      schedule: clock.schedule, cancel: clock.cancel,
    });
    const event = '{"eventType":"DEVICE_EVENT","deviceEvent":{"deviceId":"dev-a","stateChange":true}}';
    assert.equal(coordinator.onEvent(event, 'message'), true);
    assert.equal(coordinator.onEvent(event, 'DEVICE_EVENT'), true);
    assert.equal(clock.timers.size, 1);
    await clock.flush();
    assert.deepEqual(calls, ['dev-a']);
  });

  it('ignores unknown and excluded devices', async () => {
    const clock = fakeClock();
    const coordinator = new StatusCoordinator({
      refresh: () => { throw new Error('unexpected fetch'); },
      isKnownDevice: () => false,
      schedule: clock.schedule, cancel: clock.cancel,
    });
    assert.equal(coordinator.onEvent('{"eventType":"DEVICE_EVENT","deviceEvent":{"deviceId":"excluded","stateChange":true}}', 'message'), false);
    assert.equal(clock.timers.size, 0);
  });

  it('queues a trailing refresh when an event arrives during periodic polling', async () => {
    const clock = fakeClock();
    const calls = [];
    let resolveFirst;
    const coordinator = new StatusCoordinator({
      refresh: (id) => {
        calls.push(id);
        return calls.length === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve();
      },
      isKnownDevice: () => true,
      schedule: clock.schedule, cancel: clock.cancel,
    });
    const initial = coordinator.request('dev-a');
    await new Promise((resolve) => setImmediate(resolve));
    coordinator.onEvent('{"eventType":"DEVICE_EVENT","deviceEvent":{"deviceId":"dev-a","stateChange":true}}', 'message');
    await clock.flush();
    assert.equal(calls.length, 1);
    resolveFirst();
    await initial;
    await new Promise((resolve) => setImmediate(resolve));
    await clock.flush();
    assert.deepEqual(calls, ['dev-a', 'dev-a']);
  });

  it('cancels debounced callbacks and rejects new events after unload', async () => {
    const clock = fakeClock();
    let calls = 0;
    const coordinator = new StatusCoordinator({
      refresh: async () => { calls++; },
      isKnownDevice: () => true,
      schedule: clock.schedule, cancel: clock.cancel,
    });
    const event = '{"eventType":"DEVICE_EVENT","deviceEvent":{"deviceId":"dev-a","stateChange":true}}';
    coordinator.onEvent(event, 'message');
    coordinator.close();
    assert.equal(clock.timers.size, 0);
    assert.equal(coordinator.onEvent(event, 'message'), false);
    await clock.flush();
    assert.equal(calls, 0);
  });

  it('recovers from a failed refresh without permanently blocking a device', async () => {
    const clock = fakeClock();
    let calls = 0;
    const errors = [];
    const coordinator = new StatusCoordinator({
      refresh: async () => { if (++calls === 1) throw new Error('temporary'); },
      isKnownDevice: () => true,
      onError: (error) => errors.push(error.message),
      schedule: clock.schedule, cancel: clock.cancel,
    });
    const event = '{"eventType":"DEVICE_EVENT","deviceEvent":{"deviceId":"dev-a","stateChange":true}}';
    coordinator.onEvent(event, 'message');
    await clock.flush();
    coordinator.onEvent(event, 'message');
    await clock.flush();
    assert.equal(calls, 2);
    assert.deepEqual(errors, ['temporary']);
  });
});
