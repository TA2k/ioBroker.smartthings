"use strict";

/*
 * Created with @iobroker/create-adapter v2.0.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios").default;
const Json2iob = require("./lib/json2iob");
const OcfDeviceFactory = require("./lib/ocf/ocfDeviceFactory");

class Smartthings extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: "smartthings",
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.requestClient = axios.create();
    this.updateInterval = null;
    this.reLoginTimeout = null;
    this.json2iob = new Json2iob(this);
    this.deviceArray = [];
    this.session = {};
    this.ocfDeviceFactory = new OcfDeviceFactory();
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Reset the connection indicator during startup
    this.setState("info.connection", false, true);
    if (this.config.interval < 1) {
      this.log.info("Set interval to minimum 1");
      this.config.interval = 1;
    }

    this.subscribeStates("*");
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
    } else {
      this.log.info("Please enter a Samsung Smartthings Token");
    }
  }

  async getDeviceList() {
    await this.requestClient({
      method: "get",
      url: "https://api.smartthings.com/v1/devices",
      headers: {
        "User-Agent": "ioBroker",
        Authorization: "Bearer " + this.config.token,
      },
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));

        this.setState("info.connection", true, true);
        this.log.info(res.data.items.length + " devices detected");
        for (const device of res.data.items) {
          this.deviceArray.push({ id: device.deviceId, type: device.deviceTypeName });
          await this.setObjectNotExistsAsync(device.deviceId, {
            type: "device",
            common: {
              name: device.label,
            },
            native: {},
          });
          await this.setObjectNotExistsAsync(device.deviceId + ".capabilities", {
            type: "channel",
            common: {
              name: "Capabilities/Remote Controls",
            },
            native: {},
          });
          await this.setObjectNotExistsAsync(device.deviceId + ".general", {
            type: "channel",
            common: {
              name: "General Information",
            },
            native: {},
          });

          const remoteArray = [];
          if (device.components && device.components[0] && device.components[0].capabilities) {
            device.components[0].capabilities.forEach(async (capability) => {
              await this.requestClient({
                method: "get",
                url: "https://api.smartthings.com/v1/capabilities/" + capability.id + "/" + capability.version,
                headers: {
                  "User-Agent": "ioBroker",
                  Authorization: "Bearer " + this.config.token,
                },
              })
                .then(async (res) => {
                  this.log.debug(JSON.stringify(res.data));
                  const idName = res.data.id;
                  Object.keys(res.data.commands).forEach(async (element) => {
                    const common = {
                      name: "",
                      type: "boolean",
                      role: "boolean",
                      write: true,
                      read: true,
                    };
                    const letsubIdName = idName + "-" + element;

                    let commandCreated = false;
                    if (idName === "ocf" && element === "postOcfCommand") {
                      const ocfDevice = this.ocfDeviceFactory.getOcfDevice(device.deviceManufacturerCode, device.presentationId);
                      if (ocfDevice) {
                        const ocfDeviceCommands = ocfDevice.getOcfCommands();
                        for (const ocfDeviceCommandName in ocfDeviceCommands) {
                          const ocfDeviceCommand = ocfDeviceCommands[ocfDeviceCommandName];

                          const objectRaw = {
                            type: "state",
                            common: {
                              name: "",
                              type: ocfDeviceCommand.iobroker ? ocfDeviceCommand.iobroker.type : ocfDeviceCommand.type,
                              role: ocfDeviceCommand.iobroker ? ocfDeviceCommand.iobroker.type : ocfDeviceCommand.type,
                              min: ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.min ? ocfDeviceCommand.iobroker.min : 0,
                              max: ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.max ? ocfDeviceCommand.iobroker.max : 0,
                              states: ocfDeviceCommand.iobroker && ocfDeviceCommand.iobroker.states ? ocfDeviceCommand.iobroker.states : null,
                              write: true,
                              read: true,
                            },
                            native: {
                              type: "OcfCommand",
                              deviceManufacturerCode: device.deviceManufacturerCode,
                              presentationId: device.presentationId,
                              deviceId: device.deviceId,
                              commandName: ocfDeviceCommandName,
                            },
                          };
                          await this.setObjectNotExistsAsync(
                            device.deviceId + ".capabilities." + letsubIdName + "." + ocfDeviceCommandName,
                            objectRaw
                          );
                        }
                        commandCreated = true;
                      }
                    }

                    if (!commandCreated) {
                      if (res.data.commands[element].arguments[0]) {
                        common.type = res.data.commands[element].arguments[0].schema.type;
                        if (common.type === "integer") {
                          common.type = "number";
                        }
                        common.role = "state";
                        if (res.data.commands[element].arguments[0].schema.enum) {
                          common.states = {};
                          res.data.commands[element].arguments[0].schema.enum.forEach((enumElement) => {
                            common.states[enumElement] = enumElement;
                          });
                        }
                      }
                      await this.setObjectNotExistsAsync(device.deviceId + ".capabilities." + letsubIdName, {
                        type: "state",
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
          await this.json2iob.parse(device.deviceId + ".general", device);
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
        path: "status",
        url: "https://api.smartthings.com/v1/devices/$id/status",
        desc: "Status of the device",
      },
    ];

    const headers = {
      "User-Agent": "ioBroker",
      Authorization: "Bearer " + this.config.token,
    };
    this.deviceArray.forEach(async (device) => {
      if (onlyVirtualSwitch) {
        if (device.type !== "Virtual Switch") {
          return;
        }
      }
      statusArray.forEach(async (element) => {
        const url = element.url.replace("$id", device.id);

        await this.requestClient({
          method: "get",
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
            const forceIndex = null;
            const preferedArrayName = null;

            await this.json2iob.parse(device.id + "." + element.path, data, {
              forceIndex: forceIndex,
              preferedArrayName: preferedArrayName,
              channelName: element.desc,
            });
          })
          .catch((error) => {
            if (error.response && error.response.status === 401) {
              error.response && this.log.debug(JSON.stringify(error.response.data));
              this.log.info(element.path + " receive 401 error. Please use new Token");

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
      this.setState("info.connection", false, true);
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
        const idArray = id.split(".");
        const deviceId = idArray[2];
        idArray.splice(0, 4);
        let capadId = idArray.join(".");
        const commandId = capadId.split("-")[1];
        capadId = capadId.split("-")[0];

        let data = { commands: [{ capability: capadId, command: commandId }] };
        if (typeof state.val !== "boolean") {
          data.commands[0].arguments = [state.val];
        }

        if (capadId === "ocf" && commandId.startsWith("postOcfCommand")) {
          const commandObject = await this.getForeignObjectAsync(id).then((result) => result);
          if (commandObject) {
            const candidate = this.ocfDeviceFactory.getOcfCommandData(
              commandObject.native.deviceManufacturerCode,
              commandObject.native.presentationId,
              commandObject.native.deviceId,
              commandObject.native.commandName,
              state.val
            );
            if (candidate !== null) {
              data = candidate;
            }
          }
        }

        this.log.info(JSON.stringify(data));
        await this.requestClient({
          method: "post",
          url: "https://api.smartthings.com/v1/devices/" + deviceId + "/commands",
          headers: {
            "User-Agent": "ioBroker",
            Authorization: "Bearer " + this.config.token,
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
