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
const crypto = require('crypto');
const qs = require('qs');

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
    this.requestClient = axios.create();
    this.updateInterval = null;
    this.reLoginTimeout = null;
    this.json2iob = new Json2iob(this);
    this.deviceArray = [];
    this.session = {};
    this.ocfDeviceFactory = new OcfDeviceFactory();
    this.session = {};
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Reset the connection indicator during startup
    this.setState('info.connection', false, true);
    if (this.config.interval < 1) {
      this.log.info('Set interval to minimum 1');
      this.config.interval = 1;
    }

    this.subscribeStates('*');
    if (!this.config.username || !this.config.token) {
      this.log.info('Please enter a Samsung Smartthings Username and code url  in the instance settings');
      return;
    }
    if (this.config.username) {
      const authState = await this.getStateAsync('authInformation.session');
      if (authState && authState.val) {
        this.session = JSON.parse(authState.val);
        this.log.info('Use existing session to login');
        await this.refreshToken();
      } else {
        await this.login();
      }
    }
    if (this.config.token) {
      await this.getDeviceList();
      await this.updateDevices();
      this.updateInterval = setInterval(async () => {
        await this.updateDevices();
      }, this.config.interval * 1000);
      if (this.config.virtualInterval > 0) {
        this.updateVirtualInterval = setInterval(async () => {
          await this.updateDevices(true);
        }, this.config.virtualInterval * 1000);
      }
      this.session.expires_in = this.session.expires_in || 86400;
      this.refreshInterval = this.setInterval(async () => {
        await this.refreshToken();
      }, this.session.expires_in * 1000);
    } else {
      this.log.info('Please enter a Samsung Smartthings Token');
    }
  }

  async login() {
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
      return;
    }
    const parameter = qs.parse(this.config.codeUrl.split('?')[1]);
    if (!parameter.code) {
      this.log.error('No Code found in the codeUrl');
      return;
    }
    const subKey = Buffer.from(initialPayload.state.substring(0, 32), 'utf8').toString('base64');

    let decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(subKey, 'base64').subarray(0, 16), Buffer.from(this.iv, 'base64'));
    decipher.setAutoPadding(true);
    let codeDecrypted = decipher.update(Buffer.from(parameter.code, 'hex'), undefined, 'utf8');
    codeDecrypted += decipher.final('utf8');
    this.log.debug(codeDecrypted);
    //reset decipher
    decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(subKey, 'base64').subarray(0, 16), Buffer.from(this.iv, 'base64'));
    let username = decipher.update(Buffer.from(parameter.retValue, 'hex'), undefined, 'utf8');
    username += decipher.final('utf8');

    decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(subKey, 'base64').subarray(0, 16), Buffer.from(this.iv, 'base64'));
    let keyInformation = decipher.update(Buffer.from(parameter.state, 'hex'), undefined, 'utf8');
    //eslint-disable-next-line
    keyInformation += decipher.final('utf8');
    this.log.info('Found code for user: ' + username);
    const userInfos = await this.requestClient({
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
        this.log.debug(JSON.stringify(res.data));
        return res.data;
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
        this.log.error('Please use a new code url');
      });
    if (!userInfos || !userInfos.userauth_token) {
      this.log.error('No userauth_token found');
      return;
    }
    const codeInfos = await this.requestClient({
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
        this.log.debug(JSON.stringify(res.data));
        return res.data;
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
    await this.requestClient({
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
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        await this.extendObject('authInformation', {
          type: 'channel',
          common: {
            name: 'Auth Information',
          },
          native: {},
        });
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
        this.log.info('Login successful.');
        await this.setState('authInformation.session', JSON.stringify(this.session), true);
        this.config.token = res.data.access_token;
        return res.data;
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }

  async refreshToken() {
    if (!this.session.refresh_token) {
      this.log.debug('No refresh_token found');
      return;
    }
    this.log.debug('Start refresh token');
    await this.requestClient({
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
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        await this.setState('authInformation.session', JSON.stringify(this.session), true);
        this.config.token = res.data.access_token;
        return res.data;
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
        this.log.error('Refresh Token failed please delete authInformation.session and enter a new code Url');
      });
  }

  async getDeviceList() {
    await this.requestClient({
      method: 'get',
      url: 'https://api.smartthings.com/v1/devices',
      headers: {
        'User-Agent': 'ioBroker',
        Authorization: 'Bearer ' + this.config.token,
      },
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));

        this.setState('info.connection', true, true);
        this.log.info(res.data.items.length + ' devices detected');
        for (const device of res.data.items) {
          const exlcudeList = this.config.excludeDevices.replace(/ /g, '').split(',');
          if (exlcudeList && exlcudeList.includes(device.deviceId)) {
            this.log.info('Ignore ' + device.deviceId);
            continue;
          }
          this.deviceArray.push({ id: device.deviceId, type: device.deviceTypeName });
          await this.setObjectNotExistsAsync(device.deviceId, {
            type: 'device',
            common: {
              name: device.label,
            },
            native: {},
          });
          await this.setObjectNotExistsAsync(device.deviceId + '.capabilities', {
            type: 'channel',
            common: {
              name: 'Capabilities/Remote Controls',
            },
            native: {},
          });
          await this.setObjectNotExistsAsync(device.deviceId + '.general', {
            type: 'channel',
            common: {
              name: 'General Information',
            },
            native: {},
          });

          // const remoteArray = [];
          if (device.components && device.components[0] && device.components[0].capabilities) {
            device.components[0].capabilities.forEach(async (capability) => {
              await this.requestClient({
                method: 'get',
                url: 'https://api.smartthings.com/v1/capabilities/' + capability.id + '/' + capability.version,
                headers: {
                  'User-Agent': 'ioBroker',
                  Authorization: 'Bearer ' + this.config.token,
                },
              })
                .then(async (res) => {
                  this.log.debug(JSON.stringify(res.data));
                  const idName = res.data.id;
                  Object.keys(res.data.commands).forEach(async (element) => {
                    const common = {
                      name: '',
                      type: 'boolean',
                      role: 'boolean',
                      write: true,
                      read: true,
                    };
                    const letsubIdName = idName + '-' + element;

                    let commandCreated = false;
                    if (idName === 'ocf' && element === 'postOcfCommand') {
                      const ocfDevice = this.ocfDeviceFactory.getOcfDevice(device.deviceManufacturerCode, device.presentationId);
                      if (ocfDevice) {
                        const ocfDeviceCommands = ocfDevice.getOcfCommands();
                        for (const ocfDeviceCommandName in ocfDeviceCommands) {
                          const ocfDeviceCommand = ocfDeviceCommands[ocfDeviceCommandName];

                          const objectRaw = {
                            type: 'state',
                            common: {
                              name: '',
                              type: ocfDeviceCommand.iobroker ? ocfDeviceCommand.iobroker.type : ocfDeviceCommand.type,
                              role: ocfDeviceCommand.iobroker ? ocfDeviceCommand.iobroker.type : ocfDeviceCommand.type,
                              min: ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.min ? ocfDeviceCommand.iobroker.min : 0,
                              max: ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.max ? ocfDeviceCommand.iobroker.max : 0,
                              states:
                                ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.states ? ocfDeviceCommand.iobroker.states : null,
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
                          };
                          await this.setObjectNotExistsAsync(
                            device.deviceId + '.capabilities.' + letsubIdName + '.' + ocfDeviceCommandName,
                            objectRaw,
                          );
                        }
                        commandCreated = true;
                      }
                    }

                    if (!commandCreated) {
                      if (res.data.commands[element].arguments[0]) {
                        common.type = res.data.commands[element].arguments[0].schema.type;
                        if (common.type === 'integer') {
                          common.type = 'number';
                        }
                        common.role = 'state';
                        if (res.data.commands[element].arguments[0].schema.enum) {
                          common.states = {};
                          res.data.commands[element].arguments[0].schema.enum.forEach((enumElement) => {
                            common.states[enumElement] = enumElement;
                          });
                        }
                      }
                      await this.setObjectNotExistsAsync(device.deviceId + '.capabilities.' + letsubIdName, {
                        type: 'state',
                        common: common,
                        native: {},
                      });
                    }
                  });
                })
                .catch((error) => {
                  this.log.error(error);
                  error.response && this.log.error(JSON.stringify(error.response.data));
                });
            });
          }
          await this.json2iob.parse(device.deviceId + '.general', device);
        }
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }

  async updateDevices(onlyVirtualSwitch) {
    const statusArray = [
      {
        path: 'status',
        url: 'https://api.smartthings.com/v1/devices/$id/status',
        desc: 'Status of the device',
      },
    ];

    const headers = {
      'User-Agent': 'ioBroker',
      Authorization: 'Bearer ' + this.config.token,
    };
    this.deviceArray.forEach(async (device) => {
      if (onlyVirtualSwitch) {
        if (device.type !== 'Virtual Switch') {
          return;
        }
      }
      statusArray.forEach(async (element) => {
        const url = element.url.replace('$id', device.id);

        await this.requestClient({
          method: 'get',
          url: url,
          headers: headers,
        })
          .then(async (res) => {
            this.log.debug(JSON.stringify(res.data));
            if (!res.data) {
              return;
            }
            let data = res.data;
            let keys = Object.keys(data);
            if (keys.length === 1) {
              data = data[keys[0]];
            }
            keys = Object.keys(data);
            if (keys.length === 1) {
              data = data[keys[0]];
            }
            const forceIndex = undefined;
            const preferedArrayName = undefined;

            await this.json2iob.parse(device.id + '.' + element.path, data, {
              forceIndex: forceIndex,
              preferedArrayName: preferedArrayName,
              channelName: element.desc,
              excludeStateWithEnding: this.config.exclude.replace(/ /g, '').split(','),
            });
          })
          .catch((error) => {
            if (error.response && error.response.status === 401) {
              error.response && this.log.debug(JSON.stringify(error.response.data));
              this.log.info(element.path + ' receive 401 error. Please use new Token');

              return;
            }

            this.log.error(url);
            this.log.error(error);
            error.response && this.log.error(JSON.stringify(error.response.data));
          });
      });
    });
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  async onUnload(callback) {
    try {
      this.setState('info.connection', false, true);
      clearTimeout(this.refreshTimeout);
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
      this.log.error(e);
      callback();
    }
  }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (state) {
      if (!state.ack) {
        const idArray = id.split('.');
        const deviceId = idArray[2];
        idArray.splice(0, 4);
        let capadId = idArray.join('.');
        const commandId = capadId.split('-')[1];
        capadId = capadId.split('-')[0];

        let data = { commands: [{ capability: capadId, command: commandId }] };
        if (typeof state.val !== 'boolean') {
          data.commands[0].arguments = [state.val];
        }

        if (capadId === 'ocf' && commandId.startsWith('postOcfCommand')) {
          const commandObject = await this.getForeignObjectAsync(id).then((result) => result);
          if (commandObject) {
            const candidate = this.ocfDeviceFactory.getOcfCommandData(
              commandObject.native.deviceManufacturerCode,
              commandObject.native.presentationId,
              commandObject.native.deviceId,
              commandObject.native.commandName,
              state.val,
            );
            if (candidate !== null) {
              data = candidate;
            }
          }
        }

        this.log.info(JSON.stringify(data));
        await this.requestClient({
          method: 'post',
          url: 'https://api.smartthings.com/v1/devices/' + deviceId + '/commands',
          headers: {
            'User-Agent': 'ioBroker',
            Authorization: 'Bearer ' + this.config.token,
          },
          data: data,
        })
          .then((res) => {
            this.log.info(JSON.stringify(res.data));
            return res.data;
          })
          .catch((error) => {
            this.log.error(error);
            if (error.response) {
              this.log.error(JSON.stringify(error.response.data));
            }
          });
        clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(async () => {
          await this.updateDevices();
        }, 10 * 1000);
      }
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
