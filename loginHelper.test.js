'use strict';

const { expect } = require('chai');
const { extractSamsungCallback } = require('./admin/loginHelper');

describe('Samsung login callback helper', () => {
  const callback = 'samsungconnect://samsungaccount/callback?action=authorize&code=encodedCode&retValue=encryptedName&state=encryptedState';

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

  it('accepts percent-encoded encrypted callback values without decoding them', () => {
    const encoded = 'SamsungConnect://samsungaccount/callback?action=authorize&code=AB%2FCD%3D&retValue=A%2BB&state=%2F%2B';
    expect(extractSamsungCallback(encoded)).to.equal(encoded);
  });

  it('rejects partial callbacks and missing parameters', () => {
    const partial = [
      'samsungconnect://samsungaccount/callback',
      'samsungconnect://samsungaccount/callback?action=authorize&code=a',
      'samsungconnect://samsungaccount/callback?action=authorize&code=a&retValue=b',
      'samsungconnect://samsungaccount/callback?action=authorize&code=&retValue=b&state=c',
      'samsungconnect://samsungaccount/callback?action=authorize&code=a&retValue=b&state=',
      'samsungconnect://samsungaccount/callback?action=authorize&code=a&code=x&retValue=b&state=c',
      'samsungconnect://samsungaccount/callback?action=authorize&code=a&retValue=b&state=c&state=x',
      'samsungconnect://samsungaccount/callback?action=login&code=a&retValue=b&state=c',
    ];
    for (const value of partial) expect(extractSamsungCallback(value)).to.equal(null);
  });

  it('rejects non-Samsung URLs, malformed input, and redirects with fragments', () => {
    for (const value of [
      null, undefined, 123, '', 'No callback available', 'https://example.org/callback?code=secret',
      'javascript:alert(1)',
      'samsungconnect://evil.example/callback?action=authorize&code=a&retValue=b&state=c',
      'samsungconnect://samsungaccount/other?action=authorize&code=a&retValue=b&state=c',
      callback + '#fragment',
      callback + ' '.repeat(17000),
    ]) {
      expect(extractSamsungCallback(value)).to.equal(null);
    }
  });
});
