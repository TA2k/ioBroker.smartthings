'use strict';

const assert = require('node:assert/strict');
const Module = require('module');
const mainFile = require.resolve('./main');

// Exercise the real adapter methods without starting an ioBroker controller or
// contacting Samsung. Only external modules are replaced by inert test doubles.
const originalLoad = Module._load;
let latestEventSource = null;
let eventSourceError = null;
function createHttpError(status, data) {
  return Object.assign(new Error('request failed'), { response: { status, data } });
}

class EventSourceDouble {
  constructor() {
    if (eventSourceError) {
      throw eventSourceError;
    }
    this.listeners = {};
    this.onopen = () => {};
    this.onerror = () => {};
    this.onmessage = async () => {};
    this.closed = false;
    latestEventSource = this;
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  close() { this.closed = true; }
}
class AdapterDouble {
  constructor(options) {
    this.config = {
      token: '', codeUrl: '', interval: 10, virtualInterval: 0,
      exclude: '', excludeDevices: '', ...options.config,
    };
    this.logMessages = [];
    const log = (message) => this.logMessages.push(String(message));
    this.log = { debug: log, info: log, warn: log, error: log };
    this.namespace = 'smartthings.0';
    this.states = [];
    this.messages = [];
  }

  on() {}
  setState(...args) { this.states.push(args); }
  async setStateAsync(...args) { this.states.push(args); }
  subscribeStates() {}
  async getStateAsync() { return null; }
  async setObjectNotExistsAsync() {}
  async extendObject() {}
  async getForeignObjectAsync() { return null; }
  sendTo(...args) { this.messages.push(args); }
}
let createAdapter;
try {
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === mainFile) {
      if (request === '@iobroker/adapter-core') return { Adapter: AdapterDouble };
      if (request === 'axios') return { default: { create: () => async () => ({ data: {} }) } };
      if (request === 'json2iob') return class { async parse() {} };
      if (request === './lib/ocf/ocfDeviceFactory') return class {};
      if (request === 'eventsource') return { EventSource: EventSourceDouble };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  createAdapter = require(mainFile);
} finally {
  Module._load = originalLoad;
}

describe('SmartThings authentication lifecycle', () => {
  beforeEach(() => {
    latestEventSource = null;
    eventSourceError = null;
  });

  it('does not start SSE or polling when stored-session renewal fails', async () => {
    const adapter = createAdapter({ config: {} });
    adapter.getStateAsync = async () => ({ val: '{"refresh_token":"persisted"}' });
    adapter.refreshToken = async () => false;
    let apiCalls = 0;
    adapter.getDeviceList = async () => { apiCalls++; return true; };
    adapter.connectSSE = async () => { throw new Error('SSE should not start'); };
    await adapter.onReady();
    assert.equal(apiCalls, 0);
    assert.equal(adapter.updateInterval, null);
    assert.equal(adapter.authorizationInvalid, true);
    assert.ok(adapter.states.some((entry) => entry[0] === 'info.connection' && entry[1] === false));
  });

  it('rejects callback ciphertext that the backend AES decoder cannot consume', async () => {
    const adapter = createAdapter({
      config: {
        codeUrl: 'samsungconnect://samsungaccount/callback?action=authorize&code=xyz0&retValue=22bb&state=44cc',
      },
    });
    let requestCalls = 0;
    adapter.requestClient = async () => { requestCalls++; return { data: {} }; };
    assert.equal(await adapter.login(), false);
    assert.equal(requestCalls, 0);
    assert.ok(adapter.logMessages.some((message) => message.includes('callback encoding')));
    assert.equal(adapter.logMessages.join(' ').includes('xyz0'), false);
  });

  it('verifies a manually configured token before enabling SSE and polling', async () => {
    const adapter = createAdapter({ config: { token: 'manual-token', interval: '30' } });
    let verified = 0;
    let connected = 0;
    adapter.getDeviceList = async () => { verified++; return true; };
    adapter.connectSSE = async () => { connected++; };
    adapter.updateDevices = async () => {};
    try {
      await adapter.onReady();
      assert.equal(verified, 1);
      assert.equal(connected, 1);
      assert.equal(adapter.config.interval, 30);
      assert.equal(adapter.logMessages.some((message) => message.includes('Invalid or too-small polling interval')), false);
    } finally {
      await adapter.onUnload(() => {});
    }
  });

  it('does not start any polling when API validation rejects a token', async () => {
    const adapter = createAdapter({ config: { token: 'invalid-token' } });
    adapter.getDeviceList = async () => false;
    adapter.connectSSE = async () => { throw new Error('SSE should not start'); };
    await adapter.onReady();
    assert.equal(adapter.updateInterval, null);
    assert.equal(adapter.authorizationInvalid, true);
  });

  it('schedules refresh only after a successful session login', async () => {
    const adapter = createAdapter({ config: {} });
    adapter.getStateAsync = async () => ({ val: '{"refresh_token":"persisted"}' });
    adapter.refreshToken = async () => {
      adapter.config.token = 'renewed';
      return true;
    };
    adapter.getDeviceList = async () => true;
    adapter.connectSSE = async () => {};
    adapter.updateDevices = async () => {};
    let scheduled = 0;
    adapter.scheduleTokenRefresh = () => { scheduled++; };
    try {
      await adapter.onReady();
      assert.equal(scheduled, 1);
    } finally {
      await adapter.onUnload(() => {});
    }
  });

  it('retains a rotated or unchanged refresh token after persistence succeeds', async () => {
    const adapter = createAdapter({ config: {} });
    adapter.session = { refresh_token: 'old-refresh', access_token: 'old-access', expires_in: 900 };
    adapter.requestClient = async () => ({ data: { access_token: 'new-access', expires_in: 1200 } });
    assert.equal(await adapter.refreshToken(), true);
    assert.equal(adapter.session.refresh_token, 'old-refresh');
    assert.equal(adapter.config.token, 'new-access');
    assert.ok(adapter.states.some((entry) => entry[0] === 'authInformation.session' &&
      JSON.parse(entry[1]).refresh_token === 'old-refresh'));
    adapter.requestClient = async () => ({ data: { access_token: 'next-access', refresh_token: 'rotated' } });
    assert.equal(await adapter.refreshToken(), true);
    assert.equal(adapter.session.refresh_token, 'rotated');
  });

  it('keeps the previous session and access token on an invalid refresh response', async () => {
    const adapter = createAdapter({ config: { token: 'old-access' } });
    adapter.session = { refresh_token: 'old-refresh', access_token: 'old-access' };
    adapter.requestClient = async () => ({ data: { error: 'invalid_grant' } });
    assert.equal(await adapter.refreshToken(), false);
    assert.equal(adapter.config.token, 'old-access');
    assert.equal(adapter.session.refresh_token, 'old-refresh');
    assert.equal(adapter.states.length, 0);
    assert.equal(adapter.lastAuthFailureTerminal, true);
  });

  it('classifies an OAuth server error as transient without replacing the session', async () => {
    const adapter = createAdapter({ config: { token: 'old-access' } });
    adapter.session = { refresh_token: 'old-refresh', access_token: 'old-access' };
    adapter.requestClient = async () => ({ status: 200, data: { error: 'server_error' } });
    assert.equal(await adapter.refreshToken(), false);
    assert.equal(adapter.lastAuthFailureTerminal, false);
    assert.equal(adapter.lastAuthFailureType, 'transient');
    assert.equal(adapter.config.token, 'old-access');
  });

  it('does not retry an unknown HTTP 400 refresh response automatically', async () => {
    const adapter = createAdapter({ config: { token: 'old-access' } });
    adapter.session = { refresh_token: 'old-refresh', access_token: 'old-access', expires_in: 60 };
    adapter.requestClient = async () => {
      throw createHttpError(400, { error: 'unrecognized_error' });
    };
    const timerSet = global.setTimeout;
    const scheduled = [];
    try {
      global.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      };
      adapter.scheduleTokenRefresh();
      await scheduled[0].callback();
      assert.equal(scheduled.length, 1);
      assert.equal(adapter.lastAuthFailureType, 'unknown');
      assert.equal(adapter.lastAuthFailureTerminal, false);
      assert.ok(adapter.logMessages.some((message) => message.includes('automatic retry disabled')));
    } finally {
      global.setTimeout = timerSet;
    }
  });

  it('stops retrying and marks the connection offline after a terminal refresh failure', async () => {
    const adapter = createAdapter({ config: { token: 'expired-access-token' } });
    adapter.session = { refresh_token: 'expired-refresh', expires_in: 60 };
    adapter.requestClient = async () => {
      throw createHttpError(401, { error: 'invalid_grant', access_token: 'private-token' });
    };
    const timerSet = global.setTimeout;
    const scheduled = [];
    try {
      global.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      };
      adapter.scheduleTokenRefresh();
      await scheduled[0].callback();
      assert.equal(scheduled.length, 1);
      assert.equal(adapter.authorizationInvalid, true);
      assert.ok(adapter.states.some((entry) => entry[0] === 'info.connection' && entry[1] === false));
      assert.ok(adapter.logMessages.some((message) => message.includes('authorization expired')));
      assert.equal(adapter.logMessages.join(' ').includes('private-token'), false);
      let commandCalls = 0;
      adapter.requestClient = async () => { commandCalls++; };
      await adapter.onStateChange('smartthings.0.device.capabilities.switch-on', { val: true, ack: false });
      assert.equal(commandCalls, 0);
    } finally {
      global.setTimeout = timerSet;
    }
  });

