'use strict';

const { expect } = require('chai');
const {
  normalizePollingInterval,
  normalizeVirtualInterval,
  isPollingIntervalAdjusted,
  normalizeSessionExpiry,
  getTokenRefreshDelayMs,
  hasAccessToken,
  mergeRefreshedSession,
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

  describe('refresh scheduling', () => {
    it('uses a one-day fallback for invalid expiry values', () => {
      for (const value of [undefined, null, '', '0', -5, 'invalid', NaN, Infinity, 0]) {
        expect(normalizeSessionExpiry(value)).to.equal(86400);
      }
    });

    it('bounds short and extremely long sessions to valid Node.js timers', () => {
      const maxSeconds = Math.floor((2 ** 31 - 1) / 1000);
      expect(normalizeSessionExpiry('60')).to.equal(60);
      expect(normalizeSessionExpiry(10)).to.equal(60);
      expect(normalizeSessionExpiry(1e20)).to.equal(maxSeconds);
      expect(getTokenRefreshDelayMs('60')).to.equal(30000);
      expect(getTokenRefreshDelayMs(300)).to.equal(150000);
      expect(getTokenRefreshDelayMs(86400)).to.equal(86100000);
      expect(getTokenRefreshDelayMs(1e20)).to.be.at.most(2 ** 31 - 1);
    });

    it('does not warn about a valid numeric string interval', () => {
      expect(isPollingIntervalAdjusted('30')).to.equal(false);
      expect(isPollingIntervalAdjusted(30)).to.equal(false);
      expect(isPollingIntervalAdjusted('0')).to.equal(true);
      expect(isPollingIntervalAdjusted('invalid')).to.equal(true);
      expect(isPollingIntervalAdjusted(1e20)).to.equal(true);
    });

    it('rejects invalid access-token responses', () => {
      expect(hasAccessToken('real-access-token')).to.equal(true);
      for (const value of [undefined, null, '', ' ', 15, {}]) {
        expect(hasAccessToken(value)).to.equal(false);
      }
      expect(mergeRefreshedSession({ refresh_token: 'old' }, { access_token: '' })).to.equal(null);
    });

    it('retains the previous refresh token when one is not rotated', () => {
      const original = { refresh_token: 'old-refresh', access_token: 'old-access', expires_in: 900 };
      const renewed = mergeRefreshedSession(original, { access_token: 'new-access', expires_in: '3600' });
      expect(renewed).to.deep.equal({
        refresh_token: 'old-refresh',
        access_token: 'new-access',
        expires_in: '3600',
      });
      expect(original.refresh_token).to.equal('old-refresh');
      expect(mergeRefreshedSession(original, { access_token: 'next', refresh_token: 'rotated' }).refresh_token).to.equal('rotated');
      expect(mergeRefreshedSession(original, { error: '401', refresh_token: 'bad' })).to.equal(null);
    });
  });

  describe('legacy configuration', () => {
    it('accepts missing exclusion entries without throwing', () => {
      expect(parseExclusionList(undefined)).to.deep.equal([]);
      expect(parseExclusionList(null)).to.deep.equal([]);
      expect(parseExclusionList('  a, b ,, c  ')).to.deep.equal(['a', 'b', 'c']);
      expect(parseExclusionList('  a b, c d  ')).to.deep.equal(['ab', 'cd']);
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
