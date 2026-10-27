/*
 * Homebase remote: the Homebase Android app reports its live state here (connection, app status, what's open,
 * how long things took, errors, settings), and AI assistants read it and ask the phone to do things, through
 * the MCP tools at the end of this file.
 *
 *   POST /api/homebase/report         the phone's state and its new events (every change, and every 30 s while open)
 *   GET  /api/homebase/commands       the phone waits here (up to 25 s) for things to do
 *   POST /api/homebase/commands/ack   …and says how each one went
 *
 * All behind APP_TOKEN like the rest of /api. Kept in DATA_DIR/homebase-devices.json so history survives a restart.
 * Self-contained on purpose: it can move to a separate hub service later without touching Journeys.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_EVENTS = 300;           // per phone
const MAX_COMMANDS = 50;          // per phone, newest kept
const ONLINE_MS = 75 * 1000;      // seen this recently = "in use now" (it reports every 30 s while open)
const LONG_POLL_MS = 25 * 1000;
const ACTIONS = {
  refresh: 'Check the connection to the server again',
  check_apps: 'Check which apps are running (the dots)',
  look_for_new_apps: 'Look for new apps on the server\'s machine and the Wi-Fi',
  open_app: 'Open an app (needs app)',
  show_launcher: 'Go back to the launcher',
  reload_app: 'Reload an app\'s page (needs app)',
  page_info: 'Read what an open app\'s page shows: title, address, sync status (needs app)',
  add_found_app: 'Add a found app to the launcher (needs app: its name or address)',
  hide_found_app: 'Stop offering a found app (needs app)',
  add_app: 'Add an app by address (needs url, optional name)',
  remove_app: 'Remove an app you added by hand (needs app)',
  set_open_on_launch: 'What Homebase opens when it starts: an app id/name, or "launcher" (needs value)',
  set_tailscale_warning: 'Turn the Tailscale check on or off (needs value: on/off)'
};

module.exports = function createRemote({ DATA_DIR, userError }) {
  const FILE = path.join(DATA_DIR, 'homebase-devices.json');
  let devices = {};
  try { devices = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { devices = {}; }
  for (const d of Object.values(devices)) for (const c of d.commands || []) if (c.status === 'sent' || c.status === 'queued') c.status = 'expired';

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(devices)); fs.renameSync(FILE + '.tmp', FILE); }
      catch (e) { /* read-only data folder: keep it in memory */ }
    }, 1500);
    if (saveTimer.unref) saveTimer.unref();
  }

  const waiting = new Map();   // device id -> [wake()] for long-polls
  const acks = new Map();      // command id -> [resolve(command)]
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);

  // ---------- from the phone ----------
  function report(b) {
    const id = str(b && b.device && b.device.id, 64).trim();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw userError('Missing device id.');
    const d = devices[id] || (devices[id] = { events: [], commands: [], lastSeq: 0 });
    d.info = {
      id, name: str(b.device.name, 80), model: str(b.device.model, 80), android: str(b.device.android, 20), app_version: str(b.device.app_version, 20)
    };
    if (b.state && typeof b.state === 'object') d.state = trimState(b.state);
    d.seenAt = Date.now();
    d.foreground = b.foreground !== false;
    let added = 0;
    for (const e of Array.isArray(b.events) ? b.events.slice(-100) : []) {
      const seq = Number(e && e.seq);
      if (!Number.isFinite(seq) || seq <= d.lastSeq) continue; // already have it (a report sent twice)
      d.events.push({ seq, at: str(e.at, 40), type: str(e.type, 30), text: str(e.text, 300), data: e.data && typeof e.data === 'object' ? JSON.parse(JSON.stringify(e.data).slice(0, 2000) || '{}') : undefined });
      d.lastSeq = seq; added++;
    }
    if (d.events.length > MAX_EVENTS) d.events.splice(0, d.events.length - MAX_EVENTS);
    save();
    return { ok: true, last_seq: d.lastSeq, added, pending: (d.commands || []).filter((c) => c.status === 'queued').length };
  }

  // Keep what we show and nothing else (no tokens or pictures ever come here).
  function trimState(s) {
    const apps = (Array.isArray(s.apps) ? s.apps : []).slice(0, 40).map((a) => ({
      id: str(a.id, 80), name: str(a.name, 80), url: str(a.url, 200), effective_url: str(a.effective_url, 200),
      status: str(a.status, 20), subtitle: str(a.subtitle, 160), badge: Number(a.badge) || 0, manual: !!a.manual
    }));
    return {
      at: str(s.at, 40), screen: str(s.screen, 120), open_app: str(s.open_app, 80),
      server: s.server ? { name: str(s.server.name, 80), url: str(s.server.url, 200) } : null,
      link: str(s.link, 30), link_note: str(s.link_note, 200), link_ms: Number(s.link_ms) || 0,
      tailscale_on: !!s.tailscale_on, wifi_ip: str(s.wifi_ip, 60),
      routes: s.routes && typeof s.routes === 'object' ? Object.fromEntries(Object.entries(s.routes).slice(0, 20).map(([k, v]) => [str(k, 200), str(v, 200)])) : {},
      apps,
      new_apps: (Array.isArray(s.new_apps) ? s.new_apps : []).slice(0, 30).map((f) => ({ name: str(f.name, 80), url: str(f.url, 200), kind: str(f.kind, 30), also: Array.isArray(f.also) ? f.also.slice(0, 5).map((x) => str(x, 200)) : [] })),
      servers: (Array.isArray(s.servers) ? s.servers : []).slice(0, 10).map((x) => ({ name: str(x.name, 80), url: str(x.url, 200) })),
      settings: s.settings && typeof s.settings === 'object' ? {
        open_on_launch: str(s.settings.open_on_launch, 80), lock_enabled: !!s.settings.lock_enabled, tailscale_warning: !!s.settings.tailscale_warning
      } : {}
    };
  }

  /** The phone asks for work; waits up to [waitMs] when there's none, so commands arrive within a second. */
  async function takeCommands(id, waitMs) {
    const d = devices[id];
    if (!d) return [];
    const ready = () => d.commands.filter((c) => c.status === 'queued');
    if (!ready().length && waitMs > 0) {
      await new Promise((resolve) => {
        const t = setTimeout(done, waitMs);
        function done() { clearTimeout(t); const list = (waiting.get(id) || []).filter((f) => f !== done); waiting.set(id, list); resolve(); }
        waiting.set(id, (waiting.get(id) || []).concat(done));
      });
    }
    d.seenAt = Date.now(); d.foreground = true;
    const list = ready();
    for (const c of list) { c.status = 'sent'; c.sentAt = Date.now(); }
    if (list.length) save();
    return list.map((c) => ({ id: c.id, action: c.action, args: c.args }));
  }

  function ack(b) {
    const d = devices[str(b && b.device, 64)];
    if (!d) throw userError('Unknown device.');
    const c = d.commands.find((x) => x.id === str(b.id, 40));
    if (!c) throw userError('Unknown command.');
    c.status = b.ok === false ? 'failed' : 'done';
    c.result = str(b.result, 4000);
    c.doneAt = Date.now();
    save();
    for (const resolve of acks.get(c.id) || []) resolve(c);
    acks.delete(c.id);
    return { ok: true };
  }

  // ---------- for assistants ----------
  async function command(d, action, args, waitMs) {
    const c = { id: crypto.randomBytes(6).toString('hex'), action, args, status: 'queued', at: Date.now() };
    d.commands.push(c);
    if (d.commands.length > MAX_COMMANDS) d.commands.splice(0, d.commands.length - MAX_COMMANDS);
    save();
    for (const wake of waiting.get(d.info.id) || []) wake();
    if (waitMs > 0) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, waitMs);
        acks.set(c.id, (acks.get(c.id) || []).concat(() => { clearTimeout(t); resolve(); }));
      });
    }
    return c;
  }

  const list = () => Object.values(devices).filter((d) => d.info).sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0));
  function pick(ref) {
    const all = list();
    if (!all.length) throw userError('No Homebase phone has reported yet. Open Homebase on the phone (version 1.0.8 or later) while it can reach this server.');
    if (!ref) return all[0]; // the one seen most recently
    const r = String(ref).trim().toLowerCase();
    const hit = all.find((d) => d.info.id.toLowerCase() === r) || all.find((d) => d.info.name.toLowerCase() === r) ||
      all.filter((d) => `${d.info.name} ${d.info.model}`.toLowerCase().includes(r))[0];
    if (!hit) throw userError(`No phone matches "${ref}". Phones: ${all.map((d) => d.info.name || d.info.model).join(', ')}.`);
    return hit;
  }
  const ago = (t) => {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
  };
  const online = (d) => d.foreground && Date.now() - (d.seenAt || 0) < ONLINE_MS;
  const presence = (d) => (online(d) ? 'in use now' : `last seen ${ago(d.seenAt)}${d.foreground ? '' : ' (Homebase in the background)'}`);
  const LINK = {
    Connected: 'connected', Checking: 'checking', CheckingWifi: 'Tailscale is off, looking on the Wi-Fi', HomeWifi: 'Tailscale is off, using home Wi-Fi',
    TailscaleOff: 'Tailscale is off, offline', Unreachable: "can't reach the server", NeedsToken: 'needs the access token', Unknown: 'not checked yet'
  };
  const STATUS = { Up: 'running', Down: 'not responding', Checking: 'checking' };

  function describe(d) {
    const s = d.state || {};
    const lines = [`${d.info.name || d.info.model} (${d.info.model}, Android ${d.info.android}, Homebase ${d.info.app_version}) · ${presence(d)}`];
    if (s.server) lines.push(`Server: ${s.server.name} (${s.server.url}) · ${LINK[s.link] || s.link}${s.link === 'Connected' && s.link_ms ? ` in ${s.link_ms} ms` : ''}${s.link_note && s.link !== 'Connected' ? ` · ${s.link_note}` : ''}`);
    lines.push(`Tailscale: ${s.tailscale_on ? 'on' : 'off'}${s.wifi_ip ? ` · phone's Wi-Fi address ${s.wifi_ip}` : ''}`);
    if (s.routes && Object.keys(s.routes).length) lines.push(`Using home Wi-Fi addresses: ${Object.entries(s.routes).map(([a, b]) => `${a} → ${b}`).join(', ')}`);
    lines.push(`On screen: ${s.screen || 'unknown'}`);
    if (s.apps && s.apps.length) {
      lines.push('Apps:');
      for (const a of s.apps) lines.push(`- ${a.name} (${a.id}) · ${STATUS[a.status] || a.status}${a.badge ? ` · badge ${a.badge}` : ''}${a.subtitle ? ` · ${a.subtitle}` : ''} · ${a.effective_url || a.url}${a.manual ? ' · added by hand' : ''}`);
    }
    if (s.new_apps && s.new_apps.length) lines.push(`New apps found (not on the launcher): ${s.new_apps.map((f) => `${f.name} at ${f.url}`).join('; ')}`);
    if (s.settings) lines.push(`Settings: opens ${s.settings.open_on_launch === 'list' || !s.settings.open_on_launch ? 'the launcher' : s.settings.open_on_launch} on start · fingerprint lock ${s.settings.lock_enabled ? 'on' : 'off'} · Tailscale check ${s.settings.tailscale_warning ? 'on' : 'off'}`);
    if (s.servers && s.servers.length > 1) lines.push(`Other saved servers: ${s.servers.filter((x) => !s.server || x.url !== s.server.url).map((x) => x.name).join(', ')}`);
    lines.push(`State from ${s.at || 'unknown'}.`);
    return lines.join('\n');
  }

  function mcpTools() {
    const s = (description, extra) => Object.assign({ type: 'string', description }, extra || {});
    const RO = { readOnlyHint: true, openWorldHint: false };
    const DEVICE = s('Which phone: its name or id. Defaults to the one seen most recently.');
    return [
      {
        name: 'homebase_devices', title: 'Homebase phones',
        description: 'Phones running the Homebase app that report to this server: when each was last seen, its app version and connection.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: Object.assign({ title: 'Homebase phones' }, RO),
        async run() {
          const all = list();
          if (!all.length) return { text: 'No Homebase phone has reported yet.', data: { devices: [] } };
          return {
            text: all.map((d) => `- ${d.info.name || d.info.model} (${d.info.id}) · Homebase ${d.info.app_version} · ${presence(d)} · ${LINK[d.state && d.state.link] || 'unknown'}`).join('\n'),
            data: { devices: all.map((d) => ({ ...d.info, seen_at: d.seenAt ? new Date(d.seenAt).toISOString() : null, online: online(d), link: d.state && d.state.link })) }
          };
        }
      },
      {
        name: 'homebase_state', title: 'Homebase live state',
        description: 'What Homebase on the phone shows right now: the server and its connection (Tailscale, home Wi-Fi), each app with its running dot and summary, what is on screen, found apps, settings. Call this first.',
        inputSchema: { type: 'object', properties: { device: DEVICE }, additionalProperties: false },
        annotations: Object.assign({ title: 'Homebase live state' }, RO),
        async run(a) { const d = pick(a.device); return { text: describe(d), data: { device: d.info, online: online(d), seen_at: d.seenAt ? new Date(d.seenAt).toISOString() : null, state: d.state || null } }; }
      },
      {
        name: 'homebase_events', title: 'Homebase recent events',
        description: 'What happened on the phone, newest last: connection changes (Tailscale on/off, home Wi-Fi), apps opened with how long each step took, apps going down or up, problems shown, commands run.',
        inputSchema: { type: 'object', properties: {
          device: DEVICE,
          limit: { type: 'integer', description: 'How many, newest first counted. Default 40.', minimum: 1, maximum: MAX_EVENTS },
          type: s('Only this kind: link, app_open, app_ready, app_status, problem, command, start, stop.')
        }, additionalProperties: false },
        annotations: Object.assign({ title: 'Homebase recent events' }, RO),
        async run(a) {
          const d = pick(a.device);
          const ev = d.events.filter((e) => !a.type || e.type === a.type).slice(-(a.limit || 40));
          return {
            text: ev.length ? `${d.info.name || d.info.model} · ${presence(d)}\n${ev.map((e) => `[${e.at}] ${e.type}: ${e.text}`).join('\n')}` : 'No events yet.',
            data: { device: d.info.id, events: ev }
          };
        }
      },
      {
        name: 'homebase_do', title: 'Ask Homebase to do something',
        description: 'Asks Homebase on the phone to act, and waits up to 15 s for the answer. Works while Homebase is open on the phone. Actions: ' +
          Object.entries(ACTIONS).map(([k, v]) => `${k} (${v})`).join('; ') + '. It cannot change the access token, the fingerprint lock or forget a server.',
        inputSchema: { type: 'object', properties: {
          device: DEVICE,
          action: s('What to do.', { enum: Object.keys(ACTIONS) }),
          app: s('The app: its id or name (or, for found apps, its name or address).'),
          url: s('For add_app: the address.'),
          name: s('For add_app: the name on the tile.'),
          value: s('For set_open_on_launch (app or "launcher") and set_tailscale_warning ("on"/"off").')
        }, required: ['action'], additionalProperties: false },
        annotations: { title: 'Ask Homebase to do something', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        async run(a) {
          const d = pick(a.device);
          const needs = { open_app: 'app', reload_app: 'app', page_info: 'app', add_found_app: 'app', hide_found_app: 'app', remove_app: 'app', add_app: 'url', set_open_on_launch: 'value', set_tailscale_warning: 'value' }[a.action];
          if (needs && !a[needs]) throw userError(`${a.action} needs "${needs}".`);
          const args = {};
          for (const k of ['app', 'url', 'name', 'value']) if (a[k] != null) args[k] = a[k];
          const c = await command(d, a.action, args, online(d) ? 15000 : 0); // in the background: queue it, don't wait
          if (c.status === 'done') return { text: c.result || 'Done.', data: { command: c.id, status: c.status, result: c.result } };
          if (c.status === 'failed') return { text: `The phone couldn't do that: ${c.result}`, data: { command: c.id, status: c.status, result: c.result } };
          const where = online(d) ? 'It is open but hasn\'t answered yet' : `Homebase isn't open on the phone right now (${presence(d)})`;
          return { text: `Sent. ${where}; it will run when Homebase is next open. Check homebase_events for the result.`, data: { command: c.id, status: c.status } };
        }
      }
    ];
  }

  // ---------- HTTP (behind APP_TOKEN, under /api/homebase/) ----------
  async function handle(route, req, res, { readJson, sendJson, url }) {
    if (route === 'POST /api/homebase/report') return sendJson(res, 200, report(await readJson(req)));
    if (route === 'GET /api/homebase/commands') {
      const id = str(url.searchParams.get('device'), 64);
      const wait = Math.min(LONG_POLL_MS, Math.max(0, Number(url.searchParams.get('wait')) * 1000 || 0));
      return sendJson(res, 200, { commands: await takeCommands(id, wait) });
    }
    if (route === 'POST /api/homebase/commands/ack') return sendJson(res, 200, ack(await readJson(req)));
    return false;
  }

  return { handle, mcpTools, report, ack, takeCommands, devices: () => devices };
};
