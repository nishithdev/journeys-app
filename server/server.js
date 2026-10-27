/*
 * Journeys server: serves the app, saves to Google Sheets with a service-account JSON key,
 * and (optionally) feeds Home Assistant: sensors plus daily "any update?" nudges with buttons.
 * No npm dependencies — Node 20+ only.
 *
 * Environment — secrets (only ever set here):
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the JSON key (default /run/secrets/service-account.json)
 *   APP_TOKEN                       optional extra password the app (and Home Assistant) must send
 *   HA_TOKEN                        Home Assistant long-lived access token
 *
 * Environment — settings (defaults; can also be changed in the app under Settings → Server settings,
 * which saves them to DATA_DIR/settings.json and takes precedence):
 *   SPREADSHEET_ID                  the long ID from your Sheet's URL
 *   TZ                              your time zone, used for "today" and the nudge hour
 *   HA_URL, HA_NOTIFY               Home Assistant address and notify service(s)
 *   NUDGE_HOUR                      hour of day for the daily check (default 9)
 *   NUDGE_AFTER_DAYS                days on one step before a nudge, when there's no history (default 7)
 *   NUDGE_REPEAT_DAYS               days before nudging about the same step again (default 3)
 *   GOALS_ENABLED                   turn on the Goals & habits add-on (default off; also a switch in Settings)
 *   HOMEBASE_APPS                   more apps for the Homebase Android app's launcher: "Immich=http://alpha5:2283,Grafana=http://alpha5:3000"
 *   SERVER_NAME                     the name Homebase shows for this server (default: from its address)
 *   CHECKIN_HOUR, GOAL_STALL_DAYS   Goals & habits: evening check-in hour (21), days before a goal counts as stalled (14)
 *
 * Other: PORT (default 8080), DATA_DIR (default /data),
 *        MCP_ALLOWED_ORIGINS (browser origins allowed to call /mcp; same-origin is always allowed)
 *
 * MCP: AI assistants can connect to <server>/mcp (Streamable HTTP). See server/mcp.js.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function intEnv(name, def, min, max) {
  const v = parseInt(process.env[name], 10);
  return isNaN(v) ? def : Math.min(max, Math.max(min, v));
}

const PORT = Number(process.env.PORT) || 8080;
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/run/secrets/service-account.json';
const APP_TOKEN = process.env.APP_TOKEN || '';
const HA_TOKEN = (process.env.HA_TOKEN || '').trim();
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'app'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SHEETS_BASE = (process.env.SHEETS_API_BASE || 'https://sheets.googleapis.com/v4/spreadsheets').replace(/\/$/, '');
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const VERSION = '2.6.0';
const MCP_ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
const NUDGE_CHECK_MS = intEnv('NUDGE_CHECK_MS', 10 * 60 * 1000, 200, 24 * 3600 * 1000);

const JOURNEY_HEADERS = ['Journey ID', 'Journey', 'Type', 'Status', 'Created', 'Snoozed until', 'Last nudged', 'Outcome'];
// How a finished journey ended. Stored in the Sheet by label; the app and API use the id.
const OUTCOMES = { got: 'Got it', rejected: 'Rejected', withdrew: 'Withdrew', other: 'Other' };
function outcomeId(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  for (const [id, label] of Object.entries(OUTCOMES)) if (s === id || s === label.toLowerCase()) return id;
  return 'other';
}
const STEP_HEADERS = ['Step ID', 'Journey ID', 'Journey', 'Step', 'Date', 'Days from start', 'Days since previous', 'Notes'];

// Error kinds tell the app what to do with a queued change:
//   user   → the change itself is invalid; drop it
//   config → setup problem (key, sharing, Sheet ID); keep it and show the message
//   retry  → temporary problem; keep it and try later
class AppError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
const userError = (m) => new AppError('user', m);
const configError = (m) => new AppError('config', m);
const retryError = (m) => new AppError('retry', m);

// ---------- dates ----------
const pad = (n) => (n < 10 ? '0' : '') + n;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const utc = (iso) => { const m = ISO.exec(iso); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
const validIso = (s) => typeof s === 'string' && ISO.test(s) && !isNaN(utc(s));
const days = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const addDays = (iso, n) => new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);
// Sheets stores dates as days since 1899-12-30.
const toSerial = (iso) => utc(iso) / 86400000 + 25569;
const fromSerial = (n) => new Date(Math.round((Math.floor(n) - 25569) * 86400000)).toISOString().slice(0, 10);
function toIso(v) {
  if (typeof v === 'number' && isFinite(v)) return fromSerial(v);
  const s = v == null ? '' : String(v).trim();
  if (validIso(s)) return s;
  if (!s) return '';
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const str = (v) => (v == null ? '' : String(v));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- settings: .env gives the defaults, the app can override them ----------
// Secrets (JSON key, HA_TOKEN, APP_TOKEN) are deliberately not here: they can only be set in .env.
function parseSheetId(v, fromWeb) {
  let s = str(v).trim();
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(s);
  if (m) s = m[1]; // a whole Sheet link was pasted
  if (!s) { if (fromWeb) throw userError('Enter your Sheet ID or link.'); return ''; }
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(s)) throw userError("That doesn't look like a Sheet ID. Paste the Sheet's link instead.");
  return s;
}
function parseTz(v) {
  const s = str(v).trim();
  if (!s) return '';
  try { new Intl.DateTimeFormat('en-US', { timeZone: s }); } catch (e) { throw userError(`Unknown time zone: ${s}`); }
  return s;
}
function parseUrl(v) {
  const s = str(v).trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { throw userError('Home Assistant URL must look like http://192.168.1.10:8123'); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw userError('Home Assistant URL must start with http:// or https://');
  return (u.origin + u.pathname).replace(/\/+$/, '');
}
function parseNotify(v) {
  const list = str(v).split(',').map((x) => x.trim().replace(/^notify\./, '')).filter(Boolean);
  for (const x of list) if (!/^[a-z0-9_]+$/.test(x)) throw userError(`"${x}" isn't a notify service name. It looks like mobile_app_pixel_8.`);
  return list.join(',');
}
const intIn = (label, min, max) => (v) => {
  const n = typeof v === 'number' ? v : parseInt(str(v).trim(), 10);
  if (!Number.isInteger(n) || n < min || n > max) throw userError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const SETTINGS = {
  spreadsheetId: { env: 'SPREADSHEET_ID', def: '', parse: parseSheetId },
  timeZone: { env: 'TZ', def: '', parse: parseTz },
  haUrl: { env: 'HA_URL', def: '', parse: parseUrl },
  haNotify: { env: 'HA_NOTIFY', def: '', parse: parseNotify },
  nudgeHour: { env: 'NUDGE_HOUR', def: 9, parse: intIn('Daily check hour', 0, 23) },
  nudgeAfterDays: { env: 'NUDGE_AFTER_DAYS', def: 7, parse: intIn('Nudge after', 1, 365) },
  nudgeRepeatDays: { env: 'NUDGE_REPEAT_DAYS', def: 3, parse: intIn('Ask again after', 1, 365) }
};
// Add-on: Goals & habits (server/goals.js). Off unless GOALS_ENABLED or the switch in Settings turns it on.
const goalsAddon = require('./goals');
Object.assign(SETTINGS, goalsAddon.settings({ intIn, userError }));
const envValues = {};
for (const [k, s] of Object.entries(SETTINGS)) {
  const raw = process.env[s.env];
  if (raw == null || raw === '') { envValues[k] = s.def; continue; }
  try { envValues[k] = s.parse(raw, false); } catch (e) { console.warn(`Ignoring ${s.env} in .env: ${e.message}`); envValues[k] = s.def; }
}
let overrides = {};
try {
  const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  for (const [k, v] of Object.entries(saved || {})) {
    if (!SETTINGS[k]) continue;
    try { overrides[k] = SETTINGS[k].parse(v, false); } catch (e) { console.warn(`Ignoring saved ${k}: ${e.message}`); }
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.warn(`Could not read ${SETTINGS_FILE}: ${e.message}`);
}
const conf = {};
function applyConf() {
  for (const k of Object.keys(SETTINGS)) conf[k] = k in overrides ? overrides[k] : envValues[k];
  // Node picks up a change to process.env.TZ immediately.
  if (conf.timeZone) process.env.TZ = conf.timeZone; else delete process.env.TZ;
}
applyConf();
const haNotifyList = () => (conf.haNotify ? conf.haNotify.split(',') : []);
const haEnabled = () => !!(conf.haUrl && HA_TOKEN && haNotifyList().length);

// A random ID for this install, so the Homebase app knows that alpha5:8080 and 192.168.1.20:8080 are the same
// Journeys (one tile, not two). Kept in DATA_DIR; if that isn't writable it lasts until the next restart.
const INSTANCE_ID = (function () {
  const file = path.join(DATA_DIR, 'instance-id');
  try { const v = fs.readFileSync(file, 'utf8').trim(); if (/^[a-f0-9-]{8,64}$/.test(v)) return v; } catch (e) { /* first start */ }
  const id = crypto.randomUUID();
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, id + '\n'); } catch (e) { /* read-only: per run */ }
  return id;
})();

