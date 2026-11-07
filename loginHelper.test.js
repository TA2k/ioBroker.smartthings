'use strict';

const { expect } = require('chai');
const { extractSamsungCallback, validateCallbackValues } = require('./admin/loginHelper');

describe('Samsung login callback helper', () => {
  const callback = 'samsungconnect://samsungaccount/callback?action=authorize&code=0011aaff&retValue=2233bbcc&state=4455ddee';

  it('accepts the complete existing Samsung callback', () => {
    expect(extractSamsungCallback(callback)).to.equal(callback);
    expect(extractSamsungCallback('  ' + callback + '  ')).to.equal(callback);
  });

  it('extracts a callback from copied Chrome/Firefox console text', () => {
    expect(extractSamsungCallback("Failed to launch '" + callback + "' because the scheme is not registered"))
      .to.equal(callback);
    expect(extractSamsungCallback('Uncaught redirect error: ' + callback + '.'))
      .to.equal(callback);
  });

  it('requires even-length hexadecimal ciphertext compatible with the backend decoder', () => {
    expect(validateCallbackValues({ code: '00aa', retValue: 'BB22', state: '44cc' })).to.equal(true);
    for (const value of ['0', 'xyz0', 'aa/b', '', null]) {
      expect(validateCallbackValues({ code: value, retValue: 'BB22', state: '44cc' })).to.equal(false);
    }
    expect(extractSamsungCallback(
      'SamsungConnect://samsungaccount/callback?action=authorize&code=AB%2FCD%3D&retValue=A%2BB&state=%2F%2B'
    )).to.equal(null);
  });

  it('rejects partial callbacks and missing parameters', () => {
    const partial = [
      'samsungconnect://samsungaccount/callback',
      'samsungconnect://samsungaccount/callback?action=authorize&code=00aa',
      'samsungconnect://samsungaccount/callback?action=authorize&code=00aa&retValue=22bb',
      'samsungconnect://samsungaccount/callback?action=authorize&code=&retValue=22bb&state=44cc',
      'samsungconnect://samsungaccount/callback?action=authorize&code=00aa&retValue=22bb&state=',
      'samsungconnect://samsungaccount/callback?action=authorize&code=00aa&code=11aa&retValue=22bb&state=44cc',
      'samsungconnect://samsungaccount/callback?action=authorize&code=00aa&retValue=22bb&state=44cc&state=66dd',
      'samsungconnect://samsungaccount/callback?action=login&code=00aa&retValue=22bb&state=44cc',
    ];
    for (const value of partial) expect(extractSamsungCallback(value)).to.equal(null);
  });

  it('rejects non-Samsung URLs, malformed input, and redirects with fragments', () => {
    for (const value of [
      null, undefined, 123, '', 'No callback available', 'https://example.org/callback?code=secret',
      'javascript:alert(1)',
      'samsungconnect://evil.example/callback?action=authorize&code=00aa&retValue=22bb&state=44cc',
      'samsungconnect://samsungaccount/other?action=authorize&code=00aa&retValue=22bb&state=44cc',
      callback + '#fragment',
      callback + ' '.repeat(17000),
    ]) {
      expect(extractSamsungCallback(value)).to.equal(null);
    }
  });
});
