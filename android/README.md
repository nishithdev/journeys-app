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

## Finding services and seeing what's running

**On the connect screen**, Homebase lists what it finds, so you can tap instead of typing:
- **Type a host name** (like `alpha5` or `100.64.0.5`) and it checks that machine's usual ports: 8080 (Journeys), 3000 (Life Quest), 8123 (Home Assistant), 80, 443, 3001, 5000, 8000, 8081, 8096, 2283, 8384, 8443, 8888, 9000, 9090, 19999 and 32400. Works over Tailscale too.
- **Servers you've already saved** are checked the same way.
- **On your Wi-Fi**, services that announce themselves show up by themselves, like Home Assistant does. Home Assistant already announces itself. For Journeys and Life Quest, copy the two files in `homelab/avahi/` to the Pi once:
  ```
  sudo cp homelab/avahi/*.service /etc/avahi/services/
  ```
  Avahi (already on Raspberry Pi OS, it's what makes `alpha5.local` work) picks them up by itself. This only works on the same network as the Pi, not over Tailscale.

**One entry per app, wherever it's found.** The same Pi can show up twice: by its Wi-Fi IP (found on the network) and by its Tailscale name. Journeys and Life Quest report an install ID in `/api/health` (`instance`), so Homebase merges them into one entry, keeps the Tailscale address (it works at home and away) and lists the other as "also 192.168.x.x". Apps without an ID, like Home Assistant, are merged when the name and port match. Tiles you already added twice this way are shown once.

**After connecting**, the next screen lists what else runs on the same machine ("Also running on alpha5"), with Homebase-aware apps like Life Quest ticked. Continue adds them to the launcher, and their tiles stay live (Life Quest's level, badge and icon). **+ Add an app** on the launcher shows the same list.

**On the launcher**, every tile has a dot: green when the app answers, red with "Not responding" when it doesn't, grey while checking. Homebase checks when you open it, when you come back to it, and every 30 seconds while the launcher is showing.

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
