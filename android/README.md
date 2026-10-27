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
- **Every device on your Wi-Fi** is checked on 8080, 3000 and 8123 when the connect screen opens (a few seconds). If that finds exactly one Journeys and you haven't typed anything, Homebase connects to it by itself after a short countdown you can cancel.
- **On your Wi-Fi**, services that announce themselves show up by themselves, like Home Assistant does. Home Assistant already announces itself. For Journeys and Life Quest, copy the two files in `homelab/avahi/` to the Pi once:
  ```
  sudo cp homelab/avahi/*.service /etc/avahi/services/
  ```
  Avahi (already on Raspberry Pi OS, it's what makes `alpha5.local` work) picks them up by itself. This only works on the same network as the Pi, not over Tailscale.

**One entry per app, wherever it's found.** The same Pi can show up twice: by its Wi-Fi IP (found on the network) and by its Tailscale name. Journeys and Life Quest report an install ID in `/api/health` (`instance`), so Homebase merges them into one entry, keeps the Tailscale address (it works at home and away) and lists the other as "also 192.168.x.x". Apps without an ID, like Home Assistant, are merged when the name and port match. Tiles you already added twice this way are shown once.

**After connecting**, the next screen lists what else runs on the same machine ("Also running on alpha5"), with Homebase-aware apps like Life Quest ticked. Continue adds them to the launcher, and their tiles stay live (Life Quest's level, badge and icon). **+ Add an app** on the launcher shows the same list.

**On the launcher**, every tile has a dot: green when the app answers, red with "Not responding" when it doesn't, grey while checking. Homebase checks when you open it, when you come back to it, and every 30 seconds while the launcher is showing.

## When Tailscale is off

Homebase notices straight away (it watches the phone's network, so turning Tailscale off or leaving Wi-Fi updates the launcher), and goes through it in order:

1. **"Tailscale is off · looking on your Wi-Fi…"** It tries the address where your server answered on Wi-Fi last time, any Wi-Fi address it was found at, and then every device on this Wi-Fi (the /24, on the server's port), matching the server's install ID so it never picks the wrong machine.
2. **"Tailscale is off · using home Wi-Fi (192.168.x.x)"** if it's there. Your apps keep working through that address, and tiles say "On home Wi-Fi". Apps on the same machine (like Life Quest on :3000) move with it.
3. **"Tailscale is off · offline"** if it isn't. Tiles say "Offline · Tailscale is off", and the menu on the server chip has **Open Tailscale**.

Turn Tailscale back on and Homebase switches back to the usual address by itself. (Each address keeps its own copy of what an app saves in the browser, like Journeys' offline queue; both sync with the same server.)

## Opening an app

- **Your last view, at once.** When you leave an app, Homebase keeps a picture of its screen (in its private storage, per server; removed when you forget the server). Next time it shows that straight away with "Updating your last view", and swaps in the live page as soon as the app has drawn.
- **The steps, not a spinner:** Tailscale → reaching alpha5 (with how long it took) → loading the app → getting your data (Journeys). You can see which hop is slow.
- **Your favourite app is ready before you tap it.** Homebase counts what you open; while you're on the launcher it loads the one you open most in the background.
- **When something's wrong, it says what** within a few seconds: "Tailscale is off" (with Open Tailscale), "alpha5 isn't answering", or "Life Quest isn't running" (the server answers but the app doesn't). It keeps checking every 5 seconds and opens the app by itself when it's back. It tries the server before blaming Tailscale, since a name like alpha5 may work on home Wi-Fi without it.

On the server side, Journeys answers from its saved copy of your Sheet straight away when that copy is older than 15 seconds, then refreshes it in the background (the app asks once more for the fresh one). Its page files carry an ETag, so the phone keeps them and only checks whether they changed.

## Claude can see and use Homebase (MCP)

While Homebase is open it reports to your Journeys server: the connection (Tailscale, home Wi-Fi), each app and its dot, what's on screen, found apps, settings, and what happened (apps opened with how long each step took, apps going down, problems, connection changes). The Journeys MCP endpoint (`/mcp`, the one Claude already uses) gets four tools:

- **homebase_state**: what the phone shows right now, and whether Homebase is open ("in use now") or when it was last seen.
- **homebase_events**: the recent timeline.
- **homebase_devices**: the phones that report (each has its own ID).
- **homebase_do**: ask the phone to act: refresh, check apps, open an app, go to the launcher, reload an app, read an open app's page (title, address, sync status), add or hide a found app, add or remove an app, choose what opens on start, turn the Tailscale check on or off. Answers come back within a second while Homebase is open; otherwise the command waits until it's next opened.

**Settings → Claude access** shows whether it's working: "Reporting · last sent 5 s ago", or why not (the server isn't Journeys or hasn't been rebuilt since October 27, the access token wasn't accepted, or the server can't be reached), with **Send now** to try straight away.

It can't change the access token, turn off the fingerprint lock or forget a server. Nothing private leaves the phone: no token, page contents or pictures. Reports go only to a Journeys server, with the same access token, and are kept in `DATA_DIR/homebase-devices.json` (the last 300 events per phone). The server side is `server/homebase-remote.js`, kept separate so it can move to its own service later.

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
