'use strict';

const assert = require('node:assert/strict');
const { createWriteGuardedAdapter } = require('./lib/writeGuard');

describe('shutdown write guard', () => {
  it('forwards writes only while the adapter is active', async () => {
    const writes = [];
    let active = true;
    const adapter = {
      namespace: 'smartthings.0',
      async setStateAsync(...args) { writes.push(['state', ...args]); },
      async extendObjectAsync(...args) { writes.push(['object', ...args]); },
      helper() { return this.namespace; },
    };
    const guarded = createWriteGuardedAdapter(adapter, () => active);
    assert.equal(guarded.helper(), 'smartthings.0');
    await guarded.setStateAsync('device.status', 'on', true);
    active = false;
    await guarded.setStateAsync('device.status', 'off', true);
    await guarded.extendObjectAsync('device.status', {});
    assert.deepEqual(writes, [['state', 'device.status', 'on', true]]);
  });
});
