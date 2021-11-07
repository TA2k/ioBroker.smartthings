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

        const attributes = command.translate(value);
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