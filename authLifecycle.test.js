'use strict';

const assert = require('node:assert/strict');
const Module = require('module');
const mainFile = require.resolve('./main');

// Exercise the real adapter methods without starting an ioBroker controller or
// contacting Samsung. Only external modules are replaced by inert test doubles.
const originalLoad = Module._load;
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
  }

  on() {}
  setState(...args) { this.states.push(args); }
  async setStateAsync(...args) { this.states.push(args); }
  subscribeStates() {}
  async getStateAsync() { return null; }
}
let createAdapter;
try {
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === mainFile) {
      if (request === '@iobroker/adapter-core') return { Adapter: AdapterDouble };
      if (request === 'axios') return { default: { create: () => async () => ({ data: {} }) } };
      if (request === 'json2iob') return class { async parse() {} };
      if (request === './lib/ocf/ocfDeviceFactory') return class {};
      if (request === 'eventsource') return { EventSource: class {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  createAdapter = require(mainFile);
} finally {
  Module._load = originalLoad;
}

describe('SmartThings authentication lifecycle', () => {
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
    assert.ok(adapter.states.some((entry) => entry[0] === 'info.connection' && entry[1] === false));
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
  });

  it('reports getDeviceList HTTP errors without propagating credentials', async () => {
    const adapter = createAdapter({ config: { token: 'secret-token' } });
    adapter.requestClient = async () => {
      throw { response: { status: 401, data: { access_token: 'secret-token' } } };
    };
    assert.equal(await adapter.getDeviceList(), false);
    assert.ok(adapter.logMessages.includes('HTTP 401'));
    assert.equal(adapter.logMessages.join(' ').includes('secret-token'), false);
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