function storageWritable() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.accessSync(DATA_DIR, fs.constants.W_OK); return true; } catch (e) { return false; }
}
function persistOverrides() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${SETTINGS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(overrides, null, 2) + '\n');
    fs.renameSync(tmp, SETTINGS_FILE);
    return true;
  } catch (e) {
    console.warn(`Settings changed but could not be saved to ${SETTINGS_FILE} (${e.code || e.message}); they'll reset on restart.`);
    return false;
  }
}

// ---------- Google sign-in with the service-account key ----------
let sa = null;
function serviceAccount() {
  if (sa) return sa;
  let raw;
  try { raw = fs.readFileSync(KEY_FILE, 'utf8'); } catch (e) {
    throw configError(`Can't read the JSON key at ${KEY_FILE} (${e.code || e.message}). Check the volume in docker-compose.yml and that the file is readable.`);
  }
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw configError('The JSON key file is not valid JSON.'); }
  if (!j.client_email || !j.private_key) throw configError('The key file has no client_email or private_key. Download a JSON key for a service account.');
  sa = { email: j.client_email, key: j.private_key, tokenUri: j.token_uri || 'https://oauth2.googleapis.com/token' };
  return sa;
}

let token = null;
async function accessToken() {
  if (token && token.exp > Date.now() + 60000) return token.value;
  const k = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: k.email, scope: SCOPE, aud: k.tokenUri, iat: now, exp: now + 3600 })}`;
  let sig;
  try { sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), k.key).toString('base64url'); } catch (e) {
    throw configError('The private_key in the JSON key file could not be used.');
  }
  let res;
  try {
    res = await fetch(k.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` })
    });
  } catch (e) { throw retryError(`Can't reach Google to sign in (${(e.cause && e.cause.code) || e.message}).`); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    if (res.status >= 500) throw retryError('Google sign-in is temporarily unavailable.');
    throw configError(`Google rejected the JSON key (${j.error_description || j.error || res.status}). It may have been deleted or disabled.`);
  }
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

// ---------- Sheets API ----------
async function sheets(method, urlPath, body) {
  if (!conf.spreadsheetId) throw configError('No Sheet is set. Add your Sheet ID under Settings → Server settings, or SPREADSHEET_ID in .env.');
  const t = await accessToken();
  let res;
  try {
    res = await fetch(`${SHEETS_BASE}/${encodeURIComponent(conf.spreadsheetId)}${urlPath}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw retryError(`Can't reach Google Sheets (${(e.cause && e.cause.code) || e.message}).`); }
  const j = await res.json().catch(() => ({}));
  if (res.ok) return j;
  const msg = (j.error && j.error.message) || `HTTP ${res.status}`;
  if (res.status === 401) { token = null; throw retryError('Google sign-in expired; trying again.'); }
  if (res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(JSON.stringify(j))) {
    throw configError("The Google Sheets API is turned off for the key's Google Cloud project. Enable it in the Cloud Console (APIs & Services → Library → Google Sheets API).");
  }
  if (res.status === 403) throw configError(`The service account can't open this Sheet. Share the Sheet with ${serviceAccount().email} as Editor.`);
  if (res.status === 404) throw configError('Sheet not found. Check the Sheet ID under Settings → Server settings.');
  if (res.status === 429 || res.status >= 500) throw retryError(`Google Sheets is busy (${msg}). It will retry.`);
  throw retryError(`Google Sheets error: ${msg}`);
}

let setupPromise = null;
function ensureSetup() {
  if (!setupPromise) setupPromise = doSetup().catch((e) => { setupPromise = null; throw e; });
  return setupPromise;
}
async function doSetup() {
  const meta = await sheets('GET', '?fields=sheets.properties(sheetId,title)');
  const ids = {};
  (meta.sheets || []).forEach((s) => { ids[s.properties.title] = s.properties.sheetId; });
  const missing = ['Journeys', 'Steps'].filter((t) => ids[t] === undefined);
  if (missing.length) {
    const r = await sheets('POST', ':batchUpdate', {
      requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }))
    });
    r.replies.forEach((rep, i) => { ids[missing[i]] = rep.addSheet.properties.sheetId; });
  }
  const fmt = (sheetId, col, endCol, numberFormat) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: endCol },
      cell: { userEnteredFormat: { numberFormat } },
      fields: 'userEnteredFormat.numberFormat'
    }
  });
  const bold = (sheetId, n) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: 'userEnteredFormat.textFormat.bold'
    }
  });
  const DATE = { type: 'DATE', pattern: 'yyyy-mm-dd' };
  await sheets('POST', ':batchUpdate', {
    requests: [
      fmt(ids.Journeys, 4, 7, DATE),
      fmt(ids.Steps, 4, 5, DATE),
      fmt(ids.Steps, 5, 7, { type: 'NUMBER', pattern: '0' }),
      bold(ids.Journeys, JOURNEY_HEADERS.length),
      bold(ids.Steps, STEP_HEADERS.length)
    ]
  });
  await sheets('POST', '/values:batchUpdate', {
    valueInputOption: 'RAW',
    data: [{ range: 'Journeys!A1:H1', values: [JOURNEY_HEADERS] }, { range: 'Steps!A1:H1', values: [STEP_HEADERS] }]
  });
  console.log(`Sheet ready (tabs created: ${missing.join(', ') || 'none'})`);
}

async function readAll() {
  const q = `?ranges=${encodeURIComponent('Journeys!A2:H')}&ranges=${encodeURIComponent('Steps!A2:H')}` +
    '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS';
  const r = await sheets('GET', `/values:batchGet${q}`);
  const [jr, sr] = (r.valueRanges || []).map((v) => v.values || []);
  const hasId = (row) => row && row[0] != null && String(row[0]).trim() !== '';
  const d = {
    rows: { j: (jr || []).length, s: (sr || []).length },
    journeys: (jr || []).filter(hasId).map((row) => ({
      id: String(row[0]).trim(), name: str(row[1]), type: str(row[2]), status: str(row[3]) || 'Active', created: toIso(row[4]),
      snoozedUntil: toIso(row[5]), lastNudged: toIso(row[6]), outcome: outcomeId(row[7])
    })),
    steps: (sr || []).filter(hasId).map((row) => ({
      id: String(row[0]).trim(), journeyId: str(row[1]).trim(), step: str(row[3]), date: toIso(row[4]), notes: str(row[7])
    }))
  };
  remember(d);
  return d;
}

// Rewrites both tabs: journeys as they are, steps sorted by journey then date with the day columns filled in.
async function writeAll(d) {
  const names = {};
  d.journeys.forEach((j) => { names[j.id] = j.name; });
  const dateCell = (s) => (validIso(s) ? toSerial(s) : '');
  const jRows = d.journeys.map((j) => [j.id, j.name, j.type || '', j.status || 'Active', dateCell(j.created), dateCell(j.snoozedUntil), dateCell(j.lastNudged), OUTCOMES[j.outcome] || '']);
  const sorted = d.steps.map((s, i) => ({ s, i }))
    .sort((a, b) => cmp(names[a.s.journeyId] || '', names[b.s.journeyId] || '') || cmp(a.s.journeyId, b.s.journeyId) || cmp(a.s.date, b.s.date) || a.i - b.i)
    .map((x) => x.s);
  let cur = null, start = null, prev = null;
  const sRows = sorted.map((s) => {
    if (s.journeyId !== cur) { cur = s.journeyId; start = s.date; prev = null; }
    const ok = validIso(s.date);
    const fromStart = ok && validIso(start) ? days(start, s.date) : '';
    const sincePrev = ok && validIso(prev) ? days(prev, s.date) : '';
    prev = s.date;
    return [s.id, s.journeyId, names[s.journeyId] || '', s.step, ok ? toSerial(s.date) : '', fromStart, sincePrev, s.notes || ''];
  });
  const jCount = jRows.length, sCount = sRows.length;
  // Blank out rows left over from before (e.g. after a delete).
  while (jRows.length < d.rows.j) jRows.push(Array(JOURNEY_HEADERS.length).fill(''));
  while (sRows.length < d.rows.s) sRows.push(Array(STEP_HEADERS.length).fill(''));
  const data = [];
  if (jRows.length) data.push({ range: 'Journeys!A2', values: jRows });
  if (sRows.length) data.push({ range: 'Steps!A2', values: sRows });
  if (data.length) await sheets('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data });
  d.rows = { j: jCount, s: sCount };
  remember(d);
}

// A short-lived copy for Home Assistant's polling, so a sensor refresh doesn't always hit Google.
let cache = null;
function remember(d) { cache = { at: Date.now(), d }; }
async function readCached(maxAgeMs) {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.d;
  return readAll();
}

// Opening the app shouldn't wait on Google: a read answers from the saved copy at once (marked stale) and
// refreshes it in the background; the app then asks once more with fresh: true and gets the new copy.
const FRESH_MS = 15 * 1000;          // younger than this counts as fresh
const SERVE_STALE_MS = 6 * 3600e3;   // older than this is read again before answering
let refreshing = null;
function refreshSoon() {
  if (!refreshing) {
    refreshing = readAll().catch((e) => { console.warn(`[sheet] background refresh failed: ${e.message}`); })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}
async function readForApp(fresh) {
  const age = cache ? Date.now() - cache.at : Infinity;
  if (fresh) {
    if (refreshing) await refreshing;
    if (!cache || Date.now() - cache.at > 2000) await readAll(); // the background one failed, or there was none
    return { data: cache.d, stale: false };
  }
  if (age < FRESH_MS) return { data: cache.d, stale: false };
  if (age < SERVE_STALE_MS) { refreshSoon(); return { data: cache.d, stale: true }; }
  return { data: await readAll(), stale: false };
}

// ---------- changes ----------
const newId = (p) => p + crypto.randomBytes(5).toString('hex');
const clean = (v, max) => str(v).trim().slice(0, max);

function apply(b, d) {
  const findJ = (id) => d.journeys.find((j) => j.id === id);
  const findS = (id) => d.steps.find((s) => s.id === id);
  switch (b.action) {
    case 'addJourney': {
      const name = clean(b.name, 200);
      if (!name) throw userError('Journey needs a name.');
      const id = clean(b.id, 40) || newId('J');
      if (!findJ(id)) d.journeys.push({ id, name, type: clean(b.type, 40), status: 'Active', created: today(), snoozedUntil: '', lastNudged: '', outcome: '' });
      if (b.firstStep) apply({ action: 'addStep', id: b.firstStepId, journeyId: id, step: b.firstStep, date: b.date, notes: b.notes }, d);
      return { id };
    }
    case 'updateJourney': {
      const j = findJ(b.id);
      if (!j) throw userError('Journey not found.');
      if (b.name != null) { const n = clean(b.name, 200); if (!n) throw userError('Journey needs a name.'); j.name = n; }
      if (b.type != null) j.type = clean(b.type, 40);
      if (b.status != null) {
        j.status = b.status === 'Done' ? 'Done' : 'Active';
        if (j.status === 'Active') j.outcome = ''; // reopened: no outcome yet
      }
      if (b.outcome != null) j.outcome = parseOutcome(b.outcome);
      return { id: j.id };
    }
    case 'deleteJourney':
      d.journeys = d.journeys.filter((j) => j.id !== b.id);
      d.steps = d.steps.filter((s) => s.journeyId !== b.id);
      return { id: b.id };
    case 'addStep': {
      const j = findJ(b.journeyId);
      if (!j) throw userError('Journey not found.');
      const step = clean(b.step, 200);
      if (!step) throw userError('Step needs a name.');
      if (!validIso(b.date)) throw userError('Date must look like 2026-01-31.');
      const id = clean(b.id, 40) || newId('S');
      if (findS(id)) return { id }; // already saved (a retry from the offline queue)
      d.steps.push({ id, journeyId: j.id, step, date: b.date, notes: clean(b.notes, 5000) });
      if (b.final) { j.status = 'Done'; if (b.outcome != null) j.outcome = parseOutcome(b.outcome); }
      j.snoozedUntil = ''; // something happened, so any snooze is over
      return { id };
    }
    case 'updateStep': {
      const s = findS(b.id);
      if (!s) throw userError('Step not found.');
      if (b.step != null) { const n = clean(b.step, 200); if (!n) throw userError('Step needs a name.'); s.step = n; }
      if (b.date != null) { if (!validIso(b.date)) throw userError('Date must look like 2026-01-31.'); s.date = b.date; }
      if (b.notes != null) s.notes = clean(b.notes, 5000);
      return { id: s.id };
    }
    case 'deleteStep':
      d.steps = d.steps.filter((s) => s.id !== b.id);
      return { id: b.id };
    default:
      throw userError(`Unknown action: ${b.action}`);
  }
}

function parseOutcome(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  const id = outcomeId(s);
  if (!(s in OUTCOMES) && !Object.values(OUTCOMES).some((l) => l.toLowerCase() === s)) throw userError('Outcome must be got, rejected, withdrew or other.');
  return id;
}

// One change at a time, so two phones (or a phone and Home Assistant) can't overwrite each other.
let queue = Promise.resolve();
function exclusive(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

const sheetUrl = () => `https://docs.google.com/spreadsheets/d/${conf.spreadsheetId}/edit`;
const publicData = (d) => ({ journeys: d.journeys, steps: d.steps, sheetUrl: sheetUrl() });

async function handleApi(body) {
  if (!body || typeof body.action !== 'string') throw userError('Missing action.');
  await ensureSetup();
  if (body.action === 'read') {
    const r = await readForApp(!!body.fresh);
    return r.stale ? { result: null, data: publicData(r.data), stale: true } : { result: null, data: publicData(r.data) };
  }
  return exclusive(async () => {
    const d = await readAll(); // fresh read, so edits made directly in the Sheet are kept
    const result = apply(body, d);
    await writeAll(d);
    return { result, data: publicData(d) };
  });
}

// ---------- Home Assistant: sensors ----------
const norm = (s) => String(s || '').trim().toLowerCase();
// Used for the nudge button until your own history says what usually comes next.
const DEFAULT_NEXT = {
  job: { applied: 'Interview', interview: 'Offer letter', 'background check': 'Offer letter', 'offer letter': 'Joined' },
  home: { applied: 'Approved', approved: 'Lease signed', 'lease signed': 'Moved in' },
  documents: { submitted: 'Processing', processing: 'Approved', approved: 'Received' },
  travel: { booked: 'Visa applied', 'visa applied': 'Visa approved', 'visa approved': 'Departed', departed: 'Returned' },
  health: { appointment: 'Tests', tests: 'Results', results: 'Treatment', treatment: 'Recovered' },
  purchase: { researched: 'Ordered', ordered: 'Shipped', shipped: 'Delivered' }
};

function stepsOf(d, jid) {
  return d.steps.map((s, i) => ({ s, i }))
    .filter((x) => x.s.journeyId === jid && validIso(x.s.date))
    .sort((a, b) => cmp(a.s.date, b.s.date) || a.i - b.i)
    .map((x) => x.s);
}
// For each journey type + step: how many days until the next step, and what the next step was.
function history(d) {
  const h = {};
  for (const j of d.journeys) {
    const st = stepsOf(d, j.id);
    for (let i = 0; i < st.length - 1; i++) {
      const k = `${norm(j.type)}|${norm(st[i].step)}`;
      const e = h[k] || (h[k] = { gaps: [], next: {} });
      e.gaps.push(days(st[i].date, st[i + 1].date));
      e.next[st[i + 1].step] = (e.next[st[i + 1].step] || 0) + 1;
    }
  }
  return h;
}
function median(a) {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function journeyStatus(d, j, h, t) {
  const st = stepsOf(d, j.id);
  if (!st.length) return null;
  const first = st[0], last = st[st.length - 1];
  const e = h[`${norm(j.type)}|${norm(last.step)}`];
  const usual = e && e.gaps.length >= 2 ? Math.round(median(e.gaps)) : null;
  const threshold = usual != null ? Math.max(3, Math.ceil(usual * 1.25)) : conf.nudgeAfterDays;
  const since = Math.max(0, days(last.date, t));
  let next = e ? Object.entries(e.next).sort((a, b) => b[1] - a[1])[0][0] : null;
  if (!next) next = (DEFAULT_NEXT[norm(j.type)] || {})[norm(last.step)] || null;
  const snoozed = validIso(j.snoozedUntil) && j.snoozedUntil > t ? j.snoozedUntil : null;
  return {
    id: j.id, name: j.name, type: j.type,
    day: Math.max(0, days(first.date, t)),
    current_step: last.step, current_step_date: last.date,
    days_since_last_step: since, usual_days: usual, nudge_after_days: threshold,
    // "waiting" = needs your attention: longer than usual and not snoozed with "Still waiting".
    waiting: since >= threshold && !snoozed, next_step: next,
    snoozed_until: snoozed,
    steps: st.map((s) => ({ step: s.step, date: s.date, day: days(first.date, s.date) }))
  };
}
function haSummary(d) {
  const t = today(), h = history(d);
  const active = d.journeys.filter((j) => j.status !== 'Done')
    .map((j) => journeyStatus(d, j, h, t)).filter(Boolean)
    .sort((a, b) => b.days_since_last_step - a.days_since_last_step);
  return {
    active: active.length,
    waiting: active.filter((a) => a.waiting).length,
    done: d.journeys.filter((j) => j.status === 'Done').length,
    updated: new Date().toISOString(),
    journeys: active
  };
}

// ---------- Home Assistant: nudges ----------
async function haNotify(payload) {
  if (!haEnabled()) {
    throw configError(HA_TOKEN
      ? 'Home Assistant is not set up. Add its URL and notify service under Settings → Server settings.'
      : 'Home Assistant is not set up. HA_TOKEN must be set in .env (it is a secret, so it can only go there).');
  }
  for (const svc of haNotifyList()) {
    let res;
    try {
      res = await fetch(`${conf.haUrl}/api/services/notify/${encodeURIComponent(svc)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) { throw retryError(`Can't reach Home Assistant at ${conf.haUrl} (${(e.cause && e.cause.code) || e.message}).`); }
    if (res.status === 401 || res.status === 403) throw configError('Home Assistant rejected HA_TOKEN. Create a new long-lived access token.');
    if (res.status === 400 || res.status === 404) throw configError(`Home Assistant has no notify service "notify.${svc}". Check the notify service under Server settings.`);
    if (!res.ok) throw retryError(`Home Assistant answered HTTP ${res.status}.`);
  }
}

function nudgeFor(s) {
  const actions = [];
  if (s.next_step) actions.push({ action: `JOURNEY_STEP:${s.id}:${encodeURIComponent(s.next_step)}`, title: s.next_step });
  actions.push({ action: `JOURNEY_OTHER:${s.id}`, title: 'Other step…', behavior: 'textInput', textInputButtonTitle: 'Add', textInputPlaceholder: 'What happened?' });
  actions.push({ action: `JOURNEY_WAIT:${s.id}`, title: 'Still waiting' });
  return {
    title: `${s.name}: ${plural(s.days_since_last_step, 'day')} on ${s.current_step}`,
    message: s.usual_days != null
      ? `That usually takes about ${plural(s.usual_days, 'day')}. Any update?`
      : 'No update in a while. Any update?',
    data: { tag: `journey-${s.id}`, group: 'journeys', actions }
  };
}

function dueNudges(d) {
  const t = today(), h = history(d);
  return d.journeys.filter((j) => j.status !== 'Done')
    .map((j) => ({ j, s: journeyStatus(d, j, h, t) }))
    .filter(({ j, s }) => s && s.waiting &&
      !(validIso(j.snoozedUntil) && j.snoozedUntil > t) &&
      // Already asked about this step recently?
      !(validIso(j.lastNudged) && j.lastNudged >= s.current_step_date && days(j.lastNudged, t) < conf.nudgeRepeatDays));
}

async function runNudges() {
  return exclusive(async () => {
    await ensureSetup();
    const d = await readAll();
    const t = today(), sent = [];
    try {
      for (const { j, s } of dueNudges(d)) {
        await haNotify(nudgeFor(s));
        j.lastNudged = t;
        sent.push(s.name);
      }
    } finally {
      if (sent.length) await writeAll(d);
    }
    return { sent };
  });
}

// Handles a tap on a nudge's button, forwarded by the Home Assistant automation.
async function haAction(body) {
  const m = /^JOURNEY_(STEP|OTHER|WAIT):([^:]+)(?::(.*))?$/.exec(String((body && body.action) || ''));
  if (!m) throw userError('Unknown action.');
  const [, kind, jid, rest] = m;
  return exclusive(async () => {
    await ensureSetup();
    const d = await readAll();
    const j = d.journeys.find((x) => x.id === jid);
    if (!j) throw userError('Journey not found.');
    const t = today();
    let confirm, result;
    if (kind === 'WAIT') {
      j.snoozedUntil = addDays(t, conf.nudgeRepeatDays);
      result = { snoozedUntil: j.snoozedUntil };
    } else {
      let name = '';
      try { name = kind === 'STEP' ? decodeURIComponent(rest || '') : str(body.reply); } catch (e) { name = str(rest); }
      name = name.trim();
      if (!name) throw userError('No step name was given.');
      result = apply({ action: 'addStep', journeyId: jid, step: name, date: t }, d);
      const prev = stepsOf(d, jid).filter((s) => s.id !== result.id).pop();
      confirm = { title: `${j.name}: ${name}`, message: prev ? `Added, ${plural(days(prev.date, t), 'day')} after ${prev.step}.` : 'Added.', data: { tag: `journey-${jid}`, group: 'journeys' } };
    }
    await writeAll(d);
    if (confirm) haNotify(confirm).catch((e) => console.warn('[ha] confirmation not sent:', e.message));
    return result;
  });
}

let lastRunDay = null;
function startNudgeSchedule() {
  // Always ticking, so turning Home Assistant on in Server settings takes effect without a restart.
  if (haEnabled()) console.log(`Home Assistant nudges on: daily check from ${pad(conf.nudgeHour)}:00, notify ${haNotifyList().map((s) => 'notify.' + s).join(', ')}`);
  const tick = async () => {
    if (!haEnabled()) return;
    const t = today();
    if (new Date().getHours() < conf.nudgeHour || lastRunDay === t) return;
    lastRunDay = t;
    try {
      const r = await runNudges();
      console.log(`Nudges: ${r.sent.length ? 'sent for ' + r.sent.join(', ') : 'nothing waiting'}`);
    } catch (e) {
      lastRunDay = null; // try again on the next tick
      console.error(`[nudges] ${e.message}`);
    }
  };
  setInterval(tick, NUDGE_CHECK_MS).unref();
  setTimeout(tick, Math.min(5000, NUDGE_CHECK_MS)).unref();
}

// ---------- Homebase (the Android app): which apps this server offers ----------
const HOMEBASE_APPS = parseHomebaseApps(process.env.HOMEBASE_APPS || '');
function parseHomebaseApps(raw) {
  return raw.split(',').map((x) => x.trim()).filter(Boolean).map((x, i) => {
    const eq = x.indexOf('=');
    const name = eq > 0 ? x.slice(0, eq).trim() : '';
    const url = eq > 0 ? x.slice(eq + 1).trim() : x;
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch (e) { console.warn(`Ignoring HOMEBASE_APPS entry "${x}": not an http(s) address`); return null; }
    return { id: `extra-${i}`, name: name || new URL(url).hostname, url, color: '#5B6274', icon: '', subtitle: new URL(url).host, named: !!name };
  }).filter(Boolean);
}

// An extra app that lists itself at /api/homebase (Life Quest does) gets its live tile:
// its own subtitle, badge, colour and icon. Asked at most once a minute, with a short timeout,
// so a slow or stopped app never holds up the launcher.
const liveTiles = new Map(); // url -> { at, tile }
async function liveTile(extra) {
  const { named, ...plain } = extra;
  const hit = liveTiles.get(extra.url);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.tile || plain;
  let tile = null;
  try {
    const base = extra.url.endsWith('/') ? extra.url : extra.url + '/';
    const r = await fetch(new URL('api/homebase', base), { signal: AbortSignal.timeout(1500), headers: { Accept: 'application/json' } });
    const a = r.ok && ((await r.json()).apps || [])[0];
    if (a && typeof a === 'object') {
      const abs = (u) => { try { const x = new URL(String(u), base); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };
      tile = Object.assign({}, plain, {
        name: named ? plain.name : String(a.name || plain.name).slice(0, 40),
        url: a.url ? abs(a.url) || plain.url : a.path ? abs(String(a.path).replace(/^\//, '')) || plain.url : plain.url,
        color: /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : plain.color,
        icon: typeof a.icon === 'string' ? a.icon.slice(0, 30) : '',
        iconUrl: a.iconUrl ? abs(a.iconUrl) : '',
        subtitle: typeof a.subtitle === 'string' ? a.subtitle.slice(0, 120) : plain.subtitle,
        badge: Math.max(0, Math.min(999, Number(a.badge) || 0))
      });
    }
  } catch (e) { /* not reachable or not a Homebase app: a plain tile */ }
  liveTiles.set(extra.url, { at: Date.now(), tile });
  return tile || plain;
}
async function homebaseApps() {
  let subtitle = '', badge = 0;
  try {
    await ensureSetup();
    const s = haSummary(await readCached(60 * 1000));
    let habitsLeft = 0;
    try { const g = await goals.todaySummary(); if (g) habitsLeft = g.habits_due; } catch (e) { /* goals unavailable: skip its part */ }
    const parts = [s.waiting ? `${s.waiting} waiting` : plural(s.active, 'journey') + ' in progress'];
    if (habitsLeft) parts.push(`${plural(habitsLeft, 'habit')} left`);
    subtitle = parts.join(' · ');
    badge = s.waiting + habitsLeft;
  } catch (e) { /* Sheet not reachable right now: still list the apps */ }
  const apps = [{ id: 'journeys', name: 'Journeys', path: '/', color: '#2451D6', icon: 'journeys', subtitle, badge, token: true }];
  if (conf.haUrl) apps.push({ id: 'home-assistant', name: 'Home Assistant', url: conf.haUrl, color: '#18BCF2', icon: 'home', subtitle: new URL(conf.haUrl).host });
  apps.push(...await Promise.all(HOMEBASE_APPS.map(liveTile)));
  const out = { apps };
  if (process.env.SERVER_NAME) out.server = { name: process.env.SERVER_NAME.trim() };
  return out;
}

// ---------- settings API ----------
function settingsView(saved) {
  let serviceAccountEmail = null, keyProblem = null;
  try { serviceAccountEmail = serviceAccount().email; } catch (e) { keyProblem = e.message; }
  return {
    values: Object.assign({}, conf),
    env: Object.assign({}, envValues),
    overridden: Object.keys(overrides),
    secrets: { serviceAccountEmail, keyProblem, haToken: !!HA_TOKEN, appToken: !!APP_TOKEN },
    storage: { writable: storageWritable(), saved: saved !== false },
    ha: { enabled: haEnabled() }
  };
}

// body.values: { key: newValue } to set, { key: null } to go back to the .env value.
async function saveSettings(body) {
  const changes = body && body.values;
  if (!changes || typeof changes !== 'object') throw userError('Nothing to save.');
  const next = Object.assign({}, overrides);
  for (const [k, v] of Object.entries(changes)) {
    const def = SETTINGS[k];
    if (!def) throw userError(`Unknown setting: ${k}`);
    if (v === null) { delete next[k]; continue; }
    const parsed = def.parse(v, true);
    if (parsed === envValues[k]) delete next[k]; else next[k] = parsed;
  }
  const newSheet = 'spreadsheetId' in next ? next.spreadsheetId : envValues.spreadsheetId;
  return exclusive(async () => {
    const before = overrides;
    overrides = next;
    applyConf();
    if (newSheet !== (before.spreadsheetId !== undefined ? before.spreadsheetId : envValues.spreadsheetId)) {
      // A different Sheet: make sure the key can open it before keeping the change.
      setupPromise = null; cache = null;
      try { await ensureSetup(); await readAll(); } catch (e) {
        overrides = before; applyConf(); setupPromise = null; cache = null;
        throw e;
      }
      lastRunDay = null;
      console.log('Now using a different Sheet (changed in the app).');
    }
    const saved = persistOverrides();
    console.log(`Settings changed in the app: ${Object.keys(changes).join(', ')}`);
    return settingsView(saved);
  });
}

// ---------- add-on: Goals & habits ----------
const goals = goalsAddon.init({
  conf, sheets, exclusive, today, validIso, toSerial, toIso, str, userError, AppError, haNotify, haEnabled, plural, days, addDays, sheetUrl,
  NUDGE_CHECK_MS, STATIC_DIR
});

// ---------- Homebase remote: the Android app's live state, and asking it to do things ----------
const remote = require('./homebase-remote')({ DATA_DIR, userError });

// ---------- MCP (AI assistants) ----------
const mcp = require('./mcp')({
  VERSION, ensureSetup, readAll, writeAll, apply, exclusive, stepsOf, history, journeyStatus,
  days, today, validIso, addDays, userError, AppError, sheetUrl,
  extraTools: (helpers) => (goals.enabled() ? goals.mcpTools(helpers) : []).concat(remote.mcpTools(helpers))
});

// ---------- HTTP ----------
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json'
};

function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, headers));
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(obj));
}

function authorized(req) {
  if (!APP_TOKEN) return true;
  const h = String(req.headers.authorization || '');
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(APP_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(userError('Request too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req, 64 * 1024);
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { throw userError('Request was not valid JSON.'); }
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return send(res, 400, {}, 'Bad request'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(STATIC_DIR, '.' + path.posix.normalize(rel));
  if (!file.startsWith(STATIC_DIR + path.sep)) return send(res, 404, {}, 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // App routes (no file extension) get the app; missing files get a 404.
      if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
      return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
    }
    const ext = path.extname(file);
    const cacheCtl = rel.startsWith('/icons/') ? 'public, max-age=604800' : 'no-cache';
    // With an ETag the phone keeps its copy and only checks "still the same?" (a tiny 304), even on plain http
    // where the offline service worker can't run. Changed files get a new ETag, so updates still arrive.
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, Object.assign({}, SECURITY_HEADERS, { ETag: etag, 'Cache-Control': cacheCtl }));
      return res.end();
    }
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cacheCtl, ETag: etag }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  try {
    if (pathname === '/healthz') return send(res, 200, { 'Content-Type': 'text/plain' }, 'ok\n');
    if (pathname === '/mcp') return await mcp.handleHttp(req, res, { authorized, readBody, allowedOrigins: MCP_ALLOWED_ORIGINS });
    // MCP clients (e.g. mcp-remote) look here for OAuth sign-in. We use a fixed token instead, so say "none"
    // with a real 404, not the app's page (which they'd fail to parse as JSON).
    if (pathname.startsWith('/.well-known/')) return sendJson(res, 404, { error: 'not_found', error_description: 'This server uses a bearer token (APP_TOKEN), not OAuth.' });
    // After a rejected token, mcp-remote tries to register for OAuth here. Answer with the real reason.
    if (pathname === '/register' || pathname === '/authorize' || pathname === '/token') {
      return sendJson(res, 400, { error: 'invalid_client_metadata', error_description: 'Wrong or missing access token. Send the header "Authorization: Bearer <APP_TOKEN>" with the APP_TOKEN from the server\'s .env.' });
    }
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true, app: 'journeys', version: VERSION, instance: INSTANCE_ID, authRequired: !!APP_TOKEN, configured: !!conf.spreadsheetId,
        ha: { enabled: haEnabled(), nudgeHour: conf.nudgeHour },
        mcp: { path: '/mcp', tools: mcp.allTools().length },
        addons: [goals.addon()]
      });
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'This server needs an access token. Enter it in Settings.', kind: 'auth' });
      const route = `${req.method} ${pathname}`;
      if (route === 'POST /api') return sendJson(res, 200, { ok: true, payload: await handleApi(await readJson(req)) });
      // Home Assistant's REST sensor polls this. Plain JSON, no wrapper, so templates stay simple.
      if (route === 'GET /api/ha') { await ensureSetup(); return sendJson(res, 200, haSummary(await readCached(60 * 1000))); }
      if (route === 'POST /api/ha/action') return sendJson(res, 200, { ok: true, payload: await haAction(await readJson(req)) });
      if (route === 'POST /api/ha/check') return sendJson(res, 200, { ok: true, payload: await runNudges() });
      if (route === 'GET /api/settings') return sendJson(res, 200, { ok: true, payload: settingsView() });
      // The Homebase Android app's launcher: apps on this server, with Journeys' badge. Plain JSON, no wrapper.
      if (route === 'GET /api/homebase') return sendJson(res, 200, await homebaseApps());
      if (pathname.startsWith('/api/homebase/')) {
        const handled = await remote.handle(route, req, res, { readJson, sendJson, url: new URL(req.url, 'http://x') });
        if (handled !== false) return handled;
      }
      if (route === 'POST /api/settings') return sendJson(res, 200, { ok: true, payload: await saveSettings(await readJson(req)) });
      if (pathname === '/api/goals' || pathname.startsWith('/api/goals/')) return await goals.handle(route, req, res, { readJson, sendJson });
      if (route === 'POST /api/ha/test') {
        await haNotify({ title: 'Journeys', message: 'Test from your Journeys server. Nudges will arrive like this.', data: { tag: 'journeys-test', group: 'journeys' } });
        return sendJson(res, 200, { ok: true, payload: { sent: true } });
      }
      return sendJson(res, 404, { ok: false, error: 'Not found.', kind: 'user' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {}, 'Method not allowed');
    return serveStatic(req, res, pathname);
  } catch (err) {
    const kind = err instanceof AppError ? err.kind : 'retry';
    if (!(err instanceof AppError) || kind !== 'user') console.error(`[${kind}]`, err.message);
    const status = { user: 400, config: 500, retry: 503 }[kind];
    return sendJson(res, status, { ok: false, error: err instanceof AppError ? err.message : 'Server error. Check the container logs.', kind });
  }
});

server.listen(PORT, () => {
  console.log(`Journeys ${VERSION} listening on :${PORT}`);
  if (!conf.spreadsheetId) console.warn('No Sheet ID yet: set SPREADSHEET_ID in .env or open the app → Settings → Server settings.');
  if (Object.keys(overrides).length) console.log(`Using settings saved from the app: ${Object.keys(overrides).join(', ')} (${SETTINGS_FILE})`);
  try { console.log(`Using service account ${serviceAccount().email} — share your Sheet with it as Editor.`); } catch (e) { console.warn(e.message); }
  if (!haEnabled() && (conf.haUrl || HA_TOKEN || conf.haNotify)) console.warn('Home Assistant nudges are off: they need HA_TOKEN in .env plus the HA URL and notify service.');
  console.log(`MCP endpoint for AI assistants: /mcp (${mcp.allTools().length} tools)`);
  startNudgeSchedule();
  goals.start();
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
