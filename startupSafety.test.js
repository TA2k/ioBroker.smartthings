'use strict';

const { expect } = require('chai');
const {
  normalizePollingInterval,
  normalizeVirtualInterval,
  parseExclusionList,
  parseStoredSession,
  formatRequestError,
} = require('./lib/startupSafety');

describe('startupSafety', () => {
  describe('polling intervals', () => {
    it('preserves valid polling settings', () => {
      expect(normalizePollingInterval(10)).to.equal(10);
      expect(normalizePollingInterval('30')).to.equal(30);
      expect(normalizeVirtualInterval(0)).to.equal(0);
      expect(normalizeVirtualInterval('15')).to.equal(15);
    });

    it('prevents fast loops from empty, invalid, and tiny values', () => {
      for (const value of [null, undefined, '', ' ', 'abc', NaN, Infinity]) {
        expect(normalizePollingInterval(value)).to.equal(10);
        expect(normalizeVirtualInterval(value)).to.equal(0);
      }
      expect(normalizePollingInterval(0)).to.equal(1);
      expect(normalizePollingInterval(-5)).to.equal(1);
      expect(normalizeVirtualInterval(-1)).to.equal(0);
      expect(normalizeVirtualInterval(0.01)).to.equal(1);
    });

    it('avoids overflow in Node.js timer delays', () => {
      const maxSeconds = Math.floor((2 ** 31 - 1) / 1000);
      expect(normalizePollingInterval(1e20)).to.equal(maxSeconds);
      expect(normalizeVirtualInterval(1e20)).to.equal(maxSeconds);
    });
  });

  describe('legacy configuration', () => {
    it('accepts missing exclusion entries without throwing', () => {
      expect(parseExclusionList(undefined)).to.deep.equal([]);
      expect(parseExclusionList(null)).to.deep.equal([]);
      expect(parseExclusionList('  a, b ,, c  ')).to.deep.equal(['a', 'b', 'c']);
    });

    it('only restores structurally valid stored sessions', () => {
      expect(parseStoredSession('{"refresh_token":"r","access_token":"a"}')).to.deep.equal({
        refresh_token: 'r',
        access_token: 'a',
      });
      for (const value of [null, '', '{bad json', 'null', '[]', '{}', '{"refresh_token":""}']) {
        expect(parseStoredSession(value)).to.equal(null);
      }
    });
  });

  describe('safe request diagnostics', () => {
    it('never includes token-bearing HTTP errors in logs', () => {
      const error = {
        message: 'request failed with secret-token',
        config: { headers: { Authorization: 'Bearer secret-token' } },
        response: { status: 401, data: { refresh_token: 'secret-token' } },
      };
      expect(formatRequestError(error)).to.equal('HTTP 401');
      expect(formatRequestError(error)).not.to.include('secret-token');
    });

    it('only reports safe error codes and otherwise suppresses details', () => {
      expect(formatRequestError({ code: 'ECONNRESET', message: 'secret' }))
        .to.equal('Request failed (ECONNRESET)');
      expect(formatRequestError({ message: 'secret' }))
        .to.equal('Request failed (details omitted)');
      expect(formatRequestError({ code: 'SECRET_TOKEN' }))
        .to.equal('Request failed (details omitted)');
      expect(formatRequestError('Bearer secret-token'))
        .to.equal('Request failed (details omitted)');
    });
  });
});
