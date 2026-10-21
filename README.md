# Journeys

A phone app (PWA) for tracking life journeys step by step: *applied → 10 days → interview → 10 days → background check…*

It runs as one Docker container on your home server. The container serves the app and saves everything to **your own Google Sheet** using a **service-account JSON key**. The key stays on the server and never reaches your phone.

```
journeys-app/
├── app/                  ← the phone app (HTML, JS, CSS, icons)
├── server/server.js      ← serves the app + talks to Google Sheets (no npm packages)
├── Dockerfile
├── docker-compose.yml
├── .env.example          ← copy to .env: Sheet ID, time zone, optional token
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
nano .env        # paste SPREADSHEET_ID; check TZ

docker compose up -d --build
docker compose logs -f journeys
```

The log should show:

```
Journeys 2.0.0 listening on :8080
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
