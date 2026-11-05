'use strict';

/**
 * Preserve the existing json2iob schema. The adapter historically unwraps
 * up to two single-key object layers, but keeps multi-component status data.
 * @param {object} response SmartThings DeviceStatus response.
 * @returns {object} Existing ioBroker status body.
 */
function unwrapStatusPayload(response) {
  let data = response;
  for (let i = 0; i < 2; i++) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) break;
    const keys = Object.keys(data);
    if (keys.length !== 1) break;
    data = data[keys[0]];
  }
  return data;
}

/**
 * Shared persistence path for both scheduled and SSE-triggered status reads.
 * Cache writes are committed only when the parser completes successfully.
 * @param {string} deviceId Known SmartThings device ID.
 * @param {object} response Full SmartThings status response.
 * @param {object} options Parser, caches, and filter configuration.
 * @returns {Promise<void>} Completion of state/object updates.
 */
async function writeDeviceStatus(deviceId, response, options) {
  const cacheKey = `${deviceId}.status`;
  const raw = unwrapStatusPayload(response);
  const data = options.compactMode ? options.compact(raw, options.rawCache[cacheKey]) : raw;
  await options.parse(cacheKey, data, {
    forceIndex: undefined,
    preferedArrayName: undefined,
    channelName: 'Status of the device',
    excludeStateWithEnding: options.excludeEndings,
    previousData: options.cache[cacheKey],
  });
  options.rawCache[cacheKey] = raw;
  options.cache[cacheKey] = data;
}

/**
 * Named SSE events may omit the type in their payload. Untyped messages
 * must explicitly identify DEVICE_EVENT. Only changes trigger new reads.
 * @param {string} raw Raw JSON event data.
 * @param {string} eventName SSE event type.
 * @returns {string|null} Device ID to refresh.
 */
function changedDeviceId(raw, eventName) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_error) {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if ((payload.eventType || eventName) !== 'DEVICE_EVENT') return null;
  const change = payload.deviceEvent;
  return change && change.stateChange === true &&
    typeof change.deviceId === 'string' && change.deviceId.length > 0 ? change.deviceId : null;
}

/**
 * Debounce SSE bursts and single-flight concurrent periodic status reads.
 * An event seen during an active fetch schedules one trailing refresh.
 */
class StatusCoordinator {
  constructor(options) {
    this.refresh = options.refresh;
    this.isKnownDevice = options.isKnownDevice;
    this.onError = options.onError || (() => {});
    this.schedule = options.schedule || ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.cancel || ((timer) => clearTimeout(timer));
    this.delayMs = options.delayMs === undefined ? 350 : options.delayMs;
    this.timers = new Map();
    this.inFlight = new Map();
    this.dirty = new Set();
    this.closed = false;
  }

  onEvent(raw, eventName) {
    const deviceId = changedDeviceId(raw, eventName);
    if (this.closed || !deviceId || !this.isKnownDevice(deviceId)) return false;
    this._debounce(deviceId);
    return true;
  }

  _debounce(deviceId) {
    const timer = this.timers.get(deviceId);
    if (timer !== undefined) this.cancel(timer);
    const next = this.schedule(() => {
      this.timers.delete(deviceId);
      if (this.closed || !this.isKnownDevice(deviceId)) return;
      if (this.inFlight.has(deviceId)) {
        this.dirty.add(deviceId);
      } else {
        this.request(deviceId);
      }
    }, this.delayMs);
    this.timers.set(deviceId, next);
  }

  request(deviceId) {
    if (this.closed || !this.isKnownDevice(deviceId)) return Promise.resolve();
    const current = this.inFlight.get(deviceId);
    if (current) return current;
    const task = Promise.resolve()
      .then(() => this.refresh(deviceId))
      .catch((error) => {
        this.onError(error);
      })
      .finally(() => {
        this.inFlight.delete(deviceId);
        if (this.dirty.delete(deviceId) && !this.closed && this.isKnownDevice(deviceId)) {
          this._debounce(deviceId);
        }
      });
    this.inFlight.set(deviceId, task);
    return task;
  }

  close() {
    this.closed = true;
    for (const timer of this.timers.values()) this.cancel(timer);
    this.timers.clear();
    this.dirty.clear();
  }
}

module.exports = { unwrapStatusPayload, writeDeviceStatus, changedDeviceId, StatusCoordinator };
