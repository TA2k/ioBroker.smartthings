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
  const isActive = options.isActive || (() => true);
  if (!isActive()) return false;
  const cacheKey = `${deviceId}.status`;
  const raw = unwrapStatusPayload(response);
  const data = options.compactMode ? options.compact(raw, options.rawCache[cacheKey]) : raw;
  if (!isActive()) return false;
  await options.parse(cacheKey, data, {
    forceIndex: undefined,
    preferedArrayName: undefined,
    channelName: 'Status of the device',
    excludeStateWithEnding: options.excludeEndings,
    previousData: options.cache[cacheKey],
  });
  if (!isActive()) return false;
  options.rawCache[cacheKey] = raw;
  options.cache[cacheKey] = data;
  return true;
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
  } catch {
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
    this.maxConcurrent = options.maxConcurrent === undefined ? 4 : Math.max(1, options.maxConcurrent);
    this.timers = new Map();
    this.inFlight = new Map();
    this.dirty = new Set();
    this.queue = [];
    this.activeCount = 0;
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
    const task = new Promise((resolve) => {
      this.queue.push({ deviceId, resolve });
    });
    this.inFlight.set(deviceId, task);
    this._drain();
    return task;
  }

  _drain() {
    while (!this.closed && this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item || !this.isKnownDevice(item.deviceId)) {
        if (item) {
          this.inFlight.delete(item.deviceId);
          item.resolve();
        }
        continue;
      }
      this.activeCount++;
      Promise.resolve()
        .then(() => this.refresh(item.deviceId))
        .catch((error) => {
          this.onError(error);
        })
        .finally(() => {
          this.activeCount--;
          this.inFlight.delete(item.deviceId);
          item.resolve();
          if (this.dirty.delete(item.deviceId) && !this.closed && this.isKnownDevice(item.deviceId)) {
            this._debounce(item.deviceId);
          }
          this._drain();
        });
    }
  }

  close() {
    this.closed = true;
    for (const timer of this.timers.values()) this.cancel(timer);
    this.timers.clear();
    this.dirty.clear();
    for (const item of this.queue.splice(0)) {
      this.inFlight.delete(item.deviceId);
      item.resolve();
    }
  }
}

module.exports = { unwrapStatusPayload, writeDeviceStatus, changedDeviceId, StatusCoordinator };