  it('bounds transient refresh retries with exponential backoff', async () => {
    const adapter = createAdapter({ config: { token: 'current-access-token' } });
    adapter.session = { refresh_token: 'valid-refresh', expires_in: 60 };
    let requestCalls = 0;
    adapter.requestClient = async () => {
      requestCalls++;
      throw createHttpError(503);
    };
    const timerSet = global.setTimeout;
    const scheduled = [];
    try {
      global.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      };
      adapter.scheduleTokenRefresh();
      await scheduled[0].callback();
      await scheduled[1].callback();
      await scheduled[2].callback();
      await scheduled[3].callback();
      assert.deepEqual(scheduled.map((entry) => entry.delay), [30000, 300000, 600000, 1200000]);
      assert.equal(requestCalls, 4);
      assert.equal(adapter.lastAuthFailureTerminal, false);
      assert.equal(adapter.lastAuthFailureType, 'transient');
      assert.equal(adapter.authorizationInvalid, false);
      assert.equal(adapter.states.some((entry) => entry[0] === 'info.connection' && entry[1] === false), false);
      assert.ok(adapter.logMessages.some((message) => message.includes('retry limit reached')));
    } finally {
      global.setTimeout = timerSet;
    }
  });

  it('shares one in-flight refresh request across concurrent 401 recovery paths', async () => {
    const adapter = createAdapter({ config: { token: 'expired-access' } });
    adapter.session = { refresh_token: 'valid-refresh', expires_in: 3600 };
    let requestCalls = 0;
    /** @type {(value: unknown) => void} */
    let resolveRequest = () => {};
    adapter.requestClient = async () => {
      requestCalls++;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    };
    const timerSet = global.setTimeout;
    const scheduled = [];
    try {
      global.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      };
      adapter.handleUnauthorizedResponse();
      const firstRefresh = scheduled[0].callback();
      adapter.handleUnauthorizedResponse();
      const secondRefresh = scheduled[1].callback();
      assert.equal(requestCalls, 1);
      resolveRequest({
        data: { access_token: 'renewed-access', refresh_token: 'valid-refresh', expires_in: 3600 },
      });
      await Promise.all([firstRefresh, secondRefresh]);
      assert.equal(requestCalls, 1);
      assert.equal(adapter.config.token, 'renewed-access');
      assert.equal(adapter.authorizationInvalid, false);
    } finally {
      global.setTimeout = timerSet;
    }
  });

  it('plans one retry when concurrent 401 recovery paths fail transiently', async () => {
    const adapter = createAdapter({ config: { token: 'expired-access' } });
    adapter.session = { refresh_token: 'valid-refresh', expires_in: 3600 };
    let requestCalls = 0;
    /** @type {(reason?: unknown) => void} */
    let rejectRequest = () => {};
    adapter.requestClient = async () => {
      requestCalls++;
      return new Promise((resolve, reject) => {
        rejectRequest = (reason) => reject(reason);
      });
    };
    const timerSet = global.setTimeout;
    const scheduled = [];
    try {
      global.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      };
      adapter.handleUnauthorizedResponse();
      const firstRefresh = scheduled[0].callback();
      adapter.handleUnauthorizedResponse();
      const secondRefresh = scheduled[1].callback();
      rejectRequest(createHttpError(503));
      await Promise.all([firstRefresh, secondRefresh]);
      assert.equal(requestCalls, 1);
      assert.equal(adapter.tokenRefreshRetryAttempt, 1);
      assert.equal(scheduled.filter((entry) => entry.delay === 300000).length, 1);
    } finally {
      global.setTimeout = timerSet;
    }
  });

  it('keeps polling available when the SSE subscription cannot be created', async () => {
    const adapter = createAdapter({ config: { token: 'secret-token' } });
    adapter.requestClient = async () => {
      throw createHttpError(503, { access_token: 'secret-token' });
    };
    assert.equal(await adapter.connectSSE(), false);
    assert.equal(latestEventSource, null);
    assert.ok(adapter.logMessages.includes('HTTP 503'));
    assert.equal(adapter.logMessages.join(' ').includes('secret-token'), false);
  });

  it('falls back when a successful SSE response has no subscription identifier', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.requestClient = async () => ({ data: {} });
    assert.equal(await adapter.connectSSE(), false);
    assert.equal(latestEventSource, null);
    assert.ok(adapter.logMessages.some((message) => message.includes('continuing with scheduled polling')));
  });

  it('falls back when EventSource initialization throws synchronously', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.requestClient = async () => ({ data: { subscriptionId: 'private-subscription-id' } });
    eventSourceError = new Error('private initialization details');
    assert.equal(await adapter.connectSSE(), false);
    assert.equal(latestEventSource, null);
    const logs = adapter.logMessages.join(' ');
    assert.ok(logs.includes('Unable to initialize SmartThings SSE'));
    assert.equal(logs.includes('private-subscription-id'), false);
    assert.equal(logs.includes('private initialization details'), false);
  });

  it('starts scheduled polling when SSE setup fails during onReady', async () => {
    const adapter = createAdapter({ config: { token: 'manual-token', interval: 30 } });
    adapter.requestClient = async (request) => {
      if (request.url.endsWith('/v1/devices')) return { data: { items: [] } };
      throw createHttpError(503);
    };
    try {
      await adapter.onReady();
      assert.notEqual(adapter.updateInterval, null);
      assert.ok(adapter.logMessages.some((message) => message.includes('continuing with scheduled polling')));
    } finally {
      await adapter.onUnload(() => {});
    }
  });

  it('does not log subscription responses or private SSE payload values', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.requestClient = async () => ({ data: { subscriptionId: 'private-subscription-id' } });
    assert.equal(await adapter.connectSSE(), true);
    assert.ok(latestEventSource);
    await latestEventSource.onmessage({
      data: JSON.stringify({
        eventType: 'DEVICE_EVENT',
        deviceEvent: {
          deviceId: 'private-device-id', capability: 'switch', attribute: 'switch',
          value: 'private-device-value', stateChange: true,
        },
      }),
    });
    const logs = adapter.logMessages.join(' ');
    assert.equal(logs.includes('private-subscription-id'), false);
    assert.equal(logs.includes('private-device-id'), false);
    assert.equal(logs.includes('private-device-value'), false);
  });

  it('routes named and unnamed SSE frames through the canonical coordinator', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const events = [];
    adapter.statusCoordinator = {
      onEvent: (data, name) => { events.push([data, name]); return true; },
      close: () => {},
    };
    adapter.requestClient = async () => ({ data: { subscriptionId: 'subscription-id' } });
    assert.equal(await adapter.connectSSE(), true);
    latestEventSource.onmessage({ data: '{"eventType":"DEVICE_EVENT"}' });
    latestEventSource.listeners.DEVICE_EVENT({ data: '{"deviceEvent":{}}' });
    assert.deepEqual(events, [
      ['{"eventType":"DEVICE_EVENT"}', 'message'],
      ['{"deviceEvent":{}}', 'DEVICE_EVENT'],
    ]);
  });

  it('closes EventSource during shutdown', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.requestClient = async () => ({ data: { subscriptionId: 'subscription-id' } });
    assert.equal(await adapter.connectSSE(), true);
    const eventSource = latestEventSource;
    await adapter.onUnload(() => {});
    assert.equal(eventSource.closed, true);
    assert.equal(adapter.sseEventSource, null);
  });

  it('aborts in-flight status requests and suppresses writes after shutdown', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    /** @type {AbortSignal | undefined} */
    let requestSignal;
    /** @type {(value: unknown) => void} */
    let resolveRequest = () => {};
    let parses = 0;
    adapter.statusJson2iob = { parse: async () => { parses++; } };
    adapter.requestClient = async (request) => {
      requestSignal = request.signal;
      return new Promise((resolve) => { resolveRequest = (value) => resolve(value); });
    };
    const statusRequest = adapter.fetchDeviceStatus({ id: 'device-a', type: 'Switch' });
    await Promise.resolve();
    await adapter.onUnload(() => {});
    if (!requestSignal) throw new Error('expected request signal to be captured');
    assert.equal(requestSignal.aborted, true);
    resolveRequest({ data: { components: { main: { switch: {} } } } });
    await statusRequest;
    assert.equal(parses, 0);
    assert.deepEqual(adapter.responseCache, {});
    assert.deepEqual(adapter.rawResponseCache, {});
  });

  it('does not log raw device-list or status payloads', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.requestClient = async (request) => {
      if (request.url.endsWith('/v1/devices')) {
        return { data: { items: [], privateMarker: 'private-device-list' } };
      }
      return {
        data: { components: { main: { switch: { switch: { value: 'private-status-value' } } } } },
      };
    };
    assert.equal(await adapter.getDeviceList(), true);
    adapter.deviceArray = [{ id: 'device-a', type: 'Switch' }];
    await adapter.updateDevices();
    const logs = adapter.logMessages.join(' ');
    assert.equal(logs.includes('private-device-list'), false);
    assert.equal(logs.includes('private-status-value'), false);
  });

  it('keeps excluded devices discoverable with available room names', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.excludeDeviceSet = new Set(['excluded-device']);
    adapter.requestClient = async (request) => {
      if (request.url.endsWith('/v1/devices')) {
        return { data: { items: [{
          deviceId: 'excluded-device', label: 'Kitchen light', roomId: 'room-a',
          locationId: 'location-a', deviceTypeName: 'Light',
        }] } };
      }
      if (request.url.endsWith('/v1/locations/location-a/rooms')) {
        return { data: { items: [{ roomId: 'room-a', name: 'Kitchen' }] } };
      }
      throw new Error('unexpected request');
    };
    assert.equal(await adapter.getDeviceList(), true);
    assert.deepEqual(adapter.deviceArray, []);
    assert.deepEqual(adapter.discoveredDevices, [{
      id: 'excluded-device', name: 'Kitchen light', roomId: 'room-a', roomName: 'Kitchen',
      locationId: 'location-a', type: 'Light',
    }]);
    adapter.onMessage({ from: 'system.adapter.admin.0', command: 'getDiscoveredDevices', callback: { id: 1 } });
    assert.equal(adapter.messages.length, 1);
    assert.equal(adapter.messages[0][2].devices[0].id, 'excluded-device');
    assert.equal(Object.prototype.hasOwnProperty.call(adapter.messages[0][2], 'token'), false);
  });

  it('preserves prior discovery data when a later device fetch fails', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.discoveredDevices = [{ id: 'offline-device', name: 'Offline device' }];
    adapter.deviceDiscoveryAvailable = true;
    adapter.waitForRetry = async () => {};
    adapter.requestClient = async () => { throw createHttpError(503); };
    assert.equal(await adapter.getDeviceList(), false);
    assert.deepEqual(adapter.discoveredDevices, [{ id: 'offline-device', name: 'Offline device' }]);
    assert.equal(adapter.config.excludeDevices, '');
  });

  it('reports getDeviceList HTTP errors without propagating credentials', async () => {
    const adapter = createAdapter({ config: { token: 'secret-token' } });
    adapter.requestClient = async () => {
      throw createHttpError(401, { access_token: 'secret-token' });
    };
    assert.equal(await adapter.getDeviceList(), false);
    assert.ok(adapter.logMessages.includes('HTTP 401'));
    assert.equal(adapter.logMessages.join(' ').includes('secret-token'), false);
  });

  it('retries HTTP 503 device-list failures with bounded backoff', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const delays = [];
    let requestCalls = 0;
    adapter.waitForRetry = async (delay) => { delays.push(delay); };
    adapter.requestClient = async () => {
      requestCalls++;
      throw createHttpError(503);
    };
    assert.equal(await adapter.getDeviceList(), false);
    assert.equal(requestCalls, 3);
    assert.deepEqual(delays, [1000, 2000]);
    const connectionStates = adapter.states.filter((entry) => entry[0] === 'info.connection');
    assert.equal(connectionStates[connectionStates.length - 1][1], false);
  });

  it('does not retry or accept an unknown HTTP 400 device-list response', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    let requestCalls = 0;
    adapter.waitForRetry = async () => { throw new Error('unexpected retry'); };
    adapter.requestClient = async () => {
      requestCalls++;
      throw createHttpError(400, { error: 'unrecognized_error' });
    };
    assert.equal(await adapter.getDeviceList(), false);
    assert.equal(requestCalls, 1);
    assert.equal(adapter.states.some((entry) => entry[0] === 'info.connection' && entry[1] === true), false);
  });

  it('does not restart a device-list request after shutdown during backoff', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    let requestCalls = 0;
    /** @type {() => void} */
    let releaseRetry = () => {};
    /** @type {() => void} */
    let reportWaitStarted = () => {};
    const waitStarted = /** @type {Promise<void>} */ (
      new Promise((resolve) => { reportWaitStarted = () => resolve(); })
    );
    adapter.requestClient = async () => {
      requestCalls++;
      throw createHttpError(503);
    };
    adapter.waitForRetry = async () => {
      reportWaitStarted();
      await /** @type {Promise<void>} */ (
        new Promise((resolve) => { releaseRetry = () => resolve(); })
      );
    };
    const deviceListResult = adapter.getDeviceList();
    await waitStarted;
    adapter.shuttingDown = true;
    releaseRetry();
    assert.equal(await deviceListResult, false);
    assert.equal(requestCalls, 1);
    assert.equal(adapter.states.some((entry) => entry[0] === 'info.connection' && entry[1] === true), false);
  });

  it('does not start SSE or polling when shutdown begins after device-list validation', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    let sseCalls = 0;
    adapter.getDeviceList = async () => {
      adapter.shuttingDown = true;
      return true;
    };
    adapter.connectSSE = async () => { sseCalls++; return true; };
    await adapter.onReady();
    assert.equal(sseCalls, 0);
    assert.equal(adapter.updateInterval, null);
    assert.equal(adapter.updateVirtualInterval, null);
  });

  it('marks authorization invalid and avoids follow-up polling after a command receives 401', async () => {
    const adapter = createAdapter({ config: { token: 'expired-token' } });
    adapter.requestClient = async () => {
      throw createHttpError(401, { token: 'private-token' });
    };
    await adapter.onStateChange('smartthings.0.device.capabilities.switch-on', { val: true, ack: false });
    assert.equal(adapter.authorizationInvalid, true);
    assert.equal(adapter.refreshTimeout, null);
    assert.ok(adapter.logMessages.includes('HTTP 401'));
    assert.equal(adapter.logMessages.join(' ').includes('private-token'), false);
  });

  it('uses one immediate refresh to recover from an API 401 when a session exists', async () => {
    const adapter = createAdapter({ config: { token: 'expired-access' } });
    adapter.session = { refresh_token: 'valid-refresh', expires_in: 3600 };
    let calls = 0;
    adapter.requestClient = async () => {
      calls++;
      if (calls === 1) throw createHttpError(401);
      return { data: { access_token: 'renewed-access', refresh_token: 'valid-refresh', expires_in: 3600 } };
    };
    const timerSet = global.setTimeout;
    const scheduled = [];
    try {
      global.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      };
      await adapter.onStateChange('smartthings.0.device.capabilities.switch-on', { val: true, ack: false });
      assert.equal(adapter.authorizationInvalid, true);
      assert.equal(scheduled.length, 1);
      assert.equal(scheduled[0].delay, 0);
      await scheduled[0].callback();
      assert.equal(adapter.authorizationInvalid, false);
      assert.equal(adapter.config.token, 'renewed-access');
      const connectionStates = adapter.states.filter((entry) => entry[0] === 'info.connection');
      assert.equal(connectionStates[connectionStates.length - 1][1], false);
      adapter.requestClient = async () => ({
        data: { components: { main: { switch: { switch: { value: 'on' } } } } },
      });
      adapter.deviceArray = [{ id: 'device-a', type: 'Switch' }];
      await adapter.updateDevices();
      const recoveredStates = adapter.states.filter((entry) => entry[0] === 'info.connection');
      assert.equal(recoveredStates[recoveredStates.length - 1][1], true);
    } finally {
      global.setTimeout = timerSet;
    }
  });

  it('cancels the scheduled token refresh during unload', async () => {
    const adapter = createAdapter({ config: {} });
    adapter.session = { refresh_token: 'test-refresh', expires_in: 60 };
    const timerSet = global.setTimeout;
    const timerClear = global.clearTimeout;
    const scheduled = [];
    const cancelled = [];
    try {
      global.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return 42;
      };
      global.clearTimeout = (timer) => { cancelled.push(timer); };
      adapter.scheduleTokenRefresh();
      assert.equal(scheduled[0].delay, 30000);
      await adapter.onUnload(() => {});
      assert.deepEqual(cancelled, [42]);
    } finally {
      global.setTimeout = timerSet;
      global.clearTimeout = timerClear;
    }
  });
});
