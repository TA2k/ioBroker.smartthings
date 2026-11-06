const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
// Pin a stable controller because the default "dev" dist-tag may require a newer Node.js than the test matrix provides.
tests.integration(path.join(__dirname, '..'), {
  controllerVersion: '7.2.5',
});