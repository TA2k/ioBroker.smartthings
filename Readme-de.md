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

## Loginablauf:

Um diesen Apdater zu nutzen muss man zunächst bei SmartThings.com eine App einrichten.

### 1. Voraussetzungen um Apps bei SmartThings.com einzurichten:

	Das geht am einfachsten, wenn man auf dem lokalen Rechner die SmartThings CLI installiert.
	
	Die findet man hier: https://github.com/SmartThingsCommunity/smartthings-cli/releases
	
	Anleitung dazu hier: https://developer.smartthings.com/docs/sdks/cli/introduction
	
	Je nach Betriebssystem entsprechend installieren.
	
### 2. App anlegen:
	
	In der Konsole smartthing apps:create ausführen
	
	Anmeldeprozess im Browser durchlaufen (ich hab das mit Windows gemacht, kann also bei anderen Betriebssystemen abweichen)
	
	OAuth-In App auswählen (derzeit einzige Option)
	
	Display Name eingeben -> z.B iobroker
	
	Description eingeben -> z.B. App für iobroker
	
	Icon Image URL (optional) -> Link zu einem Icon
	
	Target URL (optional) -> Enter klicken (derzeit nicht getestet)
	
	Select Scopes -> Devices r, w, x auswählen (Rest derzeit nicht getestet)
	
	Add Redirect URI -> hier muss ein Link eingegeben werden, der eine Redirect Uri anzeigen kann.
	Getestet sind:
    https://httpbin.org/get
	https://echo.free.beeceptor.com/sample-request
						
	Man kann auch eigene Server nutzen. Erreichbarkeit über https im Internet muss gegeben sein. Lokale Adressen funktionieren nicht (das ist nur für die Authentisierung wichtig).
	Es können auch mehrere URL´s hinterlegt werden.
		
	Finish editing Redirect URIs -> klicken
	
	Finish and create OAuth-In SmartApp -> klicken
	
	Dann wird eine Bestätigung angezeigt:
	
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

	OAuth Client Id und OAuth Client Secret sichern. 
	Kopieren Sie das neu generierten Werte und bewahren Sie es an einem sicheren Ort auf. Dies ist Ihre einzige Möglichkeit, den neu generierten Werte abzurufen.
	Notfalls lassen sie sich aber per SmartThings CLI ändern.
	
### 3. Admin UI Smartthings-Adapter:
	
	OAuth Client Id und OAuth Client eingeben
	
	Link "Get oAuth-Code" ausführen (öffnet sich in neuen Browser Tab/Fenster)
	
	SmartThings Anmeldeprozess durchführen
	
	Location auswählen und Authorisieren
	
	In der Weiterleitung wird ein JSON angezeigt.
	
	Dort benötigen wir den unten angezeigten code. Diesen in der Admin Ui des Adapters unter Basic Access Code eintragen
	
	Sichern und ggf. Adapter starten.
	
	
Der Adapter aktualisiert den Access-Token nun nach 23 Stunden selbstständig.

Der geladene Refresh-Token ist 30 Tage gültig.

Sollte dieser abgelaufen sein,ist eine Neu-Authorisieren über den Link "Get oAuth-Code" in der Admin Ui des Adapters nötig.

## Steuern

smartthings.0.id.capabilities entweder true setzen oder ein vorgegebenen Wert setzen

## Diskussion und Fragen:

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
