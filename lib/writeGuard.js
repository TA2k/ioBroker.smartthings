'use strict';

const GUARDED_ASYNC_METHODS = new Set([
  'setStateAsync',
  'setObjectNotExistsAsync',
  'extendObjectAsync',
  'delObjectAsync',
]);

/**
 * json2iob performs multiple asynchronous adapter writes per payload. A guard
 * at the start of status processing is insufficient when shutdown begins in
 * the middle of parsing, so every individual write is checked as well.
 * @param {object} adapter Real ioBroker adapter.
 * @param {() => boolean} isActive Whether new writes are still allowed.
 * @returns {object} Adapter-compatible guarded proxy.
 */
function createWriteGuardedAdapter(adapter, isActive) {
  return new Proxy(adapter, {
    get(target, property) {
      if (typeof property === 'string' && GUARDED_ASYNC_METHODS.has(property)) {
        return async (...args) => {
          if (!isActive()) return;
          await target[property](...args);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

module.exports = { createWriteGuardedAdapter };
