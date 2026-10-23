# Homebase for Android

A launcher for your homelab. Homebase has no apps of its own: you give it your server's address, it asks the server which apps it hosts, and it opens them inside the Android app. It works like the Home Assistant companion app.

v1 relies on the **Tailscale app** for the connection. Turn Tailscale on, and Homebase reaches anything on your tailnet.

## Install

1. Get the APK: download `homebase.apk` from the chat, or build it yourself (see below).
2. Copy it to the phone and open it. Allow "Install unknown apps" for your file manager when Android asks.
3. Open Homebase, enter the server address (e.g. `http://alpha5.your-tailnet.ts.net:8080`), then the `APP_TOKEN` if the server asks for one.

You can also set it up from a link: `homebase://connect?url=http://alpha5:8080`. Tokens are never put in links.

## What the server tells it

Homebase calls `GET /api/homebase` (behind `APP_TOKEN`). The Journeys server answers with:

- **Journeys**, with today's summary ("1 waiting · 1 habit left") and a badge
- **Home Assistant**, when `HA_URL` is set
- anything in `HOMEBASE_APPS`

Optional `.env` settings:

```
# Extra tiles in the launcher: Name=url, comma separated
HOMEBASE_APPS=Jellyfin=http://alpha5:8096,Grafana=http://alpha5:3000
# Name shown at the top of the launcher (defaults to the host name)
SERVER_NAME=alpha5
```

An extra app that answers `/api/homebase` itself (Life Quest does) gets a live tile: Journeys asks it at most once a minute and shows its own subtitle, badge, colour and icon. So `HOMEBASE_APPS=Life Quest=http://alpha5:3000` gives you Life Quest's level, ready steps and pixel trophy right in the launcher.

You can also add any such app as a server of its own in Homebase (`http://alpha5:3000`). A server without `/api/homebase` still works: an older Journeys shows just Journeys, and any other web app shows up as a single tile.

## Make your own app show up

Answer `GET /api/homebase` with JSON:

```
{ "apps": [ { "id": "my-app", "name": "My App", "path": "/", "color": "#14151f",
              "icon": "star", "iconUrl": "/icon.png", "subtitle": "3 things today", "badge": 3 } ] }
```

`path` (or a full `url`) and `iconUrl` can be relative to the server. `iconUrl` is drawn without smoothing, so pixel art stays crisp. Return `{"authRequired": true}` from `GET /api/health` if the app needs the access token.

## Security

- The access token is encrypted with an Android Keystore key (AES-GCM). It is handed to Journeys at page start, only on the server's own origin, and never logged.
- Optional fingerprint / screen-lock unlock, which locks again after 5 minutes away.
- Plain http is allowed because tailnet traffic is already encrypted by WireGuard.
- Links to other sites open in your browser, not inside Homebase.

## Build

Needs JDK 17+ and the Android SDK (platform 35).

```
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleDebug         # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest     # Robolectric tests, no emulator needed
```

`assembleRelease` builds a minified APK. It is signed with the debug key for now; add your own signing config before you publish it anywhere.

NetTest runs against a live server only when you set `HOMEBASE_TEST_SERVER`, `HOMEBASE_TEST_TOKEN` and `HOMEBASE_TEST_OPEN_SERVER`; otherwise those tests are skipped.

## Not in v1

QR setup, push notifications, live updates, and a built-in Tailscale connection (tsnet).
