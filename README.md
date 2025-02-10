![Logo](admin/smartthings.png)

# ioBroker.smartthings

[![NPM version](https://img.shields.io/npm/v/iobroker.smartthings.svg)](https://www.npmjs.com/package/iobroker.smartthings)
[![Downloads](https://img.shields.io/npm/dm/iobroker.smartthings.svg)](https://www.npmjs.com/package/iobroker.smartthings)
![Number of Installations](https://iobroker.live/badges/smartthings-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/smartthings-stable.svg)
[![Dependency Status](https://img.shields.io/david/TA2k/iobroker.smartthings.svg)](https://david-dm.org/TA2k/iobroker.smartthings)

[![NPM](https://nodei.co/npm/iobroker.smartthings.png?downloads=true)](https://nodei.co/npm/iobroker.smartthings/)

**Tests:** ![Test and Release](https://github.com/TA2k/ioBroker.smartthings/workflows/Test%20and%20Release/badge.svg)

## smartthings adapter for ioBroker

Adapter for Samsung Smartthings

## Login process:

To use this appdater you must first set up an app at SmartThings.com.

### 1. Requirements to set up apps at SmartThings.com:
The easiest way to do this is to install the SmartThings CLI on the local computer.
	
You can find it here: https://github.com/SmartThingsCommunity/smartthings-cli/releases
	
Instructions here: https://developer.smartthings.com/docs/sdks/cli/introduction
	
Install accordingly depending on your operating system.
	
### 2. Create app:
Run smartthing apps:create in the console
	
Go through the login process in the browser (I did this with Windows, so it may differ for other operating systems)
	
Select OAuth-In app (currently only option)
	
Enter display name -> e.g. B iobroker
	
Enter description -> e.g. app for iobroker
	
Icon Image URL (optional) -> Link to an icon
	
Target URL (optional) -> click Enter (currently not tested)
	
Select Scopes -> Select Devices r, w, x (rest currently not tested)
	
Add Redirect URI -> a link must be entered here that can display a redirect URI.

Tested are: 

https://httpbin.org/get

https://echo.free.beeceptor.com/sample-request
					
You can also use your own servers. Accessibility via https on the Internet must be given. Local addresses don't work (this is only important for authentication).
Multiple URLs can also be stored.
		
Finish editing Redirect URIs -> click
	
Finish and create OAuth-In SmartApp -> click
	
Then a confirmation will be displayed:
	
	Basic App Data:
	────────────────────────────────────────────────────────────────
	Display Name     iobroker
	App Id           6db1bd86-4xxx-xxxx-xxxx-xxxxxxxxxxxx
	App Name         iobroker-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
	Description      App for iobroker
	Single Instance  true
	Classifications  CONNECTED_SERVICE
	App Type         API_ONLY
	────────────────────────────────────────────────────────────────


	OAuth Info (you will not be able to see the OAuth info again so please save it now!):
	───────────────────────────────────────────────────────────
	OAuth Client Id      xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
	OAuth Client Secret  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
	───────────────────────────────────────────────────────────

Secure OAuth Client Id and OAuth Client Secret. 
Copy the newly generated values and store them in a safe place. This is your only way to retrieve the newly generated values.

If necessary, they can be changed using SmartThings CLI.
	
### 3. Admin UI Smartthings adapter:
	
Enter OAuth Client Id and OAuth Client
	
Execute link "Get oAuth-Code" (opens in new browser tab/window)
	
Complete the SmartThings registration process
	
Select location and authorize
	
A JSON is displayed in the redirect.
	
There we need the code shown below.

	....
	  }, 
	  "origin": "89.xxx.xx.xx", 
	  "url": "https://httpbin.org/get?code=XxXxxXx"
	}
 
We need "XxXxxXx". Enter this in the adapter's Admin Ui under Basic Access Code
	
Save and, if necessary, start the adapter.
	
	
The adapter now updates the access token automatically after 23 hours.

The loaded refresh token is valid for 30 days.

If this has expired, you will need to re-authorize using the “Get oAuth Code” link in the adapter’s admin interface.


## Steer

smartthings.0.id.capabilities either set to true or set a predefined value

## Discussion and Questions:

https://forum.iobroker.net/topic/48091/test-adapter-samsung-smartthings-v-0-0-x

## Changelog
### 0.1.2 (2024-05-19)

- Update Dependencies

- 0.1.0 Added object excluding to reduce cpu usage

- 0.0.4 Reduced cpu load while writing states

- 0.0.3 (TA2k) initial release

## License

MIT License

Copyright (c) 2021-2030 TA2k <tombox2020@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
