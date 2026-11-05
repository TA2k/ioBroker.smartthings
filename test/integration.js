const path = require('path');
const { tests } = require('@iobroker/testing');

// Use a stable controller supported by Node.js 20/22/24.
// The testing harness defaults to the moving "dev" dist-tag, which can
// install pre-release controller versions incompatible with this harness.
tests.integration(path.join(__dirname, '..'), {
  controllerVersion: '7.2.5',
});
