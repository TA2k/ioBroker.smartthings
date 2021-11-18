OCF basically translates into "Open Connectivity Foundation". So, any device, Smartthings is exposing with an "sendOcfCommand" capability, should be enabled to recieve a specific command and parameters.
Having bought a new Soundbar as well as a new TV recently, I realized soon that Samsung (and its public SDK/API) not to on a par with their Smartthings (Android) App. Which was kind of a problem for me, just because, I wanted to continue to use my Logitech Harmony to talk to something that enables me to control the Nightmode as well as the Voice Amplifier option from that remote.
Also, I wanted to be able to specifically chose the input the Soundbar is listening for, so I was looking for a solution.

After some research and looking into the following
- https://sites.google.com/view/samsungwirelessaudiomultiroom/
- https://github.com/wdrc/WAM_API_DOC
- https://github.com/DaveGut/DEPRECATED-SmartThings_Samsung-WiFi-Audio-Unofficial/blob/master/0%20-%20DeviceHandler/Samsung%20WiFi%20Audio%20DH-V4.groovy
- https://github.com/SmartThingsCommunity/smartthings-cli
- https://openconnectivityfoundation.github.io/development-support/DeviceSpy/

I just found out that there has to be a better way to understand what Smartthings is doing.
So, the new plan was to have a look into their APK & Code, so I can reverse engineer. Downloading the APK from somewhere and using a Java decompiler (https://github.com/skylot/jadx) I run into a wall just one more time. Just because the main APK is nothing but the main implementation of something that can be used to host custom plugins for the specific devices found in your setup. So I had to somehow get the plugin APK to decompile... Then I realized that I cannot access the data folder on my device anymore just because Google locked down things... :) I hear you say: root? Yeah, thats exactly what I have done next. Instead of breaking my real Pixel 5, I have installed Android Studio, installed a fresh SDK (with a link to Google PlayStore) and started to root this using
- https://forum.xda-developers.com/t/script-rootavd-root-your-android-studio-virtual-device-emulator-with-magisk-android-12-linux-darwin-macos-win-google-play-store-apis.4218123/

to get access to the Android data folder within the AVD. Thankfully, that has been quite straight forward, so after root, I just installed a File Explorer as well as SmartThings, logged in (so to have Smartthing download its plugins) and then grabbed LifeStyleAudio Plugin.apk from the virtual Android device.

Actually, just as a side note, I have not been able to talk to my Soundbar nor my TV from within the virtual device, but I have now had the codes to start understanding things. Looking into the resource file they have just had to compile into their APK, I was able to quite soon find the corresponding lines of code responsible to control Nightmode as well as Voice Amplifier but, as I am totally off when it comes to Android development, I wasn't able to actually trace down the individual command they are sending. BUT! I just found out that they are using the Android Log a LOT! :)

Thanks to adb logcat (and enabling USB debugging on my device), I was now able to at least capture some of the objects they are sending out somewhere... Anything else, by looking into their Smartthings API description, was just trail and error until I have found the correct command to be send. Your command structure into an OCF device is something like the following.

Control Nightmode for HW-Q900A
```
POST https://api.smartthings.com/devices/{deviceId}}/commands
Auth: Bearer Token
Body:
{
    "commands":[
        {
            "component":"main",
            "capability":"ocf",
            "command":"postOcfCommand",
            "arguments":[
                "/oic/route/{deviceId}/sec/networkaudio/advancedaudio",
                {
                    "x.com.samsung.networkaudio.nightmode": 0
                }
            ]
        }
    ]
}

```

Control Voice amplifier for HW-Q900A
```
POST https://api.smartthings.com/devices/{deviceId}}/commands
Auth: Bearer Token
Body:
{
    "commands":[
        {
            "component":"main",
            "capability":"ocf",
            "command":"postOcfCommand",
            "arguments":[
                "/oic/route/{deviceId}/sec/networkaudio/advancedaudio",
                {
                    "x.com.samsung.networkaudio.voiceamplifier": 0
                }
            ]
        }
    ]
}

```

Control bass boost for HW-Q900A
```
POST https://api.smartthings.com/devices/{deviceId}}/commands
Auth: Bearer Token
Body:
{
    "commands":[
        {
            "component":"main",
            "capability":"ocf",
            "command":"postOcfCommand",
            "arguments":[
                "/oic/route/{deviceId}/sec/networkaudio/advancedaudio",
                {
                    "x.com.samsung.networkaudio.bassboost": 0
                }
            ]
        }
    ]
}

```

Control sound mode for HW-Q900A
```
POST https://api.smartthings.com/devices/{deviceId}}/commands
Auth: Bearer Token
Body:
{
    "commands":[
        {
            "component":"main",
            "capability":"ocf",
            "command":"postOcfCommand",
            "arguments":[
                "/oic/route/{deviceId}/sec/networkaudio/soundmode",
                {
                    "x.com.samsung.networkaudio.soundmode": "adaptive sound"
                }
            ]
        }
    ]
}

```

Control sound source for HW-Q900A
```
POST https://api.smartthings.com/devices/{deviceId}}/commands
Auth: Bearer Token
Body:
{
    "commands":[
        {
            "component":"main",
            "capability":"ocf",
            "command":"postOcfCommand",
            "arguments":[
                "/oic/route/{deviceId}/sec/networkaudio/soundFrom",
                {
                    "x.com.samsung.networkaudio.soundFrom": {
                        "status":1,
                        "name":"External Device",
                        "groupName":"",
                        "duid":"",
                        "sbMode":1,
                        "mac":"",
                        "di":"",
                        "deviceType":4,
                        "ip":"",
                        "connectionType":"D-IN/TV ARC"
                    },
                    "x.com.samsung.networkaudio.sbMode": 1,
                    "x.com.samsung.networkaudio.name": "External Device"
                }
            ]
        }
    ]
}

```