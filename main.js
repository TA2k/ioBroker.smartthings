"use strict";

/*
 * Created with @iobroker/create-adapter v2.0.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios");
const Json2iob = require("./lib/json2iob");
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
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }
        this.requestClient = axios.create();
        this.updateInterval = null;
        this.reLoginTimeout = null;
        this.json2iob = new Json2iob(this);
        this.deviceArray = [];
        this.session = {};
        this.subscribeStates("*");

        if (this.config.token) {
            await this.getDeviceList();
            await this.updateDevices();
            this.updateInterval = setInterval(async () => {
                await this.updateDevices();
            }, this.config.interval * 60 * 1000);
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
                for (const device of res.data.items) {
                    this.deviceArray.push(device.deviceId);
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
                        device.components[0].capabilities.forEach((capability) => {
                            const idName = capability.id.replace(/\./g, "-");
                            this.setObjectNotExists(device.deviceId + ".capabilities." + idName, {
                                type: "state",
                                common: {
                                    name: "",
                                    type: "mixed",
                                    role: "state",
                                    write: true,
                                    read: true,
                                },
                                native: {},
                            });
                        });
                    }
                    this.json2iob.parse(device.deviceId + ".general", device);
                    await this.requestClient({
                        method: "get",
                        url: "https://api.smartthings.com/v1/devices/" + device.deviceId + "/states",
                        headers: {
                            "User-Agent": "ioBroker",
                            Authorization: "Bearer " + this.config.token,
                        },
                    })
                        .then(async (res) => {
                            this.log.debug(JSON.stringify(res.data));
                            let data = res.data;
                            let keys = Object.keys(data);
                            if (keys.length === 1) {
                                data = res.data[keys[0]];
                            }
                            keys = Object.keys(res.data);
                            if (keys.length === 1) {
                                data = res.data[keys[0]];
                            }
                            this.json2iob.parse(device.deviceId + ".states", data);
                        })
                        .catch((error) => {
                            this.log.error(error);
                            error.response && this.log.error(JSON.stringify(error.response.data));
                        });
                }
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async updateDevices() {
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
        this.deviceArray.forEach(async (id) => {
            statusArray.forEach(async (element) => {
                const url = element.url.replace("$id", id);

                await this.requestClient({
                    method: "get",
                    url: url,
                    headers: headers,
                })
                    .then((res) => {
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

                        this.json2iob.parse(id + "." + element.path, data, { forceIndex: forceIndex, preferedArrayName: preferedArrayName, channelName: element.desc });
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
            clearInterval(this.updateInterval);
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
                const deviceId = id.split(".")[2];
                let commandId = id.split(".")[4];
                commandId = commandId.replace(/\-/g, ".");
                const data = { commands: [{ capability: commandId, command: commandId }] };
                this.log.debug(JSON.stringify(data));
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
