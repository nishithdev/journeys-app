# Journeys

A phone app (PWA) for tracking life journeys step by step: *applied → 10 days → interview → 10 days → background check…*

It runs as one Docker container on your home server. The container serves the app and saves everything to **your own Google Sheet** using a **service-account JSON key**. The key stays on the server and never reaches your phone.

```
journeys-app/
├── app/                  ← the phone app (HTML, JS, CSS, icons)
├── server/server.js      ← serves the app + talks to Google Sheets (no npm packages)
├── server/mcp.js         ← MCP endpoint for AI assistants (/mcp)
├── Dockerfile
├── docker-compose.yml
├── .env.example          ← copy to .env: Sheet ID, time zone, optional token, Home Assistant
├── homeassistant/        ← package (sensors + button handling) and a dashboard card
└── secrets/              ← put service-account.json here (git-ignored)
```

Setup takes about 15 minutes, done once.

---

## 1. Create a service account and its JSON key

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project, e.g. **journeys**. (Or pick an existing one.)
2. Go to **APIs & Services → Library**, search for **Google Sheets API**, and click **Enable**.
3. Go to **IAM & Admin → Service accounts → Create service account**. Name it e.g. `journeys` and click **Done**. It needs no roles.
4. Open the new service account, go to the **Keys** tab, and choose **Add key → Create new key → JSON**. A `.json` file downloads.
5. Note the service account's email. It looks like `journeys@your-project.iam.gserviceaccount.com`.

> Treat the JSON file like a password. Anyone who has it can edit every Sheet you share with that email. If it ever leaks, delete the key on the **Keys** tab and make a new one.

## 2. Create the Sheet and share it

1. Go to [sheets.new](https://sheets.new) and name it, e.g. **Journeys**.
2. Click **Share** and add the service account's email as **Editor**. Untick "Notify people".
3. Copy the Sheet ID from the address bar: `https://docs.google.com/spreadsheets/d/`**`THIS-LONG-PART`**`/edit`

You don't need to create any tabs. The server adds **Journeys** and **Steps** the first time it runs.

## 3. Run it on your home server

```bash
git clone https://github.com/nishithdev/journeys-app.git
cd journeys-app

mkdir -p secrets
# copy the downloaded key into secrets/service-account.json (e.g. with scp), then:
sudo chown 1000:1000 secrets/service-account.json   # the container runs as user 1000
chmod 600 secrets/service-account.json

cp .env.example .env
nano .env        # paste SPREADSHEET_ID and check TZ (both can also be set later in the app)

docker compose up -d --build
docker compose logs -f journeys
```

The log should show:

```
Journeys 2.3.0 listening on :8080
Using service account journeys@…iam.gserviceaccount.com — share your Sheet with it as Editor.
```

Open `http://<server-ip>:8080` in a browser to check it. The Sheet gets its two tabs as soon as the app first loads.

**Updating later:** run `git pull`, then `docker compose up -d --build`.

## 4. HTTPS over your VPN

The phone needs an **https://** address to install the app and use it offline. Over plain `http://192.168.x.x:8080` it loads, but won't install.

- **Tailscale (easiest):** on the server, run `tailscale serve --bg 8080`. The app is then at `https://<server-name>.<your-tailnet>.ts.net` with a real certificate, reachable only from your tailnet. Turn on **MagicDNS** and **HTTPS certificates** in the Tailscale admin console first.
- **WireGuard / OpenVPN + your own domain:** put Caddy or Nginx Proxy Manager in front of port 8080, and point a name like `journeys.yourdomain.com` at the server's private or VPN IP. Get the certificate with a **DNS challenge**, so nothing has to be opened to the internet.
- **Self-signed certificate:** avoid it. Every phone would need your CA installed, and Chrome may still refuse to install the app.

## 5. Install it on your phone

1. Connect to your VPN and open the HTTPS address in **Chrome** on Android.
2. Tap **⋮ → Add to Home screen** (or **Install app**).
3. Open **Journeys** from your home screen and tap **+** to start your first journey.

There's nothing to configure in the app: it detects the server it was opened from. On iPhone, use Safari: **Share → Add to Home Screen**.

### Optional: an extra password

The VPN already keeps strangers out. If you also want a password, set `APP_TOKEN=something-long` in `.env` and run `docker compose up -d`. Each phone then enters it once under **Settings → Access token**.

---

## 6. Home Assistant (optional)

Two things, set up independently:

- **Sensors and a dashboard card:** Home Assistant reads your journeys from the server.
- **Nudges:** once a day, the server checks for journeys sitting on one step longer than usual, and sends a notification with buttons through the Home Assistant app on your phone:

  > **Passport renewal: 12 days on Processing**
  > That usually takes about 9 days. Any update?
  > `Approved` · `Other step…` · `Still waiting`

  - **Approved** (the likely next step) adds it with today's date.
  - **Other step…** lets you type what happened.
  - **Still waiting** snoozes it for 3 days.

  "Usually" is learned from your own past journeys of the same type. Until there are at least two examples, a nudge comes after 7 days.

### 6a. Let the server send notifications

1. In Home Assistant, go to your **profile → Security → Long-lived access tokens → Create token**, and copy it.
2. Find your phone's notify service: **Developer tools → Actions**, then search `notify.mobile_app`. It looks like `notify.mobile_app_pixel_8`.
3. Add the token to `.env` on the Journeys server, then run `docker compose up -d`. It's a password, so it can only go in `.env`:
   ```
   HA_TOKEN=eyJ...
   ```
4. In the app, go to **Settings → Server settings → Home Assistant**. Enter the URL (e.g. `http://192.168.1.10:8123`; use the IP, since `.local` names often don't resolve in Docker) and the notify service (several phones: separate with commas). Then tap **Save**. You can also put these in `.env` as `HA_URL` and `HA_NOTIFY`.
5. Back in **Settings**, a Home Assistant section appears. Use **Send test notification** to try it, or **Check now** to run the daily check immediately.

### 6b. Add the package to Home Assistant

The package makes the sensors and forwards button taps back to the server.

1. Copy `homeassistant/journeys.yaml` to `/config/packages/journeys.yaml` (create the `packages` folder if needed).
2. In `configuration.yaml`, make sure you have:
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
3. In `journeys.yaml`, replace both `JOURNEYS_SERVER` with your server's local address, e.g. `http://192.168.1.20:8080`. Home Assistant is on your network, so plain http is fine here.
4. If you set `APP_TOKEN`, add `journeys_auth: "Bearer <your token>"` to `secrets.yaml` and uncomment the two `headers:` blocks.
5. Go to **Developer tools → YAML → Check configuration**, then restart Home Assistant.

You'll get:

| Entity | What it is |
|---|---|
| `sensor.journeys_active` | Journeys in progress. Attributes hold each journey: day, current step, days since the last step, usual days, next step, steps |
| `sensor.journeys_waiting` | How many are waiting longer than usual |
| `sensor.journeys_longest_wait` | Days on the longest-waiting journey, with its name and step as attributes |

### 6c. Dashboard card

**Edit dashboard → Add card → Manual**, then paste `homeassistant/dashboard-card.yaml`. Each journey shows with its day count, and waiting ones are highlighted.

### Ideas for automations

The sensors work in any automation, for example:
- Flash a light when `sensor.journeys_active` drops, meaning a journey finished.
- Add `{{ state_attr('sensor.journeys_longest_wait', 'journey') }}` to a morning announcement on a speaker.

---

## 7. AI assistants (MCP)

The server includes an [MCP](https://modelcontextprotocol.io) endpoint, so Claude and other MCP apps can work with your journeys. You can ask things like *"how long did my last job hunt take?"*, *"log an interview for Acme today"* or *"what's been waiting longest?"*.

**Address:** `https://<your-journeys-address>/mcp` (Streamable HTTP). The app shows it under **Settings → AI assistants**.

| Tool | What it does |
|---|---|
| `list_journeys` | Journeys with current step, day count, days since last step (filter by active/done, type, name) |
| `get_journey` | One journey's steps with dates, day numbers, gaps and notes, plus what usually comes next |
| `add_journey` | Start a journey with its first step |
| `add_step` | Log a step (date defaults to today; `final` completes the journey) |
| `update_step` / `update_journey` | Edit a step, or rename / finish / reopen a journey |
| `delete_step` / `delete_journey` | Remove things (marked destructive, so apps ask before running them) |
| `get_insights` | What's waiting longer than usual, longest gaps, typical day each step is reached |

Journeys can be referred to by name; a unique part of the name is enough.

> **Set `APP_TOKEN` first.** These tools can change and delete data, and an AI app may run them on your behalf. With a token set, apps must send `Authorization: Bearer <APP_TOKEN>`.

**The computer running the AI app must be on your VPN**, since that's the only way it can reach the server.

**Claude Code**
```bash
claude mcp add --transport http journeys https://<your-journeys-address>/mcp \
  --header "Authorization: Bearer <APP_TOKEN>"
```

**Claude Desktop**

Go to **Settings → Developer → Edit config** and add the following, then restart Claude Desktop. It uses the `mcp-remote` bridge, which needs Node.js installed.
```json
{
  "mcpServers": {
    "journeys": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-journeys-address>/mcp",
               "--header", "Authorization: Bearer ${JOURNEYS_TOKEN}"],
      "env": { "JOURNEYS_TOKEN": "<APP_TOKEN>" }
    }
  }
}
```
Leave out the two `--header` entries and `env` if you haven't set `APP_TOKEN`.

> Claude's **custom connectors** (Settings → Connectors → Add custom connector, on claude.ai or in the desktop app) connect from Anthropic's servers, not your computer. They can't reach a server that's only on your VPN, so use the config above instead.

**Other MCP apps** (Cursor, VS Code, and others): add a remote / Streamable HTTP server with the address above and the `Authorization` header.

If a web page needs to call `/mcp` from another origin, list it in `MCP_ALLOWED_ORIGINS` (comma-separated). Requests from other websites' pages are refused by default. Apps that don't run in a browser aren't affected.

## Changing settings later

Open the app, go to **Settings → Server settings**. From there you can change:

| Setting | `.env` name |
|---|---|
| Google Sheet (paste the ID or the whole link) | `SPREADSHEET_ID` |
| Time zone | `TZ` |
| Home Assistant URL | `HA_URL` |
| Notify service(s) | `HA_NOTIFY` |
| Daily check hour | `NUDGE_HOUR` |
| Nudge after (days) | `NUDGE_AFTER_DAYS` |
| Ask again after (days) | `NUDGE_REPEAT_DAYS` |

- **Changes apply right away** for every device, with no restart.
- **When you switch Sheets,** the server first checks that the service account can open the new Sheet, and keeps the old one if it can't.
- **Saved values take precedence over `.env`.** They're stored in the container's `journeys-data` volume, so they survive restarts and rebuilds. Each field shows whether it comes from `.env` or was set in the app, and has **Use .env value** to switch back.
- **Secrets stay in `.env` only:** the JSON key, `HA_TOKEN` and `APP_TOKEN`. The screen shows whether each one is set, never its value.
- **Lock it down:** anyone who can open the app can change these settings. That includes the Home Assistant URL, which is where your HA token gets sent. On your VPN that's only you, but setting `APP_TOKEN` locks it.

## How it works

- **The Sheet is the source of truth.** Each step is one row in **Steps**. The server keeps rows sorted by journey and date, and fills in **Days from start** and **Days since previous**, so the Sheet reads well on its own.
- **Editing in the Sheet is fine.** The server re-reads the Sheet before every change, so edits made directly in the Sheet are kept. If you add rows by hand, give each one a unique ID in the first column (e.g. `S123`), and use an existing Journey ID for steps.
- **Works offline.** Changes are saved on the phone first and sent when it can reach the server again, e.g. once you're back on the VPN. The pill at the top shows *Synced*, *2 to sync* or *Offline*.
- **Several phones.** Open the same address on each one. The server saves changes one at a time, so they don't overwrite each other.
- **Just trying it out?** Opening `app/index.html` from any plain web server (e.g. `cd app && python3 -m http.server`) runs the app on sample data that stays in the browser.

## Troubleshooting

The app's banner, Settings screen and `docker compose logs journeys` show the same messages.

| Message | What to do |
|---|---|
| *The service account can't open this Sheet* | Share the Sheet with the service account's email as **Editor** (step 2). |
| *The Google Sheets API is turned off…* | Enable **Google Sheets API** in the key's Cloud project (step 1.2). |
| *Sheet not found* | Check `SPREADSHEET_ID` in `.env`, then run `docker compose up -d`. |
| *Can't read the JSON key at /run/secrets/service-account.json* | The file must be at `secrets/service-account.json` and readable by user 1000 (`sudo chown 1000:1000 …`). |
| *Google rejected the JSON key* | The key was deleted or disabled. Make a new one (step 1.4) and replace the file. |
| *Can't reach your Journeys server* | You're off the VPN, or the container is down (`docker compose ps`). |
| *This server needs an access token* | Enter `APP_TOKEN` under **Settings → Access token**. |
| No "Install app" option on the phone | The address must be **https://** (step 4). |
| *Can't reach Home Assistant at …* | Check `HA_URL`. Use the IP address and port 8123, reachable from the server. |
| *Home Assistant rejected HA_TOKEN* | Create a new long-lived token and update `.env`. |
| *Home Assistant has no notify service …* | Check `HA_NOTIFY` matches **Developer tools → Actions** (without `notify.`). |
| Nudge buttons do nothing | The package isn't loaded, or `JOURNEYS_SERVER` is wrong. Check **Settings → System → Logs** for `rest_command`. |
| Sensors show *unavailable* | Open `http://<server>:8080/api/ha` from the HA machine. It should show JSON. |
