'use strict';

const assert = require('node:assert/strict');
const Module = require('module');
const mainFile = require.resolve('./main');

// Exercise the real adapter methods without starting an ioBroker controller or
// contacting Samsung. Only external modules are replaced by inert test doubles.
const originalLoad = Module._load;
class AdapterDouble {
  constructor(options) {
    this.config = { token: '', interval: 10, virtualInterval: 0, ...options.config };
    this.namespace = 'smartthings.0';
    this.logMessages = [];
    const log = (message) => this.logMessages.push(String(message));
    this.log = { debug: log, info: log, warn: log, error: log };
    this.states = [];
  }

  on() {}
  setState(...args) { this.states.push(args); }
  async setObjectNotExistsAsync() {}
  async extendObject() {}
  async getForeignObjectAsync() { return null; }
  subscribeStates() {}
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

function registerCommand(adapter, relativeId, capability, command) {
  adapter.commandStateIds.set(relativeId, {
    deviceId: relativeId.split('.')[0],
    capability,
    command,
  });
}

describe('SmartThings command routing', () => {
  it('never forwards status, general or info writes as commands', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const requests = [];
    adapter.requestClient = async (request) => {
      requests.push(request);
      return { data: {} };
    };
    registerCommand(adapter, 'device.capabilities.switch-on', 'switch', 'on');
    await adapter.onStateChange(
      'smartthings.0.device.status.switch.switch.value', { val: 'on', ack: false },
    );
    await adapter.onStateChange(
      'smartthings.0.device.status.switchLevel.level.value', { val: 50, ack: false },
    );
    await adapter.onStateChange('smartthings.0.device.general.label', { val: 'Lamp', ack: false });
    await adapter.onStateChange('smartthings.0.info.connection', { val: true, ack: false });
    assert.deepEqual(requests, []);
    assert.equal(adapter.refreshTimeout, null);
  });

  it('sends discovered switch commands with the existing capability payload', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const requests = [];
    adapter.requestClient = async (request) => {
      requests.push(request);
      return { data: {} };
    };
    registerCommand(adapter, 'device.capabilities.switch-on', 'switch', 'on');
    registerCommand(adapter, 'device.capabilities.switch-off', 'switch', 'off');
    try {
      await adapter.onStateChange('smartthings.0.device.capabilities.switch-on', { val: true, ack: false });
      await adapter.onStateChange('smartthings.0.device.capabilities.switch-off', { val: true, ack: false });
      assert.equal(requests.length, 2);
      assert.equal(requests[0].method, 'post');
      assert.equal(requests[0].url, 'https://api.smartthings.com/v1/devices/device/commands');
      assert.deepEqual(requests[0].data, { commands: [{ capability: 'switch', command: 'on' }] });
      assert.deepEqual(requests[1].data, { commands: [{ capability: 'switch', command: 'off' }] });
    } finally {
      clearTimeout(adapter.refreshTimeout);
      adapter.refreshTimeout = null;
    }
  });

