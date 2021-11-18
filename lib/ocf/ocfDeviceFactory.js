const ocfDevices = {
    "Samsung Electronics~VD-NetworkAudio-002S": {
        getOcfCommands: function() {
            return {
                nightmode: {
                    href: "/sec/networkaudio/advancedaudio",
                    type: "boolean",
                    translate: function(value) {
                        return {
                            "x.com.samsung.networkaudio.nightmode": value ? 1 : 0
                        };
                    }
                },
                voiceamplifier: {
                    href: "/sec/networkaudio/advancedaudio",
                    type: "boolean",
                    translate: function(value) {
                        return {
                            "x.com.samsung.networkaudio.voiceamplifier": value ? 1 : 0
                        };
                    }
                },
                bassboost: {
                    href: "/sec/networkaudio/advancedaudio",
                    type: "boolean",
                    translate: function(value) {
                        return {
                            "x.com.samsung.networkaudio.bassboost": value ? 1 : 0
                        };
                    }
                },
                soundmode: {
                    href: "/sec/networkaudio/soundmode",
                    iobroker: {
                        type: "number",
                        min: 0,
                        max: 3,
                        states: "0:Standard;1:Surround;2:Game;3:Adaptive Sound",
                        convert: function(value) {
                            switch (value) {
                                case 1:
                                    return "surround";
                                case 2:
                                    return "game";
                                case 3:
                                    return "adaptive sound";
                                default:
                                    return "standard";
                            }
                        }
                    },
                    translate: function(value) {
                        return {
                            "x.com.samsung.networkaudio.soundmode": value
                        };
                    }
                },
                soundfrom: {
                    href: "/sec/networkaudio/soundFrom",
                    iobroker: {
                        type: "number",
                        min: 0,
                        max: 1,
                        states: "0:Digital;1:Wifi",
                        convert: function(value) {
                            switch (value) {
                                case 0:
                                    return "digital";
                                case 1:
                                    return "wifi";
                            }
                        }
                    },
                    translate: function(value) {
                        let parameter = {};
                        let sbMode = 0;
                        let deviceName = "";

                        switch (value) {
                            case "digital":
                                parameter = {"status":1,"name":"External Device","groupName":"","duid":"","sbMode":1,"mac":"","di":"","deviceType":4,"ip":"","connectionType":"D-IN/TV ARC"};
                                sbMode = 1;
                                deviceName = "External Device";
                                break;
                            case "wifi":
                                parameter = {"status":1,"name":"Samsung QN95AA 75 TV","groupName":"[AV] Samsung Soundbar Q900A","duid":"","sbMode":9,"mac":"","di":"","deviceType":1,"ip":"","connectionType":"WIFI"};
                                sbMode = 9;
                                deviceName = "Samsung QN95AA 75 TV";
                                break;
                        }

                        return {
                            "x.com.samsung.networkaudio.soundFrom": parameter,
                            "x.com.samsung.networkaudio.sbMode": sbMode,
                            "x.com.samsung.networkaudio.name": deviceName
                        };
                    }
                }
            };
        }
    }
};

module.exports = class OcfDeviceFactory {
    constructor() {
    }

    getOcfDevice(deviceManufacturerCode, presentationId) {
        return ocfDevices[`${deviceManufacturerCode}~${presentationId}`];
    }

    getOcfCommandData(deviceManufacturerCode, presentationId, deviceId, commandName, value) {
        const ocfDevice = this.getOcfDevice(deviceManufacturerCode, presentationId);
        if (!ocfDevice) {
            return null;
        }

        const commands = ocfDevice.getOcfCommands();
        if (!commands) {
            return null;
        }

        const command = commands[commandName];
        if (!command) {
            return null;
        }

        let converted = value;
        if (command.iobroker) {
            converted = command.iobroker.convert(value);
        }

        const attributes = command.translate(converted);
        return {
            "commands":[
                {
                    "component":"main",
                    "capability":"ocf",
                    "command":"postOcfCommand",
                    "arguments":[
                        `/oic/route/${deviceId}${command.href}`,
                        attributes
                    ]
                }
            ]
        };
    }
};