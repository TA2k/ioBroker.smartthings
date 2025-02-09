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
const moment = require('moment');

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
    this.access_token = '';
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

    const access_code = await this.getStateAsync('access_data.access_code');
    if (access_code && access_code.val !== this.config.access_code) {
      await this.refreshAccessToken(0);
    }
    // Token aktualisieren
    await this.checkAccessToken();

    const state = await this.getStateAsync('access_data.access_token');
    if (state){
      this.access_token = String(state.val);
    }

    if (this.access_token) {
      await this.getDeviceList();
      await this.updateDevices();
      this.updateInterval = setInterval(async () => {
        await this.checkAccessToken();
        await this.updateDevices();
      }, this.config.interval * 1000);
      if (this.config.virtualInterval > 0) {
        this.updateVirtualInterval = setInterval(async () => {
          await this.updateDevices(true);
        }, this.config.virtualInterval * 1000);
      }
    } else {
      this.log.info('Please enter a Samsung Smartthings Access Code');
    }
  }

  async checkAccessToken(){
    const states = await this.getStatesAsync('access_data.*');
    if (states){
      if(moment(new Date(String(states[`${this.namespace}.access_data.timestamp_token`].val))).add(this.config.interval_refresh_token, 'days').valueOf() <= moment().valueOf()){
        this.log.info('Please enter a Samsung Smartthings Access Code');
        this.setForeignState('system.adapter.' + this.namespace + '.alive', false);
      }
      if(moment(new Date(String(states[`${this.namespace}.access_data.token_valid_until`].val))).valueOf() <= moment().valueOf()){
        this.refreshAccessToken(1, String(states[`${this.namespace}.access_data.refresh_token`].val));
      }
    }
  }

  async refreshAccessToken(type, refresh_token = '') {
    let params = '';
    try {
      if (type === 0){
        console.log('CHECK');
        params = 'grant_type=authorization_code&client_id=' + this.config.client_id.trim() + '&code=' + this.config.access_code.trim() + '&redirect_uri=' +this.config.redirect_uri.trim();
      }else{
        console.log('UPDATE TOKEN');
        params = 'grant_type=refresh_token&client_id=' + this.config.client_id.trim() + '&refresh_token=' + refresh_token.trim();
      }
      await this.requestClient.post(
        'https://api.smartthings.com/oauth/token',
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          auth: {
            username: this.config.client_id.trim(),
            password: this.config.client_secret.trim()
          }
        }
      )
        .then(async (res) => {
          this.log.debug(JSON.stringify(res.data));
          this.access_token = res.data.access_token;
          this.setStateAsync('access_data.access_code', { val: this.config.access_code, ack: true });
          this.setStateAsync('access_data.access_token', { val: this.access_token, ack: true });
          this.setStateAsync('access_data.refresh_token', { val: res.data.refresh_token, ack: true });
          // this.setStateAsync('access_data.timestamp_token', { val: Math.floor(Date.now() / 1000), ack: true });
          // this.setStateAsync('access_data.token_valid_until', { val: Math.floor(Date.now() / 1000 + 36006), ack: true }); //86340 23:59
          this.setStateAsync('access_data.timestamp_token', { val: moment().toJSON(), ack: true });
          this.setStateAsync('access_data.token_valid_until', { val: moment().add(this.config.interval_access_token, 'hours').toJSON(), ack: true });
          this.log.info('Access token has been refreshed');
          this.setState('info.connection', true, true);
        });
    }catch(error) {
      console.error('Error in refreshAccessToken: ', error);
      this.setForeignState('system.adapter.' + this.namespace + '.alive', false);
      this.setStateAsync('info.connection', { val: false, ack: true });
      this.log.error('Error refreshing access token: ' + error);
    }
  }

  async getDeviceList() {
    await this.requestClient({
      method: 'get',
      url: 'https://api.smartthings.com/v1/devices',
      headers: {
        'User-Agent': 'ioBroker',
        Authorization: 'Bearer ' + this.access_token,
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
                  Authorization: 'Bearer ' + this.access_token,
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
                            Object(objectRaw),
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
                      const objectRaw = {
                        type: 'state',
                        common: common,
                        native: {},
                      };
                      await this.setObjectNotExistsAsync(
                        device.deviceId + '.capabilities.' + letsubIdName,
                        Object(objectRaw)
                      );
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
      Authorization: 'Bearer ' + this.access_token,
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
  onUnload(callback) {
    try {
      this.setState('info.connection', false, true);
      clearTimeout(this.refreshTimeout);
      this.updateInterval && clearInterval(this.updateInterval);
      clearInterval(this.updateVirtualInterval);
      callback();
    } catch (e) {
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
            Authorization: 'Bearer ' + this.access_token,
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