  it('sends a numeric argument for discovered commands with parameters', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const requests = [];
    adapter.requestClient = async (request) => {
      requests.push(request);
      return { data: {} };
    };
    registerCommand(adapter, 'device.capabilities.switchLevel-setLevel', 'switchLevel', 'setLevel');
    try {
      await adapter.onStateChange(
        'smartthings.0.device.capabilities.switchLevel-setLevel', { val: 50, ack: false },
      );
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].data, {
        commands: [{ capability: 'switchLevel', command: 'setLevel', arguments: [50] }],
      });
      assert.equal(typeof requests[0].data.commands[0].arguments[0], 'number');
    } finally {
      clearTimeout(adapter.refreshTimeout);
      adapter.refreshTimeout = null;
    }
  });

  it('drops unknown, malformed and out-of-namespace command ids without an API request', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const requests = [];
    adapter.requestClient = async (request) => {
      requests.push(request);
      return { data: {} };
    };
    registerCommand(adapter, 'device.capabilities.switch-on', 'switch', 'on');
    await adapter.onStateChange('smartthings.0.device.capabilities.unknown-doThing', { val: true, ack: false });
    await adapter.onStateChange('smartthings.0.device.capabilities.switch', { val: true, ack: false });
    await adapter.onStateChange('other.0.device.capabilities.switch-on', { val: true, ack: false });
    await adapter.onStateChange('smartthings.0.device.capabilities.switch-on', { val: true, ack: true });
    assert.deepEqual(requests, []);
    assert.equal(adapter.refreshTimeout, null);
  });

  it('preserves the OCF command payload and registration', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const requests = [];
    adapter.requestClient = async (request) => {
      requests.push(request);
      return { data: {} };
    };
    adapter.getForeignObjectAsync = async () => ({
      native: {
        deviceManufacturerCode: 'manufacturer', presentationId: 'presentation',
        deviceId: 'device', commandName: 'color',
      },
    });
    adapter.ocfDeviceFactory = {
      getOcfCommandData: (manufacturer, presentation, deviceId, commandName, value) => ({
        commands: [{
          component: 'main', capability: 'ocf', command: 'postOcfCommand',
          arguments: ['/oic/route/' + deviceId + '/color', { color: value }],
        }],
      }),
    };
    registerCommand(
      adapter, 'device.capabilities.ocf-postOcfCommand.color', 'ocf', 'postOcfCommand.color',
    );
    try {
      await adapter.onStateChange(
        'smartthings.0.device.capabilities.ocf-postOcfCommand.color', { val: 'red', ack: false },
      );
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].data, {
        commands: [{
          component: 'main', capability: 'ocf', command: 'postOcfCommand',
          arguments: ['/oic/route/device/color', { color: 'red' }],
        }],
      });
    } finally {
      clearTimeout(adapter.refreshTimeout);
      adapter.refreshTimeout = null;
    }
  });

  it('builds the command allowlist only from enabled devices during discovery', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.excludeDeviceSet = new Set(['excluded']);
    adapter.commandStateIds.set('removed.capabilities.switch-on', {
      deviceId: 'removed', capability: 'switch', command: 'on',
    });
    adapter.requestClient = async (request) => {
      if (request.url.endsWith('/v1/devices')) {
        return { data: { items: [
          {
            deviceId: 'enabled', label: 'Enabled', locationId: 'location',
            components: [{ capabilities: [{ id: 'switch', version: 1 }] }],
          },
          {
            deviceId: 'excluded', label: 'Excluded', locationId: 'location',
            components: [{ capabilities: [{ id: 'switch', version: 1 }] }],
          },
        ] } };
      }
      if (request.url.endsWith('/v1/capabilities/switch/1')) {
        return { data: { id: 'switch', commands: { on: { arguments: [] }, off: { arguments: [] } } } };
      }
      throw new Error('unexpected request: ' + request.url);
    };
    adapter.getRoomNames = async () => new Map();
    await adapter.getDeviceList();
    assert.equal(adapter.commandStateIds.has('removed.capabilities.switch-on'), false);
    assert.equal(adapter.commandStateIds.has('enabled.capabilities.switch-on'), true);
    assert.equal(adapter.commandStateIds.has('enabled.capabilities.switch-off'), true);
    assert.equal(adapter.commandStateIds.has('excluded.capabilities.switch-on'), false);
  });

  it('rejects discovered commands after shutdown or invalid authorization', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const requests = [];
    adapter.requestClient = async (request) => {
      requests.push(request);
      return { data: {} };
    };
    registerCommand(adapter, 'device.capabilities.switch-on', 'switch', 'on');
    adapter.authorizationInvalid = true;
    await adapter.onStateChange('smartthings.0.device.capabilities.switch-on', { val: true, ack: false });
    adapter.authorizationInvalid = false;
    adapter.shuttingDown = true;
    await adapter.onStateChange('smartthings.0.device.capabilities.switch-on', { val: true, ack: false });
    assert.equal(requests.length, 0);
  });

  it('drops OCF writes without valid command metadata', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    const requests = [];
    adapter.requestClient = async (request) => {
      requests.push(request);
      return { data: {} };
    };
    registerCommand(adapter, 'device.capabilities.ocf-postOcfCommand.color', 'ocf', 'postOcfCommand.color');
    adapter.getForeignObjectAsync = async () => null;
    await adapter.onStateChange('smartthings.0.device.capabilities.ocf-postOcfCommand.color', { val: 'red', ack: false });
    assert.equal(requests.length, 0);
  });

  it('parses status values as read-only', async () => {
    const adapter = createAdapter({ config: { token: 'access-token' } });
    adapter.deviceArray = [{ id: 'device', type: 'Switch' }];
    const parses = [];
    adapter.statusJson2iob = {
      parse: async (path, data, options) => parses.push({ path, data, options }),
    };
    adapter.requestClient = async () => ({
      data: { components: { main: { switch: { switch: { value: 'on' } } } } },
    });
    await adapter.updateDevices();
    assert.equal(parses.length, 1);
    assert.equal(parses[0].path, 'device.status');
    assert.equal(parses[0].options.write, false);
  });
});
