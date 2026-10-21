/*
 * Journeys server: serves the app and saves to Google Sheets with a service-account JSON key.
 * No npm dependencies — Node 20+ only.
 *
 * Environment:
 *   SPREADSHEET_ID                  the long ID from your Sheet's URL (required)
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the JSON key (default /run/secrets/service-account.json)
 *   APP_TOKEN                       optional extra password the app must send
 *   PORT                            default 8080
 *   TZ                              your time zone, used for "today" (e.g. America/Chicago)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const SPREADSHEET_ID = (process.env.SPREADSHEET_ID || '').trim();
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/run/secrets/service-account.json';
const APP_TOKEN = process.env.APP_TOKEN || '';
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'app'));
const SHEETS_BASE = (process.env.SHEETS_API_BASE || 'https://sheets.googleapis.com/v4/spreadsheets').replace(/\/$/, '');
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const VERSION = '2.0.0';

const JOURNEY_HEADERS = ['Journey ID', 'Journey', 'Type', 'Status', 'Created'];
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
  if (!SPREADSHEET_ID) throw configError('SPREADSHEET_ID is not set. Put your Sheet ID in the .env file and restart the container.');
  const t = await accessToken();
  let res;
  try {
    res = await fetch(`${SHEETS_BASE}/${encodeURIComponent(SPREADSHEET_ID)}${urlPath}`, {
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
  if (res.status === 404) throw configError('Sheet not found. Check SPREADSHEET_ID in the .env file.');
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
  await sheets('POST', ':batchUpdate', {
    requests: [
      fmt(ids.Journeys, 4, 5, { type: 'DATE', pattern: 'yyyy-mm-dd' }),
      fmt(ids.Steps, 4, 5, { type: 'DATE', pattern: 'yyyy-mm-dd' }),
      fmt(ids.Steps, 5, 7, { type: 'NUMBER', pattern: '0' }),
      bold(ids.Journeys, JOURNEY_HEADERS.length),
      bold(ids.Steps, STEP_HEADERS.length)
    ]
  });
  await sheets('POST', '/values:batchUpdate', {
    valueInputOption: 'RAW',
    data: [{ range: 'Journeys!A1:E1', values: [JOURNEY_HEADERS] }, { range: 'Steps!A1:H1', values: [STEP_HEADERS] }]
  });
  console.log(`Sheet ready (tabs created: ${missing.join(', ') || 'none'})`);
}

async function readAll() {
  const q = `?ranges=${encodeURIComponent('Journeys!A2:E')}&ranges=${encodeURIComponent('Steps!A2:H')}` +
    '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS';
  const r = await sheets('GET', `/values:batchGet${q}`);
  const [jr, sr] = (r.valueRanges || []).map((v) => v.values || []);
  const hasId = (row) => row && row[0] != null && String(row[0]).trim() !== '';
  return {
    rows: { j: (jr || []).length, s: (sr || []).length },
    journeys: (jr || []).filter(hasId).map((row) => ({
      id: String(row[0]).trim(), name: str(row[1]), type: str(row[2]), status: str(row[3]) || 'Active', created: toIso(row[4])
    })),
    steps: (sr || []).filter(hasId).map((row) => ({
      id: String(row[0]).trim(), journeyId: str(row[1]).trim(), step: str(row[3]), date: toIso(row[4]), notes: str(row[7])
    }))
  };
}

// Rewrites both tabs: journeys as they are, steps sorted by journey then date with the day columns filled in.
async function writeAll(d) {
  const names = {};
  d.journeys.forEach((j) => { names[j.id] = j.name; });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const jRows = d.journeys.map((j) => [j.id, j.name, j.type || '', j.status || 'Active', validIso(j.created) ? toSerial(j.created) : '']);
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
  // Blank out rows left over from before (e.g. after a delete).
  while (jRows.length < d.rows.j) jRows.push(Array(JOURNEY_HEADERS.length).fill(''));
  while (sRows.length < d.rows.s) sRows.push(Array(STEP_HEADERS.length).fill(''));
  const data = [];
  if (jRows.length) data.push({ range: 'Journeys!A2', values: jRows });
  if (sRows.length) data.push({ range: 'Steps!A2', values: sRows });
  if (data.length) await sheets('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data });
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
      if (!findJ(id)) d.journeys.push({ id, name, type: clean(b.type, 40), status: 'Active', created: today() });
      if (b.firstStep) apply({ action: 'addStep', id: b.firstStepId, journeyId: id, step: b.firstStep, date: b.date, notes: b.notes }, d);
      return { id };
    }
    case 'updateJourney': {
      const j = findJ(b.id);
      if (!j) throw userError('Journey not found.');
      if (b.name != null) { const n = clean(b.name, 200); if (!n) throw userError('Journey needs a name.'); j.name = n; }
      if (b.type != null) j.type = clean(b.type, 40);
      if (b.status != null) j.status = b.status === 'Done' ? 'Done' : 'Active';
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
      if (b.final) j.status = 'Done';
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

// One change at a time, so two phones saving at once can't overwrite each other.
let queue = Promise.resolve();
function exclusive(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

const sheetUrl = () => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
const publicData = (d) => ({ journeys: d.journeys, steps: d.steps, sheetUrl: sheetUrl() });

async function handleApi(body) {
  if (!body || typeof body.action !== 'string') throw userError('Missing action.');
  await ensureSetup();
  if (body.action === 'read') return { result: null, data: publicData(await readAll()) };
  return exclusive(async () => {
    const d = await readAll(); // fresh read, so edits made directly in the Sheet are kept
    const result = apply(body, d);
    await writeAll(d);
    return { result, data: publicData(d) };
  });
}

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
    const cache = rel.startsWith('/icons/') ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  try {
    if (pathname === '/healthz') return send(res, 200, { 'Content-Type': 'text/plain' }, 'ok\n');
    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, app: 'journeys', version: VERSION, authRequired: !!APP_TOKEN, configured: !!SPREADSHEET_ID });
    }
    if (pathname === '/api') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST.', kind: 'user' });
      if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'This server needs an access token. Enter it in Settings.', kind: 'auth' });
      let body;
      try { body = JSON.parse(await readBody(req, 64 * 1024)); } catch (e) { throw e instanceof AppError ? e : userError('Request was not valid JSON.'); }
      const payload = await handleApi(body);
      return sendJson(res, 200, { ok: true, payload });
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
  if (!SPREADSHEET_ID) console.warn('SPREADSHEET_ID is not set — the app will show a setup error until it is.');
  try { console.log(`Using service account ${serviceAccount().email} — share your Sheet with it as Editor.`); } catch (e) { console.warn(e.message); }
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
