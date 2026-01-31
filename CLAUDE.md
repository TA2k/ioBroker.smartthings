# SmartThings Adapter - Login Implementation

## APK zu main.js Mapping

Die Login-Implementierung in `main.js` basiert auf der Samsung SmartThings APK. Hier die relevanten Dateien:

### OAuth Endpoints

| Funktion | APK Datei | main.js |
|----------|-----------|---------|
| Token Refresh | `samsung/smali_classes11/com/smartthings/smartclient/restclient/internal/auth/OauthService.smali` | `refreshToken()` Zeile 440 |
| DNS/URL Config | `samsung/smali_classes11/com/smartthings/smartclient/restclient/configuration/DnsConfigs.smali` | Hardcoded URLs |

### Production URLs (DnsConfigs.smali Zeile 320-350)

```
Auth URL:   https://auth.api.smartthings.com/
API URL:    https://api.smartthings.com/
Client URL: https://client.smartthings.com/
```

### Samsung Account OAuth (verwendet in main.js)

| Endpoint | URL |
|----------|-----|
| Authenticate | `https://eu-auth2.samsungosp.com/auth/oauth2/authenticate` |
| Authorize | `https://eu-auth2.samsungosp.com/auth/oauth2/v2/authorize` |
| Token | `https://eu-auth2.samsungosp.com/auth/oauth2/token` |

Relevante APK Dateien:
- `samsung/smali_classes5/com/osp/app/signin/sasdk/server/UrlManager$OspVer20$Auth2.smali` - Base URL `auth2.samsungosp.com`
- `samsung/smali_classes7/com/samsung/android/oneconnect/domainlayer/account/k.smali` - Account Token Handling

### Token Handling

| Aspekt | APK Datei |
|--------|-----------|
| Token Storage | `samsung/smali_classes11/com/smartthings/smartclient/restclient/internal/auth/SharedPreferencesTokenHandler.smali` |
| Token Refresh | `samsung/smali_classes7/com/samsung/android/oneconnect/domainlayer/account/TokenRefresher$refreshAccessToken$4.smali` |
| Token Cache | `samsung/smali_classes7/com/samsung/android/oneconnect/domainlayer/account/core/TokenCache$initTokenCache$3.smali` |
| Token Entity | `samsung/smali_classes7/com/samsung/android/oneconnect/domainlayer/account/entity/Token.smali` |

### OauthService.smali - Refresh Token API

```smali
# Zeile 99-136
.method public abstract refreshToken(...)
    .annotation runtime Lretrofit2/http/Field;
        value = "refresh_token"
    .end annotation
    ...
    .annotation runtime Lretrofit2/http/POST;
        value = "oauth/token"
    .end annotation
```

Parameter:
- `refresh_token` - Der aktuelle Refresh Token
- `client_id` - App Client ID (`8931gfak30`)
- `grant_type` - Immer `refresh_token`

### Wichtige Erkenntnisse

1. **Token Rotation**: Samsung verwendet Refresh Token Rotation. Bei jedem erfolgreichen Refresh wird ein neuer `refresh_token` zuruckgegeben. Der alte Token wird sofort ungultig.

2. **Zwei Auth-Systeme**:
   - Samsung Account (`eu-auth2.samsungosp.com`) - Login & Token Exchange
   - SmartThings API (`auth.api.smartthings.com`) - Nicht kompatibel mit Samsung Account Tokens

3. **x-osp Headers**: Required fur Samsung Account API:
   ```
   x-osp-appid: 8931gfak30
   x-osp-clientversion: 3.6.2024042301
   x-osp-packagename: com.samsung.oneconnect4ios
   x-osp-packageversion: 1.7.22
   x-osp-clientmodel: iPhone
   x-osp-clientosversion: 15.8.3
   ```

### Login Flow (main.js)

1. **User gibt codeUrl ein** (aus Samsung Account Callback)
2. **Decrypt code** mit AES-128-CBC
3. **POST /auth/oauth2/authenticate** - Bekommt `userauth_token`
4. **GET /auth/oauth2/v2/authorize** - Bekommt `code`
5. **POST /auth/oauth2/token** - Bekommt `access_token` + `refresh_token`
6. **Speichern in ioBroker State** `authInformation.session`

### Test Scripts

- `login-test.js` - Vollstandiger Login-Flow Test
- `refresh-only-test.js` - Refresh Token Rotation Test

### Bekannte Probleme

1. Bei `invalid_grant` Fehler (AUT_1803) ist der Refresh Token ungultig
2. Token wird nach einmaliger Nutzung ungultig (Rotation)
3. Session muss nach erfolgreichem Refresh sofort gespeichert werden
