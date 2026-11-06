const path = require('path');
const { tests } = require('@iobroker/testing');

/**
 * Send a message to the running adapter and wait for its response. The
 * adapter subscribes to its messagebox during startup, so retry briefly until
 * the subscription is active instead of relying on a fixed startup delay.
 *
 * @param {import('@iobroker/testing/build/tests/integration/lib/harness').TestHarness} harness
 * @param {string} target
 * @param {string} command
 * @param {unknown} message
 * @returns {Promise<unknown>}
 */
async function sendToAdapter(harness, target, command, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(undefined);
        }
      }, 1000);
      harness.sendTo(target, command, message, (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      });
    });
    if (response !== undefined) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No response from ${target} for command ${command}`);
}

// Use a stable controller supported by Node.js 20/22/24.
// The testing harness defaults to the moving "dev" dist-tag, which can
// install pre-release controller versions incompatible with this harness.
tests.integration(path.join(__dirname, '..'), {
  controllerVersion: '7.2.5',
  defineAdditionalTests({ suite }) {
    suite('Adapter messagebox', (getHarness) => {
      it('answers getDiscoveredDevices through the real adapter messagebox', async function () {
        this.timeout(60000);
        const harness = getHarness();
        await harness.startAdapterAndWait();

        const response = await sendToAdapter(harness, 'smartthings.0', 'getDiscoveredDevices', {});
        const actual = JSON.stringify(response);
        const expected = JSON.stringify({ ok: false, connected: false, devices: [] });
        if (actual !== expected) {
          throw new Error(`Unexpected messagebox response: ${actual}`);
        }
      });
    });
  },
});
