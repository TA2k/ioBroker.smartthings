'use strict';

/*
 * Created with @iobroker/create-adapter v2.0.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;
const Json2iob = require('json2iob');
const OcfDeviceFactory = require('./lib/ocf/ocfDeviceFactory');
const { compactStatus } = require('./lib/compactStatus');
const { writeDeviceStatus, StatusCoordinator } = require('./lib/sseStatus');
const { createWriteGuardedAdapter } = require('./lib/writeGuard');
const { normalizeDiscoveredDevices } = require('./lib/deviceDiscovery');
const { validateCallbackValues } = require('./admin/loginHelper');
const {
  normalizePollingInterval,
  normalizeVirtualInterval,
  isPollingIntervalAdjusted,
  getTokenRefreshDelayMs,
  hasAccessToken,
  mergeRefreshedSession,
  classifyAuthError,
  parseExclusionList,
  parseStoredSession,
  formatRequestError,
} = require('./lib/startupSafety');
const crypto = require('crypto');
const qs = require('qs');
const { EventSource } = require('eventsource');
const MAX_TOKEN_REFRESH_RETRIES = 3;
const TOKEN_REFRESH_RETRY_BASE_MS = 300000;
const MAX_DEVICE_LIST_ATTEMPTS = 3;
const DEVICE_LIST_RETRY_BASE_MS = 1000;
class Smartthings extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: 'smartthings',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
    this.on('message', this.onMessage.bind(this));
    this.requestClient = axios.create();
    this.updateInterval = null;
    this.updateVirtualInterval = null;
    this.refreshInterval = null;
    this.refreshTimeout = null;
    this.retryWaitTimeout = null;
    this.retryWaitResolve = null;
    this.tokenRefreshPromise = null;
    this.tokenRefreshCyclePromise = null;
    this.tokenRefreshRetryAttempt = 0;
    this.shuttingDown = false;
    this.lastAuthFailureTerminal = false;
    this.lastAuthFailureType = 'unknown';
    this.authorizationInvalid = false;
    this.tokenGeneration = 0;
    this.reLoginTimeout = null;
    this.writeGuardedAdapter = createWriteGuardedAdapter(this, () => !this.shuttingDown);
    this.json2iob = new Json2iob(this.writeGuardedAdapter);
    this.statusJson2iob = new Json2iob(this.writeGuardedAdapter);
    this.deviceArray = [];
    // Only discovered capability states are authorized to issue API commands.
    this.commandStateIds = new Map();
    this.discoveredDevices = [];
    this.deviceDiscoveryAvailable = false;
    this.session = {};
    this.ocfDeviceFactory = new OcfDeviceFactory();
    this.session = {};
    this.locationIds = [];
    this.responseCache = {};
    this.rawResponseCache = {};
    this.excludeDeviceSet = new Set();
    this.excludeStateEndingsArray = [];
    this.sseEventSource = null;
    this.apiAbortControllers = new Set();
    this.statusCoordinator = new StatusCoordinator({
      refresh: async (deviceId) => {
        const device = this.deviceArray.find((item) => item.id === deviceId);
        if (device) await this.fetchDeviceStatus(device);
      },
      isKnownDevice: (deviceId) => this.deviceArray.some((item) => item.id === deviceId) &&
        !this.excludeDeviceSet.has(deviceId),
      onError: () => this.log.error('SmartThings status refresh failed'),
      maxConcurrent: 4,
    });
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Reset the connection indicator during startup.
    this.setState('info.connection', false, true);
    const pollingInterval = normalizePollingInterval(this.config.interval);
    if (isPollingIntervalAdjusted(this.config.interval)) {
      this.log.warn('Invalid or too-small polling interval; applying a safe value');
    }
    this.config.interval = pollingInterval;
    this.config.virtualInterval = normalizeVirtualInterval(this.config.virtualInterval);

    // Older adapter installations may not have all configuration keys.
    this.excludeDeviceSet = new Set(parseExclusionList(this.config.excludeDevices));
    this.excludeStateEndingsArray = parseExclusionList(this.config.exclude);
    this.subscribeStates('*');

    // A manually configured Personal Access Token is independent of the
    // Samsung login/refresh flow. Validate it through getDeviceList() below.
    const configuredToken = hasAccessToken(this.config.token);
    let authenticated = configuredToken;
    let sessionAuthenticated = false;
    try {
      const authState = await this.getStateAsync('authInformation.session');
      const storedSession = parseStoredSession(authState && authState.val);
      if (storedSession) {
        this.session = storedSession;
        this.log.info('Use existing session to login');
        sessionAuthenticated = await this.refreshToken();
        authenticated = sessionAuthenticated || configuredToken;
        if (!sessionAuthenticated && configuredToken) {
          this.log.warn('Stored session refresh failed; checking configured token');
        }
      } else {
        if (authState && authState.val) {
          this.log.warn('Stored SmartThings session is invalid; a new login may be required');
        }
        if (this.config.codeUrl) {
          sessionAuthenticated = await this.login();
          authenticated = sessionAuthenticated || configuredToken;
        }
      }
    } catch (error) {
      this.log.error('SmartThings authentication failed: ' + formatRequestError(error));
      return;
    }

    if (!authenticated || !hasAccessToken(this.config.token)) {
      this.stopAuthenticatedOperations();
      this.log.info('Please enter a valid codeUrl or Samsung Smartthings Token');
      return;
    }

    // A token string alone is not proof of authorization. Verify it with
    // SmartThings before starting polling and the SSE subscription.
    const deviceListAvailable = await this.getDeviceList();
    if (this.shuttingDown) {
      return;
    }
    if (!deviceListAvailable) {
      this.log.warn('SmartThings device list unavailable; skipping polling and SSE');
      this.stopAuthenticatedOperations();
      return;
    }
    this.authorizationInvalid = false;

    if (this.shuttingDown) {
      return;
    }
    await this.connectSSE();
    if (this.shuttingDown) {
      return;
    }
    await this.updateDevices();
    if (this.shuttingDown) {
      return;
    }
    this.updateInterval = setInterval(async () => {
      await this.updateDevices();
    }, this.config.interval * 1000);
    if (this.config.virtualInterval > 0) {
      this.updateVirtualInterval = setInterval(async () => {
        await this.updateDevices(true);
      }, this.config.virtualInterval * 1000);
    }
    if (sessionAuthenticated) {
      this.scheduleTokenRefresh();
    }
  }

  /**
   * Mark API access unavailable while a refresh attempt is pending.
   */
  markAuthorizationUnavailable() {
    this.authorizationInvalid = true;
    this.setState('info.connection', false, true);
  }

  /**
   * Replace the access token and advance its generation only when the value
   * actually changes. Requests bind to the generation active at dispatch.
   * @param {string} accessToken Access token used by subsequent API requests.
   */
  setAccessToken(accessToken) {
    if (this.config.token !== accessToken) {
      this.tokenGeneration += 1;
    }
    this.config.token = accessToken;
  }

  /**
   * A 401 is stale for auth recovery when its request was dispatched before
   * the current access token replaced the token that request used.
   * @param {any} error Request failure.
   * @returns {boolean} Whether this 401 must not trigger auth recovery.
   */
  isStaleAuthorizationFailure(error) {
    return Boolean(
      error &&
      typeof error === 'object' &&
      Number.isInteger(error.tokenGeneration) &&
      error.tokenGeneration !== this.tokenGeneration,
    );
  }

  /**
   * Close the active SSE connection. EventSource stops its automatic reconnect
   * loop only after close(), so terminal authorization failures must not leave
   * the connection open.
   */
  closeSseConnection() {
    if (!this.sseEventSource) {
      return;
    }
    try {
      this.sseEventSource.close();
    } catch {
      this.log.warn('Unable to close SmartThings SSE cleanly');
    }
    this.sseEventSource = null;
  }

  /**
   * Stop authenticated background work after credentials are known to be
   * unusable. Keep the token in memory so this does not unexpectedly mutate
   * persisted configuration.
   */
  stopAuthenticatedOperations() {
    this.markAuthorizationUnavailable();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.updateVirtualInterval) {
      clearInterval(this.updateVirtualInterval);
      this.updateVirtualInterval = null;
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    this.closeSseConnection();
  }

  /**
   * Handle an API 401 without creating one refresh request per device. The
   * one-shot scheduler replaces any existing refresh timer. A missing refresh
   * token means the failure is terminal for the current configuration.
   */
  handleUnauthorizedResponse() {
    this.markAuthorizationUnavailable();
    if (this.session.refresh_token) {
      this.scheduleTokenRefresh(0);
    } else {
      this.lastAuthFailureTerminal = true;
      this.lastAuthFailureType = 'terminal';
      this.stopAuthenticatedOperations();
    }
  }

  /**
   * Re-arm a bounded one-shot token refresh after each successful renewal.
   * Transient failures use capped exponential backoff; terminal and unknown
   * responses never create an automatic retry loop.
   * @param {number} [retryDelayMs] Override for bounded retry delays.
   */
  scheduleTokenRefresh(retryDelayMs) {
    if (this.refreshInterval) {
      clearTimeout(this.refreshInterval);
      this.refreshInterval = null;
    }
    if (this.shuttingDown || !this.session.refresh_token) {
      return;
    }
    const delayMs = retryDelayMs === undefined ? getTokenRefreshDelayMs(this.session.expires_in) : retryDelayMs;
    this.refreshInterval = setTimeout(() => {
      this.refreshInterval = null;
      if (this.shuttingDown) {
        return;
      }
      return this.runTokenRefreshCycle();
    }, delayMs);
  }

  /**
   * Share both the HTTP refresh and its result/retry planning. This prevents
   * concurrent 401 handlers from incrementing backoff counters independently.
   * @returns {Promise<void>}
   */
  async runTokenRefreshCycle() {
    if (this.tokenRefreshCyclePromise) {
      return this.tokenRefreshCyclePromise;
    }
    this.tokenRefreshCyclePromise = this.performTokenRefreshCycle();
    try {
      await this.tokenRefreshCyclePromise;
    } finally {
      this.tokenRefreshCyclePromise = null;
    }
  }

  /** @returns {Promise<void>} */
  async performTokenRefreshCycle() {
    let refreshed = false;
    try {
      refreshed = await this.refreshToken();
    } catch (error) {
      if (this.shuttingDown) {
        return;
      }
      this.lastAuthFailureType = classifyAuthError(error);
      this.lastAuthFailureTerminal = this.lastAuthFailureType === 'terminal';
      this.log.error('SmartThings token refresh failed: ' + formatRequestError(error));
    }
    if (this.shuttingDown) {
      return;
    }
    if (refreshed) {
      this.scheduleTokenRefresh();
    } else if (this.lastAuthFailureTerminal) {
      this.log.error('SmartThings authorization expired; please authorize the adapter again');
      this.stopAuthenticatedOperations();
    } else if (this.lastAuthFailureType === 'transient') {
      if (this.tokenRefreshRetryAttempt >= MAX_TOKEN_REFRESH_RETRIES) {
        this.log.error('SmartThings token refresh retry limit reached');
        if (this.authorizationInvalid) {
          this.stopAuthenticatedOperations();
        }
        return;
      }
      const retryDelay = TOKEN_REFRESH_RETRY_BASE_MS * (2 ** this.tokenRefreshRetryAttempt);
      this.tokenRefreshRetryAttempt++;
      this.log.warn('SmartThings token refresh failed temporarily; scheduling a bounded retry');
      this.scheduleTokenRefresh(retryDelay);
    } else {
      this.log.error('SmartThings token refresh failed with an unclassified response; automatic retry disabled');
      if (this.authorizationInvalid) {
        this.stopAuthenticatedOperations();
      }
    }
  }

  async login() {
    if (this.shuttingDown) {
      return false;
    }
    this.log.info('Start login via code url');

    const initialPayload = {
      state:
        'vhSgCj2VZ6PU5L8KCkarHaUfd-cN2y1Qr31Xny3in-7Bs3gkc4gc6-n5SRxYmHkHFy-g3t3cMXb0n44663cSDW-lVYUve0KvNPAId7oNX32rHhyLUTxM153OOY3aE-XwacnslNkPUivJr-Gr3wk0qdRUlpiup-FlWL4SB7-w-IJChDHz5NcpsBjbdhS5DrGPKaOUC209ywDiHmvcxpj0IrLcQwcpTBT9-uuq0D82tBlA726OqQnv0WNMSLeQkU0ZzWlv',
      devicePhysicalAddressText: '0E39C792-26A0-4EC0-8822-7C61A8217E99',
      clientId: '8931gfak30',
      prompt: 'consent',
      deviceOSVersion: '15.8.3',
      deviceUniqueID: '0E39C792-26A0-4EC0-8822-7C61A8217E99',
      iosType: 'Y',
      countryCode: 'DE',
      scope: 'iot.client|mcs.client|members.contactus|galaxystore.openapi',
      competitorDeviceYNFlag: 'Y',
      deviceType: 'APP',
      responseEncryptionYNFlag: 'Y',
      code_challenge: '6Sgp7PQ6ioAsU0HoM6HmOH_WhijBanPciZAqPhtSMz4',
      code_challenge_method: 'S256',
      redirect_uri: 'SamsungConnect://samsungaccount/callback?action=authorize',
      iosYNFlag: 'Y',
      responseEncryptionType: '1',
      deviceModelID: 'iPhone',
    };
    this.key = 'SEmgtdtU3UgsuxAPTmOZKMXGD/WhIQAAAAAAAAAAAAA=';
    this.iv = 'eTB+SU9fLW5ZOFdiX05oSA==';
    //    this.subKey = 'dmhTZ0NqMlZaNlBVNUw4S0NrYXJIYVVmZC1jTjJ5MVE=';

    this.log.debug('Initial Login');
    if (!this.config.codeUrl) {
      this.log.error('Please enter a Samsung Smartthings Code Url in the instance settings');
      return false;
    }
    const parameter = qs.parse(typeof this.config.codeUrl === 'string' ? this.config.codeUrl.split('?')[1] : '');
    if (typeof parameter.code !== 'string' || typeof parameter.retValue !== 'string' || typeof parameter.state !== 'string') {
      this.log.error('Invalid SmartThings code URL; please enter a new callback URL');
      return false;
    }
    if (!validateCallbackValues(parameter)) {
      this.log.error('Invalid SmartThings callback encoding; please enter a complete hexadecimal callback URL');
      return false;
    }

    let codeDecrypted;
    let username;
    try {
      const subKey = Buffer.from(initialPayload.state.substring(0, 32), 'utf8').subarray(0, 16);
      const iv = Buffer.from(this.iv, 'base64');
      const decrypt = (encrypted) => {
        const decipher = crypto.createDecipheriv('aes-128-cbc', subKey, iv);
        return decipher.update(Buffer.from(encrypted, 'hex'), undefined, 'utf8') + decipher.final('utf8');
      };
      codeDecrypted = decrypt(parameter.code);
      username = decrypt(parameter.retValue);
      decrypt(parameter.state);
    } catch {
      this.log.error('Unable to decode SmartThings code URL; please generate a new one');
      return false;
    }

    const userInfos = await this.requestApi({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://eu-auth2.samsungosp.com/auth/oauth2/authenticate',
      params: {
        client_id: 'a2pvoj8e5q',
        code: codeDecrypted,
        code_verifier:
          'ZVM-W29DXe3izFprmGcq45UAzkY0UFLHl-f2CP0EFlY3CiE18V_MrKQ4d0U~7FCZZ8wLwa.adiHENmMx44QKQhy8wEkXR3BfNbDkzJ1AwdVRh72-49CYhu-B12_.8CwF',
        grant_type: 'authorization_code',
        physical_address_text: '0E39C792-26A0-4EC0-8822-7C61A8217E99',
        service_type: 'M',
        username: username,
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-osp-trxid': 'TZTSw.3_EeI5cyuplYNO~nCySY19hTMC',
        'x-osp-clientversion': '3.6.2024042301',
        accept: '*/*',
        'accept-language': 'de-DE,de;q=0.9',
        'x-osp-clientmodel': 'iPhone',
        'user-agent': 'SmartThings/22 CFNetwork/1335.0.3.4 Darwin/21.6.0',
        'x-osp-appid': 'a2pvoj8e5q',
        'x-osp-clientosversion': '15.8.3',
      },
      data: {
        code: codeDecrypted,
        service_type: 'M',
        grant_type: 'authorization_code',
        username: username,
        code_verifier:
          'ZVM-W29DXe3izFprmGcq45UAzkY0UFLHl-f2CP0EFlY3CiE18V_MrKQ4d0U~7FCZZ8wLwa.adiHENmMx44QKQhy8wEkXR3BfNbDkzJ1AwdVRh72-49CYhu-B12_.8CwF',
        client_id: 'a2pvoj8e5q',
        physical_address_text: '0E39C792-26A0-4EC0-8822-7C61A8217E99',
      },
    })
      .then((res) => {
        return res.data;
      })
      .catch((error) => {
        if (!this.shuttingDown) {
          this.log.error(formatRequestError(error));
          this.log.error('Please use a new code url');
        }
      });
    if (this.shuttingDown) {
      return false;
    }
    if (!userInfos || !userInfos.userauth_token) {
      this.log.error('No userauth_token found');
      return false;
    }
    const codeInfos = await this.requestApi({
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://eu-auth2.samsungosp.com/auth/oauth2/v2/authorize',
      params: {
        client_id: '8931gfak30',
        code_challenge: 'ZQS43TN9nQHHKwdNw4ZLxSyUAZpKXQtXizw_BFgGZ_g',
        code_challenge_method: 'S256',
        physical_address_text: '0E39C792-26A0-4EC0-8822-7C61A8217E99',
        redirect_uri: 'SamsungConnect://samsungaccount/callback',
        response_type: 'code',
        scope: 'iot.client mcs.client members.contactus galaxystore.openapi',
        service_type: 'M',
        userauth_token: userInfos.userauth_token,
      },
      headers: {
        'x-osp-trxid': 'TZTSw.3_EeI5cyuplYNO~nCySY19hTMC',
        'x-osp-clientversion': '3.6.2024042301',
        accept: '*/*',
        'x-osp-packageversion': '1.7.22',
        'x-osp-packagename': 'com.samsung.oneconnect4ios',
        'accept-language': 'de-DE,de;q=0.9',
        'x-osp-clientmodel': 'iPhone',
        'user-agent': 'SmartThings/22 CFNetwork/1335.0.3.4 Darwin/21.6.0',
        'x-osp-appid': '8931gfak30',
        'x-osp-clientosversion': '15.8.3',
      },
    })
      .then((res) => {
        return res.data;
      })
      .catch((error) => {
        if (!this.shuttingDown) {
          this.log.error(formatRequestError(error));
        }
      });
    if (this.shuttingDown) {
      return false;
    }
    if (!codeInfos || typeof codeInfos.code !== 'string') {
      this.log.error('SmartThings authorization did not return a code');
      return false;
    }
    const loginSucceeded = await this.requestApi({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://eu-auth2.samsungosp.com/auth/oauth2/token',
      headers: {
        'x-osp-trxid': 'TZTSw.3_EeI5cyuplYNO~nCySY19hTMC',
        'content-type': 'application/x-www-form-urlencoded',
        'x-osp-clientversion': '3.6.2024042301',
        accept: '*/*',
        'x-osp-packageversion': '1.7.22',
        'x-osp-packagename': 'com.samsung.oneconnect4ios',
        'accept-language': 'de-DE,de;q=0.9',
        'x-osp-clientmodel': 'iPhone',
        'user-agent': 'SmartThings/22 CFNetwork/1335.0.3.4 Darwin/21.6.0',
        'x-osp-appid': '8931gfak30',
        'x-osp-clientosversion': '15.8.3',
      },
      data: {
        code: codeInfos.code,
        client_id: '8931gfak30',
        code_verifier:
          'wrDywbkE1ukg0lV0XXKCBkevjyJj68kLzdGKNZhJfnCUOYvvJQ3hoBQU7NyOGUJfHq-I6B8M9Kxb7A-gjTE2gAFkmevYwb2q6JUUSjVbwNiBE8DYLqSZfcj5Pd8i1LLs',
        grant_type: 'authorization_code',
      },
    })
      .then(async (res) => {
        if (this.shuttingDown) {
          return false;
        }
        if (!res || !res.data || !hasAccessToken(res.data.access_token)) {
          this.log.error('SmartThings token exchange returned no usable access token');
          return false;
        }
        await this.extendObject('authInformation', {
          type: 'channel',
          common: {
            name: 'Auth Information',
          },
          native: {},
        });
        if (this.shuttingDown) {
          return false;
        }
        await this.extendObject('authInformation.session', {
          type: 'state',
          common: {
            name: 'Session',
            type: 'string',
            role: 'state',
            write: false,
            read: true,
          },
          native: {},
        });
        if (this.shuttingDown) {
          return false;
        }
        await this.setStateAsync('authInformation.session', JSON.stringify(res.data), true);
        if (this.shuttingDown) {
          return false;
        }
        this.session = res.data;
        this.setAccessToken(res.data.access_token);
        this.log.info('Login successful.');
        return true;
      })
      .catch((error) => {
        if (!this.shuttingDown) {
          this.log.error(formatRequestError(error));
        }
        return false;
      });
    return loginSucceeded === true;
  }

  async connectSSE() {
    if (this.shuttingDown || this.authorizationInvalid) {
      return false;
    }
    const subscriptionId = await this.requestApi({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://api.smartthings.com/subscriptions',
      headers: {
        'content-type': 'application/json',
        accept: 'application/vnd.smartthings+json;v=20201106',
        authorization: 'Bearer ' + this.config.token,
        'x-st-client-devicemodel': 'iPhone',
        'accept-language': 'de-DE',
        'x-st-client-appversion': '1.7.22',
        'x-st-correlation': '5D6889C3-3EFF-4677-8A27-D1819E6A34C3',
        'user-agent': 'iOS/OneApp/1.7.22 iPhone; iOS/15.8.3 SmartThingsCore/6.280.5',
        'x-st-client-os': 'iOS 15.8.3',
      },
      data: {
        name: 'iOS SSE Subscription',
        subscriptionFilters: [
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['DEVICE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['INSTALLED_APP_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['DEVICE_HEALTH_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['USER_SETTINGS_SORT_ORDER_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['SCENE_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['SMART_APP_DASHBOARD_CARD_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: ['ALL'],
            eventType: ['LOCATION_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: ['ALL'],
            eventType: ['DEVICE_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['ROOM_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['HUB_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: ['ALL'],
            eventType: ['DEVICE_OWNERSHIP_TRANSFER_STATUS_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['DEVICE_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['FAVORITE_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: ['ALL'],
            eventType: ['INSTALLED_APP_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: ['ALL'],
            eventType: ['INVITATION_LIFECYCLE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['HUB_HEALTH_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: ['ALL'],
            eventType: ['PAID_SUBSCRIPTIONS_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['MODE_EVENT'],
          },
          {
            type: 'LOCATIONIDS',
            value: this.locationIds,
            eventType: ['INVITATION_LIFECYCLE_EVENT'],
          },
        ],
      },
    })
      .then((res) => {
        return res.data && res.data.subscriptionId;
      })
      .catch((error) => {
        this.log.error('Failed to create subscription');
        this.log.error(formatRequestError(error));
      });

    if (!subscriptionId) {
      this.log.warn('SmartThings SSE subscription unavailable; continuing with scheduled polling');
      return false;
    }
    if (this.shuttingDown || this.authorizationInvalid) {
      return false;
    }

    if (this.sseEventSource) {
      this.sseEventSource.close();
      this.sseEventSource = null;
    }
    let es;
    try {
      es = new EventSource(`https://spigot-regional.api.smartthings.com/filters/${subscriptionId}/activate?filterRegion=eu-west-1`, {
        fetch: (input, init) => fetch(input, {
          ...init,
          headers: {
            ...init.headers,
            Authorization: `Bearer ${this.config.token}`,
            version: 'application/vnd.smartthings+json;v=20250122',
          },
        }),
      });
    } catch (error) {
      this.log.error('Unable to initialize SmartThings SSE: ' + formatRequestError(error));
      return false;
    }
    this.sseEventSource = es;
    es.onopen = () => {
      this.log.info('Connected to SmartThings SSE endpoint.');
    };

    es.onerror = (err) => {
      this.log.error('Error with SSE connection: ' + formatRequestError(err));
    };

    es.onmessage = (event) => {
      if (!this.authorizationInvalid && !this.shuttingDown) {
        this.statusCoordinator.onEvent(event.data, 'message');
      }
    };

    es.addEventListener('DEVICE_EVENT', (event) => {
      if (!this.authorizationInvalid && !this.shuttingDown) {
        this.statusCoordinator.onEvent(event.data, 'DEVICE_EVENT');
      }
    });
    return true;
  }
  async refreshToken() {
    if (this.shuttingDown) {
      return false;
    }
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }
    this.tokenRefreshPromise = this.performTokenRefresh();
    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = null;
    }
  }

  /**
   * Execute one token request. Callers use refreshToken(), which provides the
   * single-flight guard for concurrent HTTP-401 recovery paths.
   * @returns {Promise<boolean>} Whether a usable session was persisted.
   */
  async performTokenRefresh() {
    if (this.shuttingDown) {
      return false;
    }
    if (!this.session.refresh_token) {
      this.lastAuthFailureTerminal = true;
      this.lastAuthFailureType = 'terminal';
      this.log.debug('No refresh_token found');
      return false;
    }
    this.lastAuthFailureTerminal = false;
    this.lastAuthFailureType = 'unknown';
    this.log.debug('Start refresh token');
    try {
      const res = await this.requestApi({
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://eu-auth2.samsungosp.com/auth/oauth2/token',
        headers: {
          'x-osp-trxid': 'TZTSw.3_EeI5cyuplYNO~nCySY19hTMC',
          'content-type': 'application/x-www-form-urlencoded',
          'x-osp-clientversion': '3.6.2024042301',
          accept: '*/*',
          'x-osp-packageversion': '1.7.22',
          'x-osp-packagename': 'com.samsung.oneconnect4ios',
          'accept-language': 'de-DE,de;q=0.9',
          'x-osp-clientmodel': 'iPhone',
          'user-agent': 'SmartThings/22 CFNetwork/1335.0.3.4 Darwin/21.6.0',
          'x-osp-appid': '8931gfak30',
          'x-osp-clientosversion': '15.8.3',
        },
        data: {
          refresh_token: this.session.refresh_token,
          client_id: '8931gfak30',
          grant_type: 'refresh_token',
        },
      });
      if (this.shuttingDown) {
        return false;
      }
      const nextSession = mergeRefreshedSession(this.session, res && res.data);
      if (!nextSession) {
        this.lastAuthFailureType = classifyAuthError({
          response: { status: res && res.status, data: res && res.data },
        });
        this.lastAuthFailureTerminal = this.lastAuthFailureType === 'terminal';
        this.log.error('SmartThings refresh response contains no usable tokens');
        return false;
      }
      if (this.shuttingDown) {
        return false;
      }
      await this.setStateAsync('authInformation.session', JSON.stringify(nextSession), true);
      if (this.shuttingDown) {
        return false;
      }
      this.session = nextSession;
      this.setAccessToken(nextSession.access_token);
      this.lastAuthFailureTerminal = false;
      this.lastAuthFailureType = 'unknown';
      this.tokenRefreshRetryAttempt = 0;
      this.authorizationInvalid = false;
      // A refreshed token is not proof that the SmartThings API is reachable.
      // Keep the connection indicator offline until the next API request
      // succeeds if this refresh was triggered by a 401.
      return true;
    } catch (error) {
      if (this.shuttingDown) {
        return false;
      }
      this.lastAuthFailureType = classifyAuthError(error);
      this.lastAuthFailureTerminal = this.lastAuthFailureType === 'terminal';
      this.log.error(formatRequestError(error));
      if (this.lastAuthFailureTerminal) {
        this.log.warn('SmartThings refresh credentials are no longer valid');
      } else if (this.lastAuthFailureType === 'transient') {
        this.log.warn('SmartThings token refresh failed temporarily');
      } else {
        this.log.warn('SmartThings token refresh response was not recognized');
      }
      return false;
    }
  }

  /**
   * Retry only failures explicitly classified as transient. Unknown HTTP 400
   * responses and credential rejections return false immediately.
   * @param {number} [attempt=0] Zero-based bounded retry attempt.
   * @returns {Promise<boolean>} Whether a valid device list was processed.
   */
  async getDeviceList(attempt = 0) {
    if (this.shuttingDown) {
      return false;
    }
    return this.requestApi({
      method: 'get',
      url: 'https://api.smartthings.com/v1/devices',
      headers: {
        'User-Agent': 'ioBroker',
        Authorization: 'Bearer ' + this.config.token,
      },
    })
      .then(async (res) => {
        if (this.shuttingDown) {
          return false;
        }
        if (!res || !res.data || !Array.isArray(res.data.items)) {
          this.log.error('SmartThings device list response is invalid');
          return false;
        }
        const roomNames = await this.getRoomNames(res.data.items);
        if (this.shuttingDown || this.authorizationInvalid) return false;
        this.discoveredDevices = normalizeDiscoveredDevices(res.data.items, roomNames);
        this.deviceDiscoveryAvailable = true;
        this.deviceArray = [];
        this.commandStateIds.clear();
        this.locationIds = [];
        this.setState('info.connection', true, true);
        this.authorizationInvalid = false;
        this.log.info(res.data.items.length + ' devices detected');
        for (const device of res.data.items) {
          if (!this.locationIds.includes(device.locationId)) {
            this.locationIds.push(device.locationId);
          }
          if (this.excludeDeviceSet.has(device.deviceId)) {
            this.log.info('Ignore configured SmartThings device');
            continue;
          }
          this.deviceArray.push({ id: device.deviceId, type: device.deviceTypeName });
          await this.writeGuardedAdapter.setObjectNotExistsAsync(device.deviceId, {
            type: 'device',
            common: {
              name: device.label,
            },
            native: {},
          });
          await this.writeGuardedAdapter.setObjectNotExistsAsync(device.deviceId + '.capabilities', {
            type: 'channel',
            common: {
              name: 'Capabilities/Remote Controls',
            },
            native: {},
          });
          await this.writeGuardedAdapter.setObjectNotExistsAsync(device.deviceId + '.general', {
            type: 'channel',
            common: {
              name: 'General Information',
            },
            native: {},
          });

          if (device.components && device.components[0] && Array.isArray(device.components[0].capabilities)) {
            for (const capability of device.components[0].capabilities) {
              if (this.shuttingDown || this.authorizationInvalid) return false;
              try {
                const capabilityResponse = await this.requestApi({
                  method: 'get',
                  url: 'https://api.smartthings.com/v1/capabilities/' + capability.id + '/' + capability.version,
                  headers: {
                    'User-Agent': 'ioBroker',
                    Authorization: 'Bearer ' + this.config.token,
                  },
                });
                await this.createCapabilityObjects(device, capabilityResponse.data);
              } catch (error) {
                if (this.shuttingDown) return false;
                const status = error && typeof error === 'object' && error.response && error.response.status;
                if (status === 401 && !this.isStaleAuthorizationFailure(error)) {
                  this.handleUnauthorizedResponse();
                  return false;
                }
                this.log.error('SmartThings capability unavailable: ' + formatRequestError(error));
              }
            }
          }
          if (this.shuttingDown) return false;
          await this.json2iob.parse(device.deviceId + '.general', device);
        }
        return true;
      })
      .catch(async (error) => {
        if (this.shuttingDown) {
          return false;
        }
        this.setState('info.connection', false, true);
        this.log.error(formatRequestError(error));
        if (classifyAuthError(error) === 'transient' && attempt + 1 < MAX_DEVICE_LIST_ATTEMPTS && !this.shuttingDown) {
          const retryDelay = DEVICE_LIST_RETRY_BASE_MS * (2 ** attempt);
          this.log.warn('SmartThings device list temporarily unavailable; retrying with backoff');
          await this.waitForRetry(retryDelay);
          if (this.shuttingDown) {
            return false;
          }
          return this.getDeviceList(attempt + 1);
        }
        return false;
      });
  }

  /**
   * @param {object} device SmartThings device metadata.
   * @param {object} capabilityData SmartThings capability definition.
   * @returns {Promise<void>}
   */
  async createCapabilityObjects(device, capabilityData) {
    if (this.shuttingDown || !capabilityData || !capabilityData.commands) return;
    const idName = capabilityData.id;
    for (const element of Object.keys(capabilityData.commands)) {
      if (this.shuttingDown) return;
      const common = { name: '', type: 'boolean', role: 'boolean', write: true, read: true };
      const letsubIdName = idName + '-' + element;
      let commandCreated = false;
      if (idName === 'ocf' && element === 'postOcfCommand') {
        const ocfDevice = this.ocfDeviceFactory.getOcfDevice(device.deviceManufacturerCode, device.presentationId);
        if (ocfDevice) {
          const ocfDeviceCommands = ocfDevice.getOcfCommands();
          for (const ocfDeviceCommandName in ocfDeviceCommands) {
            if (this.shuttingDown) return;
            const ocfDeviceCommand = ocfDeviceCommands[ocfDeviceCommandName];
            const relativeId = device.deviceId + '.capabilities.' + letsubIdName + '.' + ocfDeviceCommandName;
            await this.writeGuardedAdapter.setObjectNotExistsAsync(
              relativeId,
              {
                type: 'state',
                common: {
                  name: '',
                  type: ocfDeviceCommand.iobroker ? ocfDeviceCommand.iobroker.type : ocfDeviceCommand.type,
                  role: ocfDeviceCommand.iobroker ? ocfDeviceCommand.iobroker.type : ocfDeviceCommand.type,
                  min: ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.min ? ocfDeviceCommand.iobroker.min : 0,
                  max: ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.max ? ocfDeviceCommand.iobroker.max : 0,
                  states: ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.states ?
                    ocfDeviceCommand.iobroker.states : null,
                  write: true,
                  read: true,
                },
                native: {
                  type: 'OcfCommand',
                  deviceManufacturerCode: device.deviceManufacturerCode,
                  presentationId: device.presentationId,
                  deviceId: device.deviceId,
                  commandName: ocfDeviceCommandName,
                },
              },
            );
            if (!this.shuttingDown && !this.authorizationInvalid) {
              this.commandStateIds.set(relativeId, {
                deviceId: device.deviceId,
                capability: 'ocf',
                command: 'postOcfCommand.' + ocfDeviceCommandName,
              });
            }
          }
          commandCreated = true;
        }
      }
      if (!commandCreated) {
        const firstArgument = capabilityData.commands[element].arguments && capabilityData.commands[element].arguments[0];
        if (firstArgument && firstArgument.schema) {
          common.type = firstArgument.schema.type === 'integer' ? 'number' : firstArgument.schema.type;
          common.role = 'state';
          if (firstArgument.schema.enum) {
            common.states = {};
            for (const enumElement of firstArgument.schema.enum) common.states[enumElement] = enumElement;
          }
        }
        const relativeId = device.deviceId + '.capabilities.' + letsubIdName;
        await this.writeGuardedAdapter.setObjectNotExistsAsync(relativeId, {
          type: 'state', common, native: {},
        });
        if (!this.shuttingDown && !this.authorizationInvalid) {
          this.commandStateIds.set(relativeId, {
            deviceId: device.deviceId,
            capability: idName,
            command: element,
          });
        }
      }
    }
  }

  /**
   * Resolve available room display names without making device discovery
   * depend on room metadata being reachable.
   * @param {Array<object>} devices Valid SmartThings device-list items.
   * @returns {Promise<Map<string, string>>} Room ID to display name.
   */
  async getRoomNames(devices) {
    const roomNames = new Map();
    const locationIds = [...new Set(devices
      .map((device) => device && device.locationId)
      .filter((locationId) => typeof locationId === 'string' && locationId))];
    for (const locationId of locationIds) {
      if (this.shuttingDown || this.authorizationInvalid) break;
      try {
        const res = await this.requestApi({
          method: 'get',
          url: 'https://api.smartthings.com/v1/locations/' + locationId + '/rooms',
          headers: {
            'User-Agent': 'ioBroker',
            Authorization: 'Bearer ' + this.config.token,
          },
        });
        if (res && res.data && Array.isArray(res.data.items)) {
          for (const room of res.data.items) {
            if (room && typeof room.roomId === 'string' && typeof room.name === 'string') {
              roomNames.set(room.roomId, room.name);
            }
          }
        }
      } catch (error) {
        const status = error && typeof error === 'object' && error.response && error.response.status;
        if (status === 401 && !this.isStaleAuthorizationFailure(error)) {
          this.handleUnauthorizedResponse();
          break;
        }
        this.log.warn('SmartThings room metadata unavailable: ' + formatRequestError(error));
      }
    }
    return roomNames;
  }

  /**
   * Wait before a bounded device-list retry. The pending timer is cancelled by
   * onUnload() so shutdown neither starts another request nor keeps the
   * process alive for the remaining backoff.
   * @param {number} delayMs Backoff delay.
   * @returns {Promise<void>}
   */
  async waitForRetry(delayMs) {
    if (this.shuttingDown) {
      return;
    }
    await new Promise((resolve) => {
      const finish = () => {
        if (this.retryWaitTimeout) {
          clearTimeout(this.retryWaitTimeout);
          this.retryWaitTimeout = null;
        }
        if (this.retryWaitResolve === finish) {
          this.retryWaitResolve = null;
        }
        resolve(undefined);
      };
      this.retryWaitResolve = finish;
      this.retryWaitTimeout = setTimeout(finish, delayMs);
    });
  }

  /**
   * Release a pending device-list retry wait during shutdown.
   */
  cancelRetryWait() {
    if (this.retryWaitTimeout) {
      clearTimeout(this.retryWaitTimeout);
      this.retryWaitTimeout = null;
    }
    if (this.retryWaitResolve) {
      const resolveWait = this.retryWaitResolve;
      this.retryWaitResolve = null;
      resolveWait();
    }
  }

  /**
   * Track abortable SmartThings API requests so unload prevents follow-up
   * processing and releases queued network work. Authenticated requests also
   * carry the token generation they were dispatched with so late 401 responses
   * can be distinguished from failures of the current token.
   * @param {Record<string, any>} config Axios request configuration.
   * @returns {Promise<any>} Axios response.
   */
  async requestApi(config) {
    if (this.shuttingDown) throw Object.assign(new Error('adapter shutting down'), { code: 'ERR_CANCELED' });
    const tokenGeneration = this.tokenGeneration;
    const headers = config && config.headers;
    const authenticated = Boolean(headers && (headers.Authorization || headers.authorization));
    const controller = new AbortController();
    this.apiAbortControllers.add(controller);
    try {
      return await this.requestClient({ ...config, signal: controller.signal });
    } catch (error) {
      if (authenticated && error && typeof error === 'object') {
        error.tokenGeneration = tokenGeneration;
      }
      throw error;
    } finally {
      this.apiAbortControllers.delete(controller);
    }
  }

  async updateDevices(onlyVirtualSwitch) {
    if (this.authorizationInvalid || this.shuttingDown) {
      return;
    }
    for (const device of this.deviceArray) {
      if (this.shuttingDown || this.authorizationInvalid) return;
      if (onlyVirtualSwitch && device.type !== 'Virtual Switch') continue;
      await this.statusCoordinator.request(device.id);
    }
  }

  /**
   * Fetch and persist one canonical status for polling and SSE refreshes.
   * @param {{ id: string, type: string }} device Known enabled device.
   */
  async fetchDeviceStatus(device) {
    if (this.shuttingDown || this.authorizationInvalid) return;
    try {
      const res = await this.requestApi({
        method: 'get',
        url: 'https://api.smartthings.com/v1/devices/' + device.id + '/status',
        headers: {
          'User-Agent': 'ioBroker',
          Authorization: 'Bearer ' + this.config.token,
        },
      });
      if (this.shuttingDown || !res || !res.data) return;
      const written = await writeDeviceStatus(device.id, res.data, {
        parse: (path, data, options) => this.statusJson2iob.parse(path, data, options),
        cache: this.responseCache,
        rawCache: this.rawResponseCache,
        compactMode: this.config.compactMode,
        compact: compactStatus,
        excludeEndings: this.excludeStateEndingsArray,
        isActive: () => !this.shuttingDown && !this.authorizationInvalid,
      });
      if (written && !this.shuttingDown) {
        this.setState('info.connection', true, true);
      }
    } catch (error) {
      if (this.shuttingDown) return;
      const status = error && typeof error === 'object' && error.response && error.response.status;
      if (status === 401 && !this.isStaleAuthorizationFailure(error)) {
        this.handleUnauthorizedResponse();
        this.log.info('SmartThings status authorization expired; scheduling recovery');
        return;
      }
      if (status === 429) {
        this.log.warn('SmartThings status rate limit reached; waiting for scheduled polling');
        return;
      }
      this.log.error('Failed to update SmartThings device status: ' + formatRequestError(error));
    }
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  async onUnload(callback) {
    this.shuttingDown = true;
    this.statusCoordinator.close();
    for (const controller of this.apiAbortControllers) controller.abort();
    this.apiAbortControllers.clear();
    this.closeSseConnection();
    if (this.refreshInterval) {
      clearTimeout(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.cancelRetryWait();
    try {
      this.setState('info.connection', false, true);
      this.refreshTimeout && clearTimeout(this.refreshTimeout);
      this.updateInterval && clearInterval(this.updateInterval);
      clearInterval(this.updateVirtualInterval);
      if (this.config.codeUrl) {
        const adapterSettings = await this.getForeignObjectAsync('system.adapter.' + this.namespace);
        if (adapterSettings) {
          adapterSettings.native.codeUrl = null;
          await this.setForeignObjectAsync('system.adapter.' + this.namespace, adapterSettings);
        }
      }

      callback();
    } catch (e) {
      this.log.error(formatRequestError(e));
      callback();
    }
  }

  /**
   * Expose non-secret discovery data to the instance configuration UI. The UI
   * never receives a SmartThings access token and never calls Samsung itself.
   * @param {ioBroker.Message | null | undefined} obj Adapter message.
   */
  onMessage(obj) {
    if (!obj || obj.command !== 'getDiscoveredDevices' || !obj.callback) return;
    this.sendTo(obj.from, obj.command, {
      ok: this.deviceDiscoveryAvailable,
      connected: this.deviceDiscoveryAvailable && !this.authorizationInvalid && !this.shuttingDown,
      devices: this.discoveredDevices.map((device) => ({ ...device })),
    }, obj.callback);
  }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (this.shuttingDown || !state || state.ack) return;
    if (this.authorizationInvalid) {
      this.log.warn('SmartThings command ignored because authorization is invalid');
      return;
    }
    if (typeof id !== 'string' || !id.startsWith(this.namespace + '.')) return;
    const relativeId = id.slice(this.namespace.length + 1);
    const idParts = relativeId.split('.');
    // Feedback states and unknown paths are not executable commands.
    if (idParts.length < 3 || idParts[1] !== 'capabilities') return;
    const commandInfo = this.commandStateIds.get(relativeId);
    if (!commandInfo) return;

    const deviceId = commandInfo.deviceId;
    let data = { commands: [{ capability: commandInfo.capability, command: commandInfo.command }] };
    if (typeof state.val !== 'boolean') data.commands[0].arguments = [state.val];

    if (commandInfo.capability === 'ocf' && commandInfo.command.startsWith('postOcfCommand')) {
      const commandObject = await this.getForeignObjectAsync(id);
      if (this.shuttingDown || this.authorizationInvalid) return;
      if (!commandObject || !commandObject.native) {
        this.log.warn('SmartThings OCF command metadata unavailable; ignoring command');
        return;
      }
      const candidate = this.ocfDeviceFactory.getOcfCommandData(
        commandObject.native.deviceManufacturerCode,
        commandObject.native.presentationId,
        commandObject.native.deviceId,
        commandObject.native.commandName,
        state.val,
      );
      if (candidate === null) return;
      data = candidate;
    }

    if (this.shuttingDown || this.authorizationInvalid) return;
    this.log.debug('Sending SmartThings device command');
    try {
      await this.requestApi({
        method: 'post',
        url: 'https://api.smartthings.com/v1/devices/' + deviceId + '/commands',
        headers: {
          'User-Agent': 'ioBroker',
          Authorization: 'Bearer ' + this.config.token,
        },
        data,
      });
      if (!this.shuttingDown) this.log.debug('SmartThings device command accepted');
    } catch (error) {
      if (this.shuttingDown) return;
      if (error && typeof error === 'object' && error.response && error.response.status === 401 &&
        !this.isStaleAuthorizationFailure(error)) {
        this.handleUnauthorizedResponse();
      }
      this.log.error(formatRequestError(error));
    }
    if (!this.shuttingDown && !this.authorizationInvalid) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = setTimeout(async () => {
        await this.updateDevices();
      }, 10 * 1000);
    }
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Smartthings(options);
} else {
  // otherwise start the instance directly
  new Smartthings();
}
