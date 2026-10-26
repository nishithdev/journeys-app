/* Journeys — a small PWA that tracks life journeys step by step, synced to a Google Sheet. */
(function () {
  'use strict';

  // ---------- constants ----------
  var LS = { config: 'jt.config', data: 'jt.data', outbox: 'jt.outbox', demo: 'jt.demo', mode: 'jt.mode', recent: 'jt.recent', addons: 'jt.addons', addonsDemo: 'jt.addons.demo' };
  var WAIT_WARN_DAYS = 7;
  var TYPES = [
    { id: 'Job', icon: 'briefcase', first: 'Applied', steps: ['Applied', 'Interview', 'Background check', 'Offer letter', 'Joined', 'Rejected'] },
    { id: 'Home', icon: 'home', first: 'Applied', steps: ['Applied', 'Approved', 'Lease signed', 'Moved in'] },
    { id: 'Documents', icon: 'doc', first: 'Submitted', steps: ['Submitted', 'Processing', 'Approved', 'Received'] },
    { id: 'Travel', icon: 'plane', first: 'Booked', steps: ['Booked', 'Visa applied', 'Visa approved', 'Departed', 'Returned'] },
    { id: 'Health', icon: 'heart', first: 'Appointment', steps: ['Appointment', 'Tests', 'Results', 'Treatment', 'Recovered'] },
    { id: 'Purchase', icon: 'bag', first: 'Ordered', steps: ['Researched', 'Ordered', 'Shipped', 'Delivered'] },
    { id: 'Other', icon: 'flag', first: 'Started', steps: ['Started', 'In progress', 'Done'] }
  ];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // How a finished journey ended. `got` is the default last-step name per journey type.
  var OUTCOMES = [
    { id: 'got', label: 'Got it', hint: 'Offer, approval, done', icon: 'check', cls: 'got',
      got: { Job: 'Joined', Home: 'Moved in', Documents: 'Received', Travel: 'Returned', Health: 'Recovered', Purchase: 'Delivered', Other: 'Done' } },
    { id: 'rejected', label: 'Rejected', hint: 'They said no', icon: 'close', cls: 'rejected', step: 'Rejected' },
    { id: 'withdrew', label: 'Withdrew', hint: 'You stepped away', icon: 'undo', cls: 'withdrew', step: 'Withdrew' },
    { id: 'other', label: 'Other', hint: 'Closed, expired…', icon: 'more', cls: 'other', step: 'Closed' }
  ];
  function outcomeOf(id) { return OUTCOMES.find(function (o) { return o.id === id; }) || null; }
  function finalStepFor(outcomeId, type) {
    var o = outcomeOf(outcomeId);
    if (!o) return '';
    return o.got ? (o.got[type] || 'Done') : o.step;
  }
  // Calendar colors for journeys; each also differs in lightness so dots stay distinguishable.
  var JOURNEY_COLORS = ['#2451D6', '#E8833A', '#0F8A7A', '#9B3FB5', '#C2372B', '#6B7A12', '#5B6478'];

  var ICONS = {
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
    doc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    plane: '<path d="M10.5 13.5L3 11l1.5-1.5 7.5 1 4-4.5a2 2 0 0 1 3 3l-4.5 4 1 7.5L13 22l-2.5-7.5"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.7-4.4M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4M20 20v-4h-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    undo: '<path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-2"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    flagDone: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/><path d="M9 7l1.5 1.5L13 6"/>'
  };
  function icon(name, size, sw) {
    return '<svg aria-hidden="true" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  // ---------- small helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full or blocked */ }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoLocal(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return isoLocal(new Date()); }
  function addDays(iso, n) { var p = iso.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return isoLocal(d); }
  function utc(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function days(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function validIso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(utc(s)); }
  function fmt(iso, withYear) {
    if (!validIso(iso)) return '';
    var p = iso.split('-');
    var s = MONTHS[+p[1] - 1] + ' ' + (+p[2]);
    if (withYear || p[0] !== today().slice(0, 4)) s += ', ' + p[0];
    return s;
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function uid(prefix) {
    var a = new Uint8Array(5);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return prefix + Array.prototype.map.call(a, function (b) { return pad(b.toString(16)).slice(-2); }).join('');
  }
  function typeOf(t) { return TYPES.find(function (x) { return x.id === t; }) || TYPES[TYPES.length - 1]; }

  // ---------- state ----------
  // 'server' once a Journeys server has answered at this address; otherwise the app runs on sample data.
  var mode = load(LS.mode, 'demo');
  var cfg = load(LS.config, {});
  if (typeof cfg !== 'object' || !cfg) cfg = {};
  var state = {
    data: load(mode === 'server' ? LS.data : LS.demo, null),
    outbox: load(LS.outbox, []),
    sync: { status: 'idle', error: '', last: null },
    server: null,
    filter: 'all',
    sheet: null,
    menu: false,
    search: { q: '' },
    cal: null,     // { y, m, sel } — month shown in the calendar and the selected day
    year: null     // year shown in Year in review
  };
  function isDemo() { return mode !== 'server'; }
  if (!state.data) state.data = isDemo() ? sampleData() : { journeys: [], steps: [] };

  function saveData() { store(isDemo() ? LS.demo : LS.data, state.data); }

  function sampleData() {
    var t = today();
    var j = [
      { id: 'Jdemo1', name: 'Acme Corp', type: 'Job', status: 'Active' },
      { id: 'Jdemo2', name: 'Passport renewal', type: 'Documents', status: 'Active' },
      { id: 'Jdemo3', name: 'Lakeview apartment', type: 'Home', status: 'Done', outcome: 'got' },
      { id: 'Jdemo4', name: 'Globex', type: 'Job', status: 'Done', outcome: 'rejected' },
      { id: 'Jdemo5', name: 'Initech', type: 'Job', status: 'Done', outcome: 'withdrew' },
      { id: 'Jdemo6', name: 'Hooli', type: 'Job', status: 'Done', outcome: 'rejected' },
      { id: 'Jdemo7', name: 'Umbrella Labs', type: 'Job', status: 'Done', outcome: 'got' }
    ];
    var s = [
      ['Jdemo1', 'Applied', -25, 'Via LinkedIn'], ['Jdemo1', 'Interview', -15, '2 rounds, panel + manager'],
      ['Jdemo1', 'Background check', -5, ''], ['Jdemo1', 'Offer letter', 0, ''],
      ['Jdemo2', 'Submitted', -15, 'Online, paid expedite fee'], ['Jdemo2', 'Processing', -12, ''],
      ['Jdemo3', 'Applied', -80, ''], ['Jdemo3', 'Approved', -77, ''], ['Jdemo3', 'Moved in', -61, 'Unit 4B'],
      ['Jdemo4', 'Applied', -230, ''], ['Jdemo4', 'Phone interview', -223, 'Recruiter: Priya. Asked about remote work'], ['Jdemo4', 'Rejected', -218, ''],
      ['Jdemo5', 'Applied', -200, ''], ['Jdemo5', 'Interview', -189, 'Onsite, 4 hours'], ['Jdemo5', 'Withdrew', -182, 'Took a different offer'],
      ['Jdemo6', 'Applied', -150, ''], ['Jdemo6', 'Rejected', -141, 'Form email'],
      ['Jdemo7', 'Applied', -400, ''], ['Jdemo7', 'Interview', -388, ''], ['Jdemo7', 'Offer letter', -374, ''], ['Jdemo7', 'Joined', -360, '']
    ].map(function (r, i) { return { id: 'Sdemo' + i, journeyId: r[0], step: r[1], date: addDays(t, r[2]), notes: r[3] }; });
    j.forEach(function (x) { x.created = s.find(function (y) { return y.journeyId === x.id; }).date; });
    return { journeys: j, steps: s };
  }

  // ---------- derived data ----------
  function stepsOf(jid) {
    return state.data.steps
      .map(function (s, i) { return { s: s, i: i }; })
      .filter(function (x) { return x.s.journeyId === jid; })
      .sort(function (a, b) { return a.s.date < b.s.date ? -1 : a.s.date > b.s.date ? 1 : a.i - b.i; })
      .map(function (x) { return x.s; });
  }
  function info(j) {
    var st = stepsOf(j.id);
    var first = st[0], last = st[st.length - 1];
    var gaps = [];
    for (var i = 1; i < st.length; i++) gaps.push(days(st[i - 1].date, st[i].date));
    var done = j.status === 'Done';
    var t = today();
    return {
      j: j, steps: st, first: first, last: last, gaps: gaps, done: done,
      total: first && last ? days(first.date, last.date) : 0,
      daysIn: first ? Math.max(0, days(first.date, done ? last.date : t)) : 0,
      sinceLast: last ? Math.max(0, days(last.date, t)) : 0,
      longest: gaps.length ? Math.max.apply(null, gaps) : 0
    };
  }
  function allInfo() { return state.data.journeys.map(info); }

  // ---------- sync with the Journeys server (which saves to Google Sheets) ----------
  // Relative URLs, so the app also works when the server sits under a sub-path behind a proxy.
  function api(body) {
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    return fetch('api', { method: 'POST', headers: headers, body: JSON.stringify(body), cache: 'no-store' }).then(function (res) {
      return res.json().catch(function () {
        throw new Error(res.ok ? 'The server sent an unexpected reply.' : 'The server answered with HTTP ' + res.status + '.');
      }).then(function (j) {
        // kind: user = this change is invalid, config/auth = setup problem, retry = try again later
        if (!j.ok) { var e = new Error(j.error || 'The server reported an error.'); e.server = true; e.kind = j.kind || 'retry'; throw e; }
        return j.payload;
      });
    });
  }

  function haCall(btn, url, describe) {
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…';
    var headers = {};
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    fetch(url, { method: 'POST', headers: headers, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { toast(j.ok ? describe(j.payload) : j.error); },
        function () { toast("Can't reach your Journeys server."); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  }

  // Is this copy of the app being served by a Journeys server?
  function probe() {
    return fetch('api/health', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
      .catch(function () { return null; })
      .then(function (h) {
        if (!h || !h.ok || h.app !== 'journeys') return; // unreachable, or just static files: keep the current mode
        state.server = h;
        store(LS.addons, h.addons || []);
        if (mode !== 'server') {
          mode = 'server'; store(LS.mode, mode);
          // An add-on loaded with sample data would keep using it: start again on the server's data.
          if (Object.keys(addons).length) { location.reload(); return; }
          state.data = load(LS.data, null) || { journeys: [], steps: [] };
          render();
        }
        loadAddons(); // after the mode is settled, so it uses the server's list
      });
  }

  var syncing = null;
  function sync() {
    if (isDemo()) { setSync('demo'); return Promise.resolve(); }
    if (syncing) { syncing.again = true; return syncing.p; }
    if (!navigator.onLine) { setSync('offline'); return Promise.resolve(); }
    var run = { again: false };
    setSync('syncing');
    run.p = (function flush(last) {
      if (!state.outbox.length) return Promise.resolve(last);
      var op = state.outbox[0];
      return api(op).then(function (p) {
        state.outbox.shift(); store(LS.outbox, state.outbox); return flush(p);
      }, function (err) {
        if (err.kind === 'user') {
          // The server rejected this change itself; drop it so it doesn't block everything else.
          state.outbox.shift(); store(LS.outbox, state.outbox);
          toast('A change could not be saved: ' + err.message);
          return flush(last);
        }
        throw err;
      });
    })(null).then(function (p) {
      // Each change already answers with the whole Sheet, so only read when nothing was sent.
      return p && p.data ? p : api({ action: 'read' });
    }).then(function (p) {
      // The server answered at once from its saved copy of the Sheet: show that now, then get the fresh one.
      if (!p.stale || state.outbox.length) return p;
      state.data = p.data; saveData(); setSync('syncing');
      return api({ action: 'read', fresh: true });
    }).then(function (p) {
      if (!state.outbox.length) { state.data = p.data; saveData(); }
      if (p.data.sheetUrl) { cfg.sheetUrl = p.data.sheetUrl; store(LS.config, cfg); }
      state.sync.last = new Date();
      setSync(state.outbox.length ? 'pending' : 'synced');
    }).catch(function (err) {
      if (err.server) { state.sync.error = err.message; setSync('error'); }
      else { state.sync.error = "Can't reach your Journeys server. Check that you're on the VPN."; setSync('offline'); }
    }).then(function () {
      syncing = null;
      if (run.again) return sync();
    });
    syncing = run;
    return run.p;
  }
  function setSync(status) {
    state.sync.status = status;
    if (status === 'synced' || status === 'demo') state.sync.error = '';
    // Don't redraw a form the person is typing in; just refresh the status pill.
    var a = document.activeElement;
    if (a && a.form && (a.form.id === 'new-form' || a.form.id === 'cfg-form' || a.form.id === 'server-form')) {
      document.querySelectorAll('.sync').forEach(function (el) { el.outerHTML = syncPill(); });
      return;
    }
    render();
  }
  function mutate(op, apply) {
    apply(state.data);
    saveData();
    if (!isDemo()) { state.outbox.push(op); store(LS.outbox, state.outbox); }
    render();
    sync();
  }

  // ---------- actions on data ----------
  function addJourney(name, type, firstStep, date, notes) {
    var id = uid('J'), sid = uid('S');
    mutate({ action: 'addJourney', id: id, name: name, type: type, firstStep: firstStep, firstStepId: sid, date: date, notes: notes }, function (d) {
      d.journeys.push({ id: id, name: name, type: type, status: 'Active', created: today() });
      d.steps.push({ id: sid, journeyId: id, step: firstStep, date: date, notes: notes });
    });
    return id;
  }
  function addStep(jid, step, date, notes, final, outcome) {
    var id = uid('S');
    var op = { action: 'addStep', id: id, journeyId: jid, step: step, date: date, notes: notes, final: !!final };
    if (final && outcome) op.outcome = outcome;
    mutate(op, function (d) {
      d.steps.push({ id: id, journeyId: jid, step: step, date: date, notes: notes });
      if (final) d.journeys.forEach(function (j) { if (j.id === jid) { j.status = 'Done'; j.outcome = outcome || ''; } });
    });
  }
  function updateStep(id, step, date, notes) {
    mutate({ action: 'updateStep', id: id, step: step, date: date, notes: notes }, function (d) {
      d.steps.forEach(function (s) { if (s.id === id) { s.step = step; s.date = date; s.notes = notes; } });
    });
  }
  function deleteStep(id) {
    mutate({ action: 'deleteStep', id: id }, function (d) {
      d.steps = d.steps.filter(function (s) { return s.id !== id; });
    });
  }
  function updateJourney(id, fields) {
    mutate(Object.assign({ action: 'updateJourney', id: id }, fields), function (d) {
      d.journeys.forEach(function (j) {
        if (j.id !== id) return;
        Object.assign(j, fields);
        if (fields.status === 'Active') j.outcome = ''; // reopened: no outcome yet
      });
    });
  }
  function deleteJourney(id) {
    mutate({ action: 'deleteJourney', id: id }, function (d) {
      d.journeys = d.journeys.filter(function (j) { return j.id !== id; });
      d.steps = d.steps.filter(function (s) { return s.journeyId !== id; });
    });
  }

  // ---------- add-ons ----------
  // Optional features that live in their own folder (e.g. app/goals/) and are switched on in Settings.
  // The server lists them in /api/health; with sample data, the switch is kept on this device.
  // An add-on's script calls Journeys.register({ id, route, screen, tab, actions, sheet, onSubmit, onInput, settingsPanel, start }).
  var DEMO_ADDONS = [{ id: 'goals', name: 'Goals & habits', description: 'Habits with streaks, goals with milestones, and evening check-ins from Home Assistant.', script: 'goals/goals.js', style: 'goals/goals.css' }];
  var addons = {};
  function addonList() {
    if (isDemo()) {
      var on = load(LS.addonsDemo, {});
      return DEMO_ADDONS.map(function (a) { return Object.assign({}, a, { enabled: !!on[a.id] }); });
    }
    var l = (state.server && state.server.addons) || load(LS.addons, []);
    return Array.isArray(l) ? l : [];
  }
  function eachAddon(fn) { Object.keys(addons).forEach(function (k) { fn(addons[k]); }); }
  function loadAddons() {
    var list = addonList();
    // Turned off (here or on another device) while loaded: reload without it.
    if (Object.keys(addons).some(function (id) { return !list.some(function (a) { return a.id === id && a.enabled; }); })) { location.reload(); return; }
    list.forEach(function (a) {
      if (!a.enabled || addons[a.id] || document.querySelector('script[data-addon="' + a.id + '"]')) return;
      if (!/^[\w-]+\/[\w.-]+\.js$/.test(a.script || '')) return; // only the app's own files
      if (a.style) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = a.style; document.head.appendChild(l); }
      var sc = document.createElement('script'); sc.src = a.script; sc.dataset.addon = a.id; document.body.appendChild(sc);
    });
  }
  function toggleAddon(a, on, input) {
    function done() { location.reload(); } // simplest way to load or unload an add-on's files
    if (isDemo()) { var m = load(LS.addonsDemo, {}); m[a.id] = on; store(LS.addonsDemo, m); done(); return; }
    if (!on && !window.confirm('Turn off ' + a.name + '? Everything you saved stays in your Sheet, and turning it back on brings it back.')) { input.checked = true; return; }
    input.disabled = true;
    var body = { values: {} };
    body.values[a.setting] = on;
    settingsCall('POST', body).then(function () {
      var l = addonList().map(function (x) { return x.id === a.id ? Object.assign({}, x, { enabled: on }) : x; });
      store(LS.addons, l);
      done();
    }, function (e) { input.disabled = false; input.checked = !on; toast(e.message); });
  }
  window.Journeys = {
    register: function (m) { addons[m.id] = m; if (m.start) m.start(); render(); },
    h: {
      esc: esc, icon: icon, ICONS: ICONS, toast: toast, go: go, render: render, renderSheet: renderSheet, closeSheet: closeSheet,
      openSheet: function (sh) { state.sheet = Object.assign({ kind: 'addon' }, sh); state.menu = false; render(); },
      sheet: function () { return state.sheet; },
      today: today, addDays: addDays, days: days, validIso: validIso, fmt: fmt, plural: plural, uid: uid, pad: pad,
      isDemo: isDemo, load: load, store: store, dateField: dateField, syncPill: syncPill, settingsCall: settingsCall, haCall: haCall,
      token: function () { return cfg.token; }, server: function () { return state.server; },
      motion: { burst: burst, burstAt: burstAt, confetti: confetti, enter: markEnter, reduced: reduceMotion },
      MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG, WEEKDAYS: WEEKDAYS
    }
  };

  // ---------- routing ----------
  function route() {
    var h = (location.hash || '#/').slice(1);
    var m;
    if ((m = /^\/j\/([\w-]+)$/.exec(h))) return { name: 'journey', id: m[1] };
    if (h === '/new') return { name: 'new' };
    if (h === '/insights') return { name: 'insights' };
    if (h === '/insights/calendar') return { name: 'calendar' };
    if (h === '/insights/year') return { name: 'year' };
    if (h === '/search') return { name: 'search' };
    if (h === '/settings') return { name: 'settings' };
    if (h === '/server') return { name: 'server' };
    var ar = null;
    eachAddon(function (m) { if (!ar && m.route) { ar = m.route(h); if (ar) ar.addon = m.id; } });
    if (ar) return ar;
    return { name: 'home' };
  }
  function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

  // ---------- motion ----------
  // Screens animate in only when you arrive on them (not on every refresh from a sync), values slide
  // from their previous number, and a few moments get a small celebration. All of it is skipped when
  // the phone asks for reduced motion.
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduceMotion() { return !!(motionQuery && motionQuery.matches); }
  var lastScreen = null, forceEnter = false, enterTimer = null;
  var animMemory = {};
  function markEnter() { forceEnter = true; }
  function stagger(scope) {
    var i = 0;
    var groups = scope.querySelectorAll('.screen > *:not(.menu), .tl > *, .g-list > *, .result-list > *, .tiles > *, .stats > *, .chips > *');
    groups.forEach(function (el) {
      if (el.closest('.tabbar') || el.classList.contains('fab')) return;
      var d = Math.min(i++ * 35, 420) + 'ms';
      el.classList.add('rise');
      el.style.animationDelay = d;
      el.style.setProperty('--d', d); // children (timeline nodes and lines) follow their row
    });
  }
  // Elements with data-anim="key" slide their width (or a ring's dash) from the value they had last time.
  function animateValues(scope, entering) {
    scope.querySelectorAll('[data-anim]').forEach(function (el) {
      var key = el.getAttribute('data-anim'), ring = el.tagName.toLowerCase() === 'circle';
      var to = ring ? el.getAttribute('stroke-dasharray') : el.style.width;
      var from = animMemory[key];
      if (from == null && entering) from = ring ? '0 999' : '0%';
      animMemory[key] = to;
      if (from == null || from === to || reduceMotion()) return;
      var prop = ring ? 'strokeDasharray' : 'width';
      el.style.transition = 'none';
      el.style[prop] = from;
      el.getBoundingClientRect(); // apply the start value before transitioning
      el.style.transition = (ring ? 'stroke-dasharray' : 'width') + ' .8s cubic-bezier(.2, .8, .2, 1)';
      el.style[prop] = to;
    });
  }
  // Numbers in stat tiles count up when a screen opens.
  function countUp(scope) {
    scope.querySelectorAll('.stat b, .tile b, .big-num b, .yh-stats b, .g-ring-card b').forEach(function (el) {
      var node = el.firstChild;
      if (!node || node.nodeType !== 3) return;
      var m = /^(\D*)(\d+)(.*)$/.exec(node.nodeValue);
      if (!m || +m[2] < 2 || m[3].charAt(0) === '.' || m[3].charAt(0) === ',') return;
      var target = +m[2], start = performance.now(), dur = Math.min(900, 300 + target * 15);
      (function step(now) {
        var t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
        node.nodeValue = m[1] + Math.round(target * e) + m[3];
        if (t < 1 && node.parentNode) requestAnimationFrame(step);
      })(start);
    });
  }
  var SPARK_COLORS = ['#2451D6', '#6E8FE8', '#A9BDF2', '#2E9E5B', '#E8833A', '#F2C14E'];
  // A small burst of sparks around a point, e.g. a habit's check circle.
  function burst(x, y, opts) {
    if (reduceMotion() || !document.body.animate) return;
    opts = opts || {};
    var n = opts.count || 14, spread = opts.spread || 34;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i');
      p.className = 'spark';
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
      document.body.appendChild(p);
      var a = Math.PI * 2 * i / n + Math.random() * 0.4, d = spread + Math.random() * 18;
      p.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + (Math.cos(a) * d).toFixed(1) + 'px), calc(-50% + ' + (Math.sin(a) * d).toFixed(1) + 'px)) scale(.2)', opacity: 0 }
      ], { duration: 520 + Math.random() * 240, easing: 'cubic-bezier(.15, .8, .3, 1)' }).onfinish = (function (el) { return function () { el.remove(); }; })(p);
    }
  }
  function burstAt(el, opts) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, opts);
  }
  // Confetti across the screen, for finishing something big.
  function confetti() {
    if (reduceMotion() || !document.body.animate) return;
    var w = window.innerWidth, h = window.innerHeight;
    for (var i = 0; i < 70; i++) {
      var p = document.createElement('i');
      p.className = 'confetti';
      p.style.left = (Math.random() * w) + 'px';
      p.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
      if (i % 3 === 0) p.style.borderRadius = '50%';
      document.body.appendChild(p);
      var drift = (Math.random() - 0.5) * 160, spin = (Math.random() - 0.5) * 900;
      p.animate([
        { transform: 'translate(0, -20px) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + (drift / 2).toFixed(0) + 'px, ' + (h * 0.55).toFixed(0) + 'px) rotate(' + (spin / 2).toFixed(0) + 'deg)', opacity: 1, offset: 0.6 },
        { transform: 'translate(' + drift.toFixed(0) + 'px, ' + (h + 40) + 'px) rotate(' + spin.toFixed(0) + 'deg)', opacity: 0 }
      ], { duration: 1500 + Math.random() * 1100, delay: Math.random() * 250, easing: 'cubic-bezier(.25, .6, .45, 1)' }).onfinish = (function (el) { return function () { el.remove(); }; })(p);
    }
  }

  // ---------- rendering ----------
  var root = document.getElementById('app');
  var sheetRoot = document.createElement('div');
  document.body.appendChild(sheetRoot);

  function render() {
    var r = route();
    var html;
    if (r.addon) html = addons[r.addon].screen(r) + (r.tab ? tabbar(r.tab) : '');
    else if (r.name === 'journey') html = journeyScreen(r.id);
    else if (r.name === 'new') html = newScreen();
    else if (r.name === 'insights') html = insightsScreen() + tabbar('insights');
    else if (r.name === 'calendar') html = calendarScreen() + tabbar('insights');
    else if (r.name === 'year') html = yearScreen() + tabbar('insights');
    else if (r.name === 'search') html = searchScreen() + tabbar('home');
    else if (r.name === 'settings') html = settingsScreen() + tabbar('settings');
    else if (r.name === 'server') html = serverScreen() + tabbar('settings');
    else html = homeScreen() + tabbar('home');
    var active = document.activeElement;
    var keepFocus = active && active.id && root.contains(active) ? { id: active.id, val: active.value, s: active.selectionStart } : null;
    // Animate in only when arriving on a screen (or when a view inside it switches).
    var screenKey = location.hash || '#/';
    var entering = (screenKey !== lastScreen || forceEnter) && !reduceMotion();
    lastScreen = screenKey; forceEnter = false;
    root.classList.toggle('enter', entering);
    root.innerHTML = html;
    if (entering) {
      stagger(root);
      countUp(root);
      clearTimeout(enterTimer);
      enterTimer = setTimeout(function () { root.classList.remove('enter'); }, 1400);
    }
    animateValues(root, entering);
    if (keepFocus) {
      var el = document.getElementById(keepFocus.id);
      if (el) { el.value = keepFocus.val; el.focus(); try { el.setSelectionRange(keepFocus.s, keepFocus.s); } catch (e) { /* not a text field */ } }
    }
    renderSheet();
  }

  function tabbar(cur) {
    function tab(id, href, ic, label) {
      return '<a class="tab" href="' + href + '"' + (cur === id ? ' aria-current="page"' : '') + '>' + icon(ic, 22) + label + '</a>';
    }
    var extra = '';
    eachAddon(function (m) { if (m.tab) extra += tab(m.tab.id, m.tab.href, m.tab.icon, m.tab.label); });
    return '<nav class="tabbar" aria-label="Main"><div class="tabbar-inner">' +
      tab('home', '#/', 'list', 'Journeys') + extra + tab('insights', '#/insights', 'chart', 'Insights') + tab('settings', '#/settings', 'gear', 'Settings') +
      '</div></nav>';
  }

  function syncPill() {
    var s = state.sync.status, n = state.outbox.length;
    var label = {
      demo: 'Sample data', syncing: 'Syncing…', synced: 'Synced', offline: n ? 'Offline · ' + n + ' to sync' : 'Offline',
      error: 'Sync problem', pending: n + ' to sync', idle: n ? n + ' to sync' : 'Sheet'
    }[isDemo() ? 'demo' : s] || 'Sheet';
    var cls = isDemo() ? 'demo' : (s === 'error' ? 'error' : s === 'offline' ? 'offline' : (n || s === 'syncing') ? 'pending' : '');
    return '<button class="sync ' + cls + '" data-action="sync-now" aria-label="Sync status: ' + esc(label) + '. Tap to sync."><span class="dot"></span>' + esc(label) + '</button>';
  }

  function banner() {
    if (isDemo()) return '<div class="banner"><span>You\'re looking at sample data.</span><a href="#/settings">Why?</a></div>';
    if (state.sync.status === 'error') return '<div class="banner error" role="alert"><span>' + esc(state.sync.error) + '</span><a href="#/settings">Fix</a></div>';
    return '';
  }

  function mini(ii) {
    var st = ii.steps, out = '';
    if (!st.length) return '';
    st.forEach(function (s, i) {
      if (i > 0) out += '<div class="g" style="flex:' + Math.max(1, ii.gaps[i - 1]) + '"></div>';
      var cur = !ii.done && i === st.length - 1;
      out += '<div class="n' + (cur ? ' cur' : '') + '"></div>';
    });
    if (!ii.done) {
      var wait = ii.sinceLast >= WAIT_WARN_DAYS;
      out += '<div class="g ' + (wait ? 'wait' : 'todo') + '" style="flex:' + Math.max(2, ii.sinceLast) + '"></div><div class="n todo"></div>';
    }
    return '<div class="mini" aria-hidden="true">' + out + '</div>';
  }

  function homeScreen() {
    var all = allInfo();
    var active = all.filter(function (x) { return !x.done; }).sort(function (a, b) { return (b.last ? b.last.date : '') < (a.last ? a.last.date : '') ? -1 : 1; });
    var done = all.filter(function (x) { return x.done; }).sort(function (a, b) { return (b.last ? b.last.date : '') < (a.last ? a.last.date : '') ? -1 : 1; });
    var f = state.filter;
    var d = new Date();
    var dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

    var h = '<main class="screen">' +
      '<div class="top"><div><div class="eyebrow">' + esc(dateLabel) + '</div><h1>Journeys</h1></div>' +
      '<div class="top-actions"><a class="icon-btn" href="#/search" aria-label="Search journeys, steps and notes">' + icon('search', 20) + '</a>' + syncPill() + '</div></div>' +
      banner() +
      '<div class="chips" role="group" aria-label="Filter">' +
      filterChip('all', 'All · ' + all.length) + filterChip('active', 'In progress · ' + active.length) + filterChip('done', 'Done · ' + done.length) +
      '</div>';

    if (!all.length) {
      h += '<div class="empty"><h2>No journeys yet</h2><p>A journey is anything with steps, like a job application, a visa or a move. Add the first step and keep going from there.</p>' +
        '<a class="btn" style="flex:none" href="#/new">' + icon('plus', 18, 2.6) + 'Start a journey</a></div>';
    }
    if (f !== 'done' && active.length) {
      h += '<div class="section-label">In progress</div>';
      active.forEach(function (ii) {
        var t = typeOf(ii.j.type);
        var wait = ii.sinceLast >= WAIT_WARN_DAYS;
        var sub = ii.last ? (wait ? 'Waiting ' + plural(ii.sinceLast, 'day') + ' since ' + ii.last.step : 'Now: ' + ii.last.step) : 'No steps yet';
        h += '<a class="card" href="#/j/' + esc(ii.j.id) + '">' +
          '<div class="card-head"><div class="card-id"><div class="type-icon' + (wait ? ' warn' : '') + '">' + icon(t.icon) + '</div>' +
          '<div style="min-width:0"><div class="card-title">' + esc(ii.j.name) + '</div><div class="card-sub' + (wait ? ' warn' : '') + '">' + esc(sub) + '</div></div></div>' +
          '<div class="big-num"><b>' + ii.daysIn + '</b><span>' + (ii.daysIn === 1 ? 'day in' : 'days in') + '</span></div></div>' +
          mini(ii) +
          '<div class="card-foot"><span>' + (ii.first ? esc(ii.first.step) + ' ' + esc(fmt(ii.first.date)) : '') + '</span><span>' + plural(ii.steps.length, 'step') + '</span></div>' +
          '</a>';
      });
    }
    if (f !== 'active' && done.length) {
      h += '<div class="section-label">Completed</div>';
      done.forEach(function (ii) {
        h += '<a class="row-card" href="#/j/' + esc(ii.j.id) + '"><div style="min-width:0"><div class="t">' + esc(ii.j.name) + '</div>' +
          '<div class="s">' + (ii.first ? esc(ii.first.step) + ' → ' + esc(ii.last.step) + ' · ' : '') + plural(ii.steps.length, 'step') + '</div></div>' +
          '<div class="v">' + outcomeBadge(ii.j.outcome) + plural(ii.total, 'day') + '</div></a>';
      });
    }
    if (all.length && f === 'active' && !active.length) h += '<div class="empty"><p>Nothing in progress right now.</p></div>';
    if (all.length && f === 'done' && !done.length) h += '<div class="empty"><p>No finished journeys yet.</p></div>';
    h += '</main><button class="fab" data-action="new" aria-label="Start a new journey">' + icon('plus', 26, 2.4) + '</button>';
    return h;
  }
  function filterChip(id, label) {
    return '<button class="chip" data-action="filter" data-v="' + id + '" aria-pressed="' + (state.filter === id) + '">' + esc(label) + '</button>';
  }

  var SPAN_COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--accent-3)', 'var(--accent-4)'];

  function journeyScreen(id) {
    var j = state.data.journeys.find(function (x) { return x.id === id; });
    if (!j) {
      return '<main class="screen white"><div class="top"><a class="icon-btn soft" href="#/" aria-label="Back">' + icon('back', 20, 2.2) + '</a></div>' +
        '<div class="empty"><h2>Journey not found</h2><p>It may have been deleted on another device.</p></div></main>';
    }
    var ii = info(j);
    var t = typeOf(j.type);
    var h = '<main class="screen white">' +
      '<div class="top"><a class="icon-btn soft" href="#/" aria-label="Back to journeys">' + icon('back', 20, 2.2) + '</a>' +
      '<button class="icon-btn soft" data-action="menu" aria-label="Journey options" aria-expanded="' + state.menu + '">' + icon('more', 20, 2.4) + '</button></div>';
    if (state.menu) {
      h += '<div class="menu" role="menu">' +
        '<button role="menuitem" data-action="rename">Rename</button>' +
        (ii.done
          ? '<button role="menuitem" data-action="change-outcome">' + (j.outcome ? 'Change outcome' : 'Add outcome') + '</button>' +
            '<button role="menuitem" data-action="toggle-done">Reopen journey</button>'
          : '<button role="menuitem" data-action="finish">Finish journey…</button>') +
        (ii.steps.length ? '<button role="menuitem" data-action="share-journey">Share as image</button>' : '') +
        '<button role="menuitem" class="danger" data-action="delete-journey">Delete journey</button></div>';
    }
    h += '<div><div class="kicker">' + esc(t.id) + (ii.done ? ' · Done' : '') + '</div><h1 class="small">' + esc(j.name) + '</h1>' +
      (ii.done && j.outcome ? '<div style="margin-top:8px">' + outcomeBadge(j.outcome, true) + '</div>' : '') + '</div>';
    h += '<div class="stats">' +
      '<div class="stat"><b>' + (ii.done ? ii.total : ii.daysIn) + '<small> days</small></b><span>' + (ii.done ? 'Start to finish' : 'So far') + '</span></div>' +
      '<div class="stat"><b>' + ii.steps.length + '</b><span>' + (ii.steps.length === 1 ? 'Step' : 'Steps') + '</span></div>' +
      '<div class="stat"><b>' + ii.longest + '<small> days</small></b><span>Longest gap</span></div></div>';

    if (ii.steps.length > 1 || (!ii.done && ii.steps.length)) {
      var segs = ii.gaps.slice();
      if (!ii.done && ii.sinceLast > 0) segs.push(ii.sinceLast);
      var sum = segs.reduce(function (a, b) { return a + b; }, 0);
      if (sum > 0) {
        h += '<div><div class="spanbar" role="img" aria-label="Time between steps">' +
          segs.map(function (g, i) {
            var ongoing = !ii.done && i === segs.length - 1 && ii.sinceLast > 0;
            var bg = ongoing ? 'repeating-linear-gradient(90deg,var(--warn-dash) 0 6px,transparent 6px 10px)' : SPAN_COLORS[Math.min(i, SPAN_COLORS.length - 1)];
            return g > 0 ? '<div style="flex:' + g + ';background:' + bg + '"></div>' : '';
          }).join('') +
          '</div><div class="spanbar-legend"><span>' + esc(fmt(ii.first.date)) + '</span><span>' + (ii.done ? esc(fmt(ii.last.date)) : 'Today') + '</span></div></div>';
      }
    }

    h += '<div class="tl">';
    ii.steps.forEach(function (s, i) {
      var isLast = i === ii.steps.length - 1;
      var cur = isLast && !ii.done;
      var gap = isLast ? null : ii.gaps[i];
      var showLine = !isLast || !ii.done;
      h += '<button class="tl-item" data-action="edit-step" data-id="' + esc(s.id) + '" aria-label="Edit step ' + esc(s.step) + '">' +
        '<div class="tl-rail"><div class="tl-node' + (cur ? ' cur' : '') + '">' + (cur ? '' : icon('check', 14, 3)) + '</div>' +
        (showLine ? '<div class="tl-line' + (cur ? ' wait' : '') + '"></div>' : '') + '</div>' +
        '<div class="tl-body"><div class="tl-row"><span class="tl-name">' + esc(s.step) + '</span><span class="tl-date">' + esc(fmt(s.date)) + ' · Day ' + days(ii.first.date, s.date) + '</span></div>' +
        (s.notes ? '<div class="tl-notes">' + esc(s.notes) + '</div>' : '') +
        (gap != null ? '<span class="gap-pill">' + (gap === 0 ? 'Same day' : plural(gap, 'day') + ' later') + '</span>' : '') +
        (cur ? '<span class="gap-pill' + (ii.sinceLast >= WAIT_WARN_DAYS ? ' warn' : '') + '">' + (ii.sinceLast === 0 ? 'Today' : plural(ii.sinceLast, 'day') + ' since, waiting') + '</span>' : '') +
        '</div></button>';
    });
    if (!ii.done) {
      h += '<div class="tl-item" aria-hidden="true"><div class="tl-rail"><div class="tl-node" style="background:var(--card);border:2px dashed #9AA3B5"></div></div>' +
        '<div class="tl-body"><span class="tl-name" style="color:var(--muted);font-weight:600">Next step</span></div></div>';
    }
    h += '</div></main>';
    h += '<div class="bottom-bar"><div class="bottom-bar-inner">' +
      (ii.done
        ? '<button class="btn secondary" data-action="add-step">' + icon('plus', 18, 2.6) + 'Add a step</button>'
        : '<button class="btn" data-action="add-step">' + icon('plus', 18, 2.6) + 'Add next step</button>') +
      '</div></div>';
    return h;
  }

  function newScreen() {
    var n = state.newForm || (state.newForm = { type: 'Job', date: today() });
    var t = typeOf(n.type);
    return '<main class="screen white"><div class="top"><a class="icon-btn soft" href="#/" aria-label="Cancel">' + icon('close', 18, 2.4) + '</a></div>' +
      '<h1 class="small">New journey</h1>' +
      '<form id="new-form" class="sheet" style="padding:0;animation:none;border-radius:0;max-height:none;overflow:visible" novalidate>' +
      '<div class="field"><label for="nj-name">What is it?</label><input class="input" id="nj-name" name="name" autocomplete="off" placeholder="e.g. Acme Corp, Passport renewal" value="' + esc(n.name || '') + '" required></div>' +
      '<div class="field"><span class="label" id="nj-type-l">Type</span><div class="chips" role="group" aria-labelledby="nj-type-l">' +
      TYPES.map(function (x) { return '<button type="button" class="chip accent" data-action="nj-type" data-v="' + x.id + '" aria-pressed="' + (n.type === x.id) + '">' + esc(x.id) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="field"><label for="nj-step">First step</label><input class="input" id="nj-step" name="step" autocomplete="off" value="' + esc(n.step != null ? n.step : t.first) + '" required></div>' +
      dateField('nj-date', n.date) +
      '<div class="field"><label for="nj-notes">Notes <span class="opt">(optional)</span></label><textarea class="input" id="nj-notes" name="notes" rows="2">' + esc(n.notes || '') + '</textarea></div>' +
      '<p class="error-text" id="nj-err" role="alert"></p>' +
      '<button class="btn" type="submit" style="flex:none">Start journey</button>' +
      '</form></main>';
  }

  function dateField(id, val) {
    var t = today(), y = addDays(t, -1);
    return '<div class="field"><label for="' + id + '">When?</label><div class="date-row">' +
      '<button type="button" class="chip" data-action="set-date" data-for="' + id + '" data-v="' + t + '" aria-pressed="' + (val === t) + '">Today</button>' +
      '<button type="button" class="chip" data-action="set-date" data-for="' + id + '" data-v="' + y + '" aria-pressed="' + (val === y) + '">Yesterday</button>' +
      '<input class="input" type="date" id="' + id + '" name="date" value="' + esc(val) + '" max="' + addDays(t, 365) + '" required></div></div>';
  }

  function insightsScreen() {
    var all = allInfo().filter(function (x) { return x.steps.length; });
    var done = all.filter(function (x) { return x.done; });
    var gaps = [];
    all.forEach(function (ii) { ii.gaps.forEach(function (g, i) { gaps.push({ ii: ii, g: g, from: ii.steps[i].step, to: ii.steps[i + 1].step }); }); });
    var avg = gaps.length ? gaps.reduce(function (a, x) { return a + x.g; }, 0) / gaps.length : null;

    var h = '<main class="screen"><div class="top"><h1>Insights</h1>' + syncPill() + '</div>' + insightsTabs('insights') +
      '<div class="tiles"><div class="tile"><span>Journeys done</span><b>' + done.length + '</b></div>' +
      '<div class="tile"><span>Avg. days between steps</span><b>' + (avg == null ? '–' : (Math.round(avg * 10) / 10)) + '</b></div></div>';

    if (!all.length) return h + '<div class="empty"><p>Insights show up once you have a journey with a few steps.</p></div></main>';

    var spans = all.map(function (ii) { return { ii: ii, v: ii.done ? ii.total : ii.daysIn }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 8);
    var max = Math.max.apply(null, spans.map(function (x) { return x.v; }).concat([1]));
    h += '<section class="panel"><h2>Start to finish</h2>' + spans.map(function (x) {
      return '<a class="bar-row" href="#/j/' + esc(x.ii.j.id) + '" style="color:inherit"><div class="lab"><b>' + esc(x.ii.j.name) + '</b><span>' +
        plural(x.v, 'day') + (x.ii.done ? '' : ' so far') + '</span></div>' +
        '<div class="track"><div class="fill' + (x.ii.done ? '' : ' ongoing') + '" style="width:' + Math.max(3, Math.round(x.v / max * 100)) + '%"></div></div></a>';
    }).join('') + '</section>';
    h += outcomesPanel();

    var waits = gaps.filter(function (x) { return x.g > 0; }).map(function (x) { return { name: x.ii.j.name + ' · ' + x.from + ' → ' + x.to, v: x.g, ongoing: false, id: x.ii.j.id }; });
    all.forEach(function (ii) { if (!ii.done && ii.sinceLast > 0) waits.push({ name: ii.j.name + ' · after ' + ii.last.step, v: ii.sinceLast, ongoing: true, id: ii.j.id }); });
    waits.sort(function (a, b) { return b.v - a.v; });
    waits = waits.slice(0, 5);
    if (waits.length) {
      h += '<section class="panel"><h2>Longest waits</h2>' + waits.map(function (w, i) {
        return (i ? '<div class="divider"></div>' : '') + '<a class="wait-row" href="#/j/' + esc(w.id) + '" style="color:inherit"><div style="min-width:0"><div class="t">' + esc(w.name) + '</div>' +
          (w.ongoing ? '<div class="s">Still waiting</div>' : '') + '</div><span class="gap-pill' + (w.ongoing ? ' warn' : '') + '" style="margin:0;white-space:nowrap">' + plural(w.v, 'day') + '</span></a>';
      }).join('') + '</section>';
    }

    // Average days to reach each step, per type (only where a step name appears in 2+ journeys)
    var byType = {};
    all.forEach(function (ii) {
      ii.steps.forEach(function (s) {
        var k = (ii.j.type || 'Other') + '|' + s.step.trim().toLowerCase();
        (byType[k] = byType[k] || { type: ii.j.type || 'Other', step: s.step, vals: [] }).vals.push(days(ii.first.date, s.date));
      });
    });
    var typical = Object.keys(byType).map(function (k) { return byType[k]; }).filter(function (x) { return x.vals.length > 1; });
    if (typical.length) {
      typical.sort(function (a, b) { return a.type < b.type ? -1 : a.type > b.type ? 1 : avgOf(a.vals) - avgOf(b.vals); });
      h += '<section class="panel"><h2>Typical day you reach each step</h2>' + typical.map(function (x, i) {
        return (i ? '<div class="divider"></div>' : '') + '<div class="wait-row"><div class="t">' + esc(x.type) + ' · ' + esc(x.step) + '</div>' +
          '<span class="gap-pill" style="margin:0;white-space:nowrap">Day ' + Math.round(avgOf(x.vals)) + ' · ' + x.vals.length + ' times</span></div>';
      }).join('') + '</section>';
    }
    return h + '</main>';
  }
  function avgOf(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

  function settingsScreen() {
    var s = state.sync;
    var h = '<main class="screen"><div class="top"><h1>Settings</h1>' + syncPill() + '</div>';
    h += '<section class="panel"><h2>Google Sheet</h2>';
    if (!isDemo()) {
      h += '<p class="settings-help">Saving to your Google Sheet through your Journeys server. ' +
        (s.last ? 'Last synced ' + esc(s.last.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '. ' : '') +
        (state.outbox.length ? plural(state.outbox.length, 'change') + ' waiting to sync.' : 'Everything is saved.') + '</p>';
      if (s.error && (s.status === 'error' || s.status === 'offline')) h += '<p class="error-text" role="alert">' + esc(s.error) + '</p>';
      h += '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn secondary small" type="button" data-action="sync-now">' + icon('sync', 18) + 'Sync now</button>' +
        (cfg.sheetUrl ? '<a class="btn secondary small" href="' + esc(cfg.sheetUrl) + '" target="_blank" rel="noopener">Open my Sheet</a>' : '') + '</div>';
    } else {
      h += '<p class="settings-help">This copy of the app isn\'t running on your Journeys server, so it shows sample data that stays on this device. ' +
        'Open the app from your server\'s address instead (see the README) and it will save to your Google Sheet.</p>';
    }
    h += '</section>';
    var srv = state.server || {};
    if (!isDemo() && srv.ha && srv.ha.enabled) {
      h += '<section class="panel"><h2>Home Assistant</h2><p class="settings-help">Every day from ' + esc(String(srv.ha.nudgeHour)).replace(/^(\d)$/, '0$1') +
        ':00, your server checks for journeys waiting longer than usual and sends a nudge to your phone through Home Assistant.</p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn secondary small" type="button" data-action="ha-test">Send test notification</button>' +
        '<button class="btn secondary small" type="button" data-action="ha-check">Check now</button></div></section>';
    }
    if (!isDemo() && srv.mcp) {
      var mcpUrl = location.origin + location.pathname.replace(/[^/]*$/, '') + 'mcp';
      h += '<section class="panel"><h2>AI assistants (MCP)</h2><p class="settings-help">Claude and other MCP apps can read and update your journeys. Connect them to:</p>' +
        '<div style="display:flex;gap:8px;align-items:center"><code class="mcp-url" id="mcp-url">' + esc(mcpUrl) + '</code>' +
        '<button class="btn secondary small" type="button" data-action="copy-mcp" data-v="' + esc(mcpUrl) + '">Copy</button></div>' +
        '<p class="settings-help">' + (srv.authRequired ? 'Send your access token as <code>Authorization: Bearer …</code>.' : 'Set <code>APP_TOKEN</code> on the server first: these tools can also delete.') + ' Setup for each app is in the README.</p></section>';
    }
    var al = addonList();
    if (al.length) {
      h += '<section class="panel"><h2>Add-ons</h2>' + al.map(function (a) {
        var panel = a.enabled && addons[a.id] && addons[a.id].settingsPanel ? addons[a.id].settingsPanel() : '';
        return '<div class="toggle-row"><label for="addon-' + esc(a.id) + '" style="flex:1;min-width:0"><span class="t">' + esc(a.name) + '</span><span class="s">' + esc(a.description || '') + '</span></label>' +
          '<input type="checkbox" role="switch" class="switch" id="addon-' + esc(a.id) + '" data-addon-toggle="' + esc(a.id) + '"' + (a.enabled ? ' checked' : '') + '></div>' + panel;
      }).join('<div class="divider"></div>') + '</section>';
    }
    if (!isDemo()) {
      h += '<a class="row-card" href="#/server"><div style="min-width:0"><div class="t">Server settings</div>' +
        '<div class="s">Sheet, time zone, Home Assistant, nudge timing</div></div>' + icon('chevron', 20) + '</a>';
    }
    if (!isDemo() && (srv.authRequired || cfg.token || s.status === 'error')) {
      h += '<section class="panel"><h2>Access token</h2><p class="settings-help">Only needed if your server has <code>APP_TOKEN</code> set.</p>' +
        '<form id="cfg-form" style="display:flex;flex-direction:column;gap:14px" novalidate>' +
        '<div class="field"><label for="cfg-token">Token</label><input class="input" id="cfg-token" name="token" type="password" autocomplete="off" value="' + esc(cfg.token || '') + '"></div>' +
        '<p class="error-text" id="cfg-err" role="alert"></p>' +
        '<button class="btn small" type="submit" style="align-self:flex-start">Save token</button></form></section>';
    }
    if (isDemo()) {
      h += '<section class="panel"><h2>Sample data</h2><p class="settings-help">Start over with the example journeys, or clear them to try the app empty.</p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn secondary small" data-action="reset-demo">Reset sample data</button>' +
        '<button class="btn danger small" data-action="clear-demo">Clear all</button></div></section>';
    }
    h += '<p class="settings-help" style="text-align:center">Journeys v2.6</p></main>';
    return h;
  }

  // ---------- server settings (non-secret .env values, editable here) ----------
  function settingsCall(method, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    return fetch('api/settings', { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json(); }, function () { throw new Error("Can't reach your Journeys server."); })
      .then(function (j) { if (!j.ok) { var e = new Error(j.error); e.kind = j.kind; throw e; } return j.payload; });
  }
  function loadServerSettings() {
    state.serverSettings = { loading: true };
    settingsCall('GET').then(function (p) { state.serverSettings = p; }, function (e) { state.serverSettings = { error: e.message, kind: e.kind }; })
      .then(function () { if (route().name === 'server') render(); });
  }
  var TIME_ZONES = (function () {
    try { return Intl.supportedValuesOf('timeZone'); } catch (e) { return []; }
  })();
  function hourLabel(h) { return pad(h) + ':00'; }

  function serverScreen() {
    var h = '<main class="screen"><div class="top"><a class="icon-btn" href="#/settings" aria-label="Back to settings">' + icon('back', 20, 2.2) + '</a></div>' +
      '<div><h1 class="small">Server settings</h1><p class="settings-help" style="margin-top:6px">Saved on your Journeys server, for every device. Passwords and keys stay in the server\'s <code>.env</code>.</p></div>';
    if (isDemo()) return h + '<p class="settings-help">Open the app from your Journeys server to change its settings.</p></main>';
    var ss = state.serverSettings;
    if (!ss || ss.loading) { if (!ss) loadServerSettings(); return h + '<p class="settings-help">Loading…</p></main>'; }
    if (ss.error) {
      return h + '<p class="error-text" role="alert">' + esc(ss.error) + '</p>' +
        (ss.kind === 'auth' ? '<a class="btn secondary small" href="#/settings">Enter access token</a>' : '<button class="btn secondary small" data-action="reload-server-settings">Try again</button>') + '</main>';
    }
    var v = ss.values, env = ss.env, ov = ss.overridden || [], sec = ss.secrets || {};
    function note(k, envText) {
      if (ov.indexOf(k) >= 0) {
        return '<span class="field-note">Set here · .env says ' + esc(envText) + ' <button type="button" class="linkish" data-action="reset-setting" data-k="' + k + '">Use .env value</button></span>';
      }
      return '<span class="field-note">From .env</span>';
    }
    function show(x) { return x === '' || x == null ? 'nothing' : String(x); }
    var zones = TIME_ZONES.slice();
    if (v.timeZone && zones.indexOf(v.timeZone) < 0) zones.unshift(v.timeZone);
    var hours = [];
    for (var i = 0; i < 24; i++) hours.push(i);

    if (!ss.storage.writable) {
      h += '<div class="banner error" role="alert"><span>Changes here will reset when the server restarts: it has no writable data volume. See the README.</span></div>';
    }
    if (!sec.appToken) {
      h += '<div class="banner"><span>Anyone who can open this app can change these. To lock them, set <code>APP_TOKEN</code> in the server\'s .env.</span></div>';
    }

    h += '<form id="server-form" style="display:flex;flex-direction:column;gap:14px" novalidate>';
    h += '<section class="panel"><h2>Google Sheet</h2>' +
      '<div class="field"><label for="srv-sheet">Sheet ID or link</label><input class="input" id="srv-sheet" name="spreadsheetId" autocomplete="off" spellcheck="false" value="' + esc(v.spreadsheetId) + '" placeholder="https://docs.google.com/spreadsheets/d/…">' +
      note('spreadsheetId', show(env.spreadsheetId)) + '</div>' +
      '<p class="settings-help">Share the Sheet with ' + (sec.serviceAccountEmail ? '<code>' + esc(sec.serviceAccountEmail) + '</code>' : 'the service account') + ' as Editor first. The server checks it can open the Sheet before switching.</p>' +
      '<div class="field"><label for="srv-tz">Time zone</label>' +
      (zones.length
        ? '<select class="input" id="srv-tz" name="timeZone">' + (v.timeZone ? '' : '<option value="" selected>Not set (UTC)</option>') +
          zones.map(function (z) { return '<option value="' + esc(z) + '"' + (z === v.timeZone ? ' selected' : '') + '>' + esc(z.replace(/_/g, ' ')) + '</option>'; }).join('') + '</select>'
        : '<input class="input" id="srv-tz" name="timeZone" value="' + esc(v.timeZone) + '" placeholder="America/Chicago">') +
      note('timeZone', show(env.timeZone)) + '<span class="field-note">Sets what "today" means and when the daily check runs.</span></div>' +
      '</section>';

    h += '<section class="panel"><h2>Home Assistant</h2>' +
      (sec.haToken ? '' : '<p class="settings-help">Nudges also need <code>HA_TOKEN</code> in the server\'s .env. It\'s a password, so it can\'t be set here.</p>') +
      '<div class="field"><label for="srv-haurl">Home Assistant URL</label><input class="input" id="srv-haurl" name="haUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" value="' + esc(v.haUrl) + '" placeholder="http://192.168.1.10:8123">' +
      note('haUrl', show(env.haUrl)) + '</div>' +
      '<div class="field"><label for="srv-notify">Notify service</label><input class="input" id="srv-notify" name="haNotify" autocomplete="off" spellcheck="false" value="' + esc(v.haNotify) + '" placeholder="mobile_app_pixel_8">' +
      note('haNotify', show(env.haNotify)) + '<span class="field-note">Several phones: separate with commas.</span></div>' +
      '</section>';

    h += '<section class="panel"><h2>Nudges</h2>' +
      '<div class="field"><label for="srv-hour">Daily check</label><select class="input" id="srv-hour" name="nudgeHour">' +
      hours.map(function (x) { return '<option value="' + x + '"' + (x === v.nudgeHour ? ' selected' : '') + '>' + hourLabel(x) + '</option>'; }).join('') + '</select>' +
      note('nudgeHour', hourLabel(env.nudgeHour)) + '</div>' +
      '<div class="field"><label for="srv-after">Nudge after (days on one step)</label><input class="input" id="srv-after" name="nudgeAfterDays" type="number" inputmode="numeric" min="1" max="365" step="1" value="' + esc(v.nudgeAfterDays) + '">' +
      note('nudgeAfterDays', show(env.nudgeAfterDays)) + '<span class="field-note">Used until your history shows what\'s usual for that step.</span></div>' +
      '<div class="field"><label for="srv-repeat">Ask again after (days)</label><input class="input" id="srv-repeat" name="nudgeRepeatDays" type="number" inputmode="numeric" min="1" max="365" step="1" value="' + esc(v.nudgeRepeatDays) + '">' +
      note('nudgeRepeatDays', show(env.nudgeRepeatDays)) + '<span class="field-note">Also how long "Still waiting" snoozes.</span></div>' +
      '</section>';

    h += '<p class="error-text" id="srv-err" role="alert"></p><button class="btn" type="submit" style="flex:none">Save</button></form>';

    h += '<section class="panel"><h2>Set in .env only</h2>' +
      '<div class="wait-row"><span class="t">Google JSON key</span><span class="s" style="color:' + (sec.serviceAccountEmail ? 'var(--muted)' : 'var(--danger)') + '">' + (sec.serviceAccountEmail ? 'Loaded' : 'Problem') + '</span></div>' +
      (sec.keyProblem ? '<p class="error-text">' + esc(sec.keyProblem) + '</p>' : '') +
      '<div class="divider"></div><div class="wait-row"><span class="t">Home Assistant token</span><span class="s" style="color:var(--muted)">' + (sec.haToken ? 'Set' : 'Not set') + '</span></div>' +
      '<div class="divider"></div><div class="wait-row"><span class="t">App token</span><span class="s" style="color:var(--muted)">' + (sec.appToken ? 'On' : 'Off') + '</span></div>' +
      '</section>';
    return h + '</main>';
  }

  function afterServerSave(p, sheetChanged) {
    state.serverSettings = p;
    probe().then(function () {
      if (sheetChanged) { state.data = { journeys: [], steps: [] }; saveData(); }
      render();
      sync();
    });
  }

  // ---------- shared bits for the new screens ----------
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function outcomeBadge(id, big) {
    var o = outcomeOf(id);
    return o ? '<span class="outcome-badge ' + o.cls + (big ? ' big' : '') + '">' + esc(o.label) + '</span>' : '';
  }
  function journeyById(id) { return state.data.journeys.find(function (x) { return x.id === id; }); }
  function typeWord(type) { return !type || type === 'Other' ? 'journey' : type.toLowerCase(); }
  function mostCommonFirstStep(list) {
    var c = {};
    list.forEach(function (ii) { var n = ii.steps[0].step; c[n] = (c[n] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0] || 'the start';
  }

  // ---------- search ----------
  function recentSearches() { var r = load(LS.recent, []); return Array.isArray(r) ? r : []; }
  function rememberSearch(q) {
    q = (q || '').trim();
    if (!q) return;
    var r = recentSearches().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
    r.unshift(q);
    store(LS.recent, r.slice(0, 6));
  }
  function searchScreen() {
    var q = state.search.q;
    return '<main class="screen"><form id="search-form" class="search-bar" role="search" novalidate>' +
      '<a class="icon-btn" href="#/" aria-label="Back to journeys">' + icon('back', 20, 2.2) + '</a>' +
      '<div class="search-field">' + icon('search', 18) +
      '<label for="search-q" class="sr-only">Search journeys, steps and notes</label>' +
      '<input id="search-q" class="input" type="search" name="q" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="Journeys, steps, notes" value="' + esc(q) + '">' +
      '<button type="button" class="search-clear" data-action="search-clear" aria-label="Clear search">' + icon('close', 14, 2.6) + '</button></div></form>' +
      '<div id="search-results" aria-live="polite">' + searchResultsHtml(q) + '</div></main>';
  }
  function searchResultsHtml(q) {
    var t = (q || '').trim();
    if (!t) {
      var rec = recentSearches();
      if (!rec.length) return '<p class="settings-help" style="padding:4px 2px">Search journey names, step names and notes, e.g. a company, a person or a word you wrote down.</p>';
      return '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center">Recent searches' +
        '<button type="button" class="linkish" data-action="search-clear-recent">Clear</button></div>' +
        '<div class="chips">' + rec.map(function (r) { return '<button type="button" class="chip" data-action="search-recent" data-v="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>';
    }
    var lq = t.toLowerCase();
    function hl(text) {
      text = String(text || '');
      var i = text.toLowerCase().indexOf(lq);
      return i < 0 ? null : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + t.length)) + '</mark>' + esc(text.slice(i + t.length));
    }
    function snippet(text) {
      var i = text.toLowerCase().indexOf(lq);
      if (i < 0) return null;
      var start = Math.max(0, i - 24), end = Math.min(text.length, i + t.length + 32);
      return (start ? '…' : '') + esc(text.slice(start, i)) + '<mark>' + esc(text.slice(i, i + t.length)) + '</mark>' + esc(text.slice(i + t.length, end)) + (end < text.length ? '…' : '');
    }
    var infos = {};
    state.data.journeys.forEach(function (j) { infos[j.id] = info(j); });
    var js = [], ss = [], ns = [];
    state.data.journeys.forEach(function (j) {
      var m = hl(j.name);
      if (!m) return;
      var ii = infos[j.id];
      js.push({ j: j, html: m, sub: esc(j.type || 'Other') + ' · ' + (ii.done ? plural(ii.total, 'day') + (j.outcome ? ' · ' + esc(outcomeOf(j.outcome).label) : '') : (ii.last ? 'Day ' + ii.daysIn + ' · ' + esc(ii.last.step) : 'No steps yet')), done: ii.done });
    });
    state.data.steps.forEach(function (s) {
      var j = infos[s.journeyId];
      if (!j) return;
      var day = j.first ? days(j.first.date, s.date) : 0;
      var m = hl(s.step);
      if (m) ss.push({ s: s, j: j.j, html: m, day: day });
      var n = s.notes ? snippet(s.notes) : null;
      if (n) ns.push({ s: s, j: j.j, html: n });
    });
    ss.sort(function (a, b) { return a.s.date < b.s.date ? 1 : -1; });
    ns.sort(function (a, b) { return a.s.date < b.s.date ? 1 : -1; });
    var total = js.length + ss.length + ns.length;
    if (!total) return '<div class="empty"><h2>No matches</h2><p>Nothing in your journeys, steps or notes mentions “' + esc(t) + '”.</p></div>';
    function open(j, inner, cls) { return '<a class="' + cls + '" href="#/j/' + esc(j.id) + '" data-action="search-open" data-href="#/j/' + esc(j.id) + '">' + inner + '</a>'; }
    var h = '<p class="muted-sm" style="margin:0 2px">' + plural(total, 'match').replace('matchs', 'matches') + '</p>';
    if (js.length) {
      h += '<div class="section-label">Journeys</div>' + js.map(function (x) {
        return open(x.j, '<div style="min-width:0"><div class="t">' + x.html + '</div><div class="s">' + x.sub + '</div></div>' +
          '<span class="pill ' + (x.done ? 'pill-muted' : 'pill-accent') + '">' + (x.done ? 'Done' : 'Active') + '</span>', 'row-card');
      }).join('');
    }
    if (ss.length) {
      h += '<div class="section-label">Steps</div><div class="result-list">' + ss.slice(0, 40).map(function (x) {
        return open(x.j, '<span class="dot-sm"></span><span class="rl-body"><span class="rl-row"><span class="t">' + x.html + '</span><span class="s">' + esc(fmt(x.s.date)) + '</span></span>' +
          '<span class="s">' + esc(x.j.name) + ' · Day ' + x.day + '</span></span>', 'result-row');
      }).join('') + '</div>';
    }
    if (ns.length) {
      h += '<div class="section-label">Notes</div><div class="result-list">' + ns.slice(0, 40).map(function (x) {
        return open(x.j, '<span class="rl-body"><span class="note-text">“' + x.html + '”</span><span class="s">' + esc(x.j.name) + ' · ' + esc(x.s.step) + ' · ' + esc(fmt(x.s.date)) + '</span></span>', 'result-row');
      }).join('') + '</div>';
    }
    return h;
  }

  // ---------- insights: tabs, outcomes ----------
  function insightsTabs(cur) {
    var tabs = [['insights', '#/insights', 'Overview'], ['calendar', '#/insights/calendar', 'Calendar'], ['year', '#/insights/year', 'Year']];
    return '<nav class="seg" aria-label="Insights views">' + tabs.map(function (x) {
      return x[0] === cur ? '<span class="seg-item" aria-current="page">' + x[2] + '</span>' : '<a class="seg-item" href="' + x[1] + '">' + x[2] + '</a>';
    }).join('') + '</nav>';
  }

  function outcomePatterns(type, list) {
    var res = [];
    var start = mostCommonFirstStep(list);
    OUTCOMES.forEach(function (o) {
      if (o.id === 'other') return;
      var xs = list.filter(function (ii) { return ii.j.outcome === o.id; }).map(function (ii) { return ii.total; }).sort(function (a, b) { return a - b; });
      if (xs.length < 2) return;
      var med = Math.round(median(xs));
      var within = xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.75) - 1)];
      var k = xs.filter(function (x) { return x <= within; }).length;
      if (o.id === 'rejected') res.push({ cls: o.cls, title: 'Rejections usually come within ' + plural(within, 'day'), sub: 'Typically ' + plural(med, 'day') + ' after ' + start + ' · ' + k + ' of ' + xs.length + ' rejections' });
      if (o.id === 'got') res.push({ cls: o.cls, title: 'Getting it takes about ' + plural(med, 'day'), sub: 'Typical time from ' + start + ' to the end · ' + xs.length + ' times' });
      if (o.id === 'withdrew') res.push({ cls: o.cls, title: 'You usually stepped away after about ' + plural(med, 'day'), sub: xs.length + ' times' });
    });
    // Which middle step most separates "got it" from the rest?
    var got = list.filter(function (ii) { return ii.j.outcome === 'got'; }).length;
    if (list.length >= 4 && got > 0 && got < list.length) {
      var names = {};
      list.forEach(function (ii) { ii.steps.slice(1, -1).forEach(function (s) { names[s.step.trim().toLowerCase()] = s.step.trim(); }); });
      var best = null;
      Object.keys(names).forEach(function (k) {
        var has = function (ii) { return ii.steps.slice(1, -1).some(function (s) { return s.step.trim().toLowerCase() === k; }); };
        var w = list.filter(has), wo = list.filter(function (ii) { return !has(ii); });
        if (w.length < 2 || !wo.length) return;
        var a = w.filter(function (ii) { return ii.j.outcome === 'got'; }).length, c = wo.filter(function (ii) { return ii.j.outcome === 'got'; }).length;
        var diff = a / w.length - c / wo.length;
        if (diff >= 0.3 && (!best || diff > best.diff)) best = { diff: diff, name: names[k], a: a, b: w.length, c: c, d: wo.length };
      });
      if (best) res.push({ cls: 'accent', title: 'Reaching ' + best.name + ' matters most', sub: best.a + ' of ' + best.b + ' with ' + best.name + ' ended in Got it, ' + best.c + ' of ' + best.d + ' without' });
    }
    return res;
  }

  function outcomesPanel() {
    var decided = allInfo().filter(function (ii) { return ii.done && ii.j.outcome && ii.steps.length; });
    if (!decided.length) return '';
    var byType = {};
    decided.forEach(function (ii) { var t = ii.j.type || 'Other'; (byType[t] = byType[t] || []).push(ii); });
    return Object.keys(byType).sort(function (a, b) { return byType[b].length - byType[a].length; }).map(function (type) {
      var list = byType[type], counts = {};
      list.forEach(function (ii) { counts[ii.j.outcome] = (counts[ii.j.outcome] || 0) + 1; });
      var present = OUTCOMES.filter(function (o) { return counts[o.id]; });
      var pats = outcomePatterns(type, list);
      return '<section class="panel"><div class="panel-head"><h2>' + esc(type === 'Other' ? 'Other' : type) + ' outcomes</h2><span class="muted-sm">All time · ' + list.length + ' decided</span></div>' +
        '<div class="outcome-bar" role="img" aria-label="' + esc(present.map(function (o) { return o.label + ' ' + counts[o.id]; }).join(', ')) + '">' +
        present.map(function (o) { return '<span class="ob ' + o.cls + '" style="flex:' + counts[o.id] + '"></span>'; }).join('') + '</div>' +
        '<div class="outcome-legend">' + present.map(function (o) { return '<span><i class="ob ' + o.cls + '"></i><b>' + counts[o.id] + '</b> ' + esc(o.label) + '</span>'; }).join('') + '</div>' +
        (pats.length ? '<div class="divider"></div>' + pats.map(function (p, i) {
          return (i ? '<div class="divider"></div>' : '') + '<div class="pattern"><i class="ob ' + p.cls + '"></i><div><div class="t">' + esc(p.title) + '</div><div class="s">' + esc(p.sub) + '</div></div></div>';
        }).join('') : '<p class="settings-help">Patterns show up once a few journeys end the same way.</p>') +
        '</section>';
    }).join('');
  }

  // A line for the finish sheet: what this outcome usually looks like for this kind of journey.
  function outcomeHint(j, outcomeId) {
    var ii = info(j), o = outcomeOf(outcomeId);
    var here = ii.first ? 'This one is at Day ' + days(ii.first.date, today()) + '. ' : '';
    if (!o) return here + 'Pick how it ended. It helps Insights spot patterns.';
    var xs = allInfo().filter(function (x) { return x.j.id !== j.id && x.done && x.j.outcome === o.id && (x.j.type || 'Other') === (j.type || 'Other') && x.steps.length; })
      .map(function (x) { return x.total; }).sort(function (a, b) { return a - b; });
    var w = typeWord(j.type);
    if (xs.length >= 2) {
      var med = Math.round(median(xs)), within = xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.75) - 1)];
      if (o.id === 'rejected') return here + 'Your ' + w + ' rejections usually come within ' + plural(within, 'day') + '.';
      if (o.id === 'got') return here + 'Your ' + w + ' journeys that worked out took about ' + plural(med, 'day') + '.';
      if (o.id === 'withdrew') return here + 'You usually stepped away after about ' + plural(med, 'day') + '.';
      return here + plural(xs.length, 'other ' + w) + ' ended this way.';
    }
    if (xs.length === 1) return here + 'Your other ' + w + ' that ended this way took ' + plural(xs[0], 'day') + '.';
    return here + 'Outcomes help Insights spot patterns as you finish more journeys.';
  }

  // ---------- calendar ----------
  function calendarScreen() {
    var now = today();
    if (!state.cal) state.cal = { y: +now.slice(0, 4), m: +now.slice(5, 7) - 1, sel: now };
    var c = state.cal;
    var monthKey = c.y + '-' + pad(c.m + 1);
    var byDay = {}, inMonth = {};
    state.data.steps.forEach(function (s) {
      if (!validIso(s.date) || s.date.slice(0, 7) !== monthKey || !journeyById(s.journeyId)) return;
      (byDay[s.date] = byDay[s.date] || []).push(s);
      if (!inMonth[s.journeyId] || s.date < inMonth[s.journeyId]) inMonth[s.journeyId] = s.date;
    });
    // Colors go to this month's journeys, in order of their first step this month, so they stay distinct.
    var colors = {};
    Object.keys(inMonth).sort(function (a, b) { return inMonth[a] < inMonth[b] ? -1 : inMonth[a] > inMonth[b] ? 1 : 0; })
      .forEach(function (id, i) { colors[id] = JOURNEY_COLORS[i % JOURNEY_COLORS.length]; });
    var firstDow = new Date(c.y, c.m, 1).getDay(), n = new Date(c.y, c.m + 1, 0).getDate();
    var cells = '';
    for (var b = 0; b < firstDow; b++) cells += '<span></span>';
    for (var d = 1; d <= n; d++) {
      var iso = monthKey + '-' + pad(d), evs = byDay[iso] || [];
      var ids = [];
      evs.forEach(function (s) { if (ids.indexOf(s.journeyId) < 0) ids.push(s.journeyId); });
      var label = MONTHS_LONG[c.m] + ' ' + d + (evs.length ? ', ' + plural(evs.length, 'step') : '') + (iso === now ? ', today' : '');
      cells += '<button type="button" class="cal-day' + (iso === c.sel ? ' sel' : '') + (iso === now ? ' today' : '') + '" data-action="cal-day" data-v="' + iso + '" aria-label="' + esc(label) + '"' + (iso === c.sel ? ' aria-pressed="true"' : '') + '>' +
        '<span>' + d + '</span><span class="cal-dots">' + ids.slice(0, 3).map(function (id) { return '<i style="background:' + colors[id] + '"></i>'; }).join('') + '</span></button>';
    }
    var legend = Object.keys(colors).map(function (id) { var j = journeyById(id); return '<span><i style="background:' + colors[id] + '"></i>' + esc(j.name) + '</span>'; }).join('');
    var isThisMonth = monthKey === now.slice(0, 7);

    var h = '<main class="screen"><div class="top"><h1>Insights</h1>' + syncPill() + '</div>' + insightsTabs('calendar') +
      '<section class="panel cal">' +
      '<div class="cal-head"><button type="button" class="icon-btn soft" data-action="cal-nav" data-v="-1" aria-label="Previous month">' + icon('back', 18, 2.4) + '</button>' +
      '<div class="cal-title">' + MONTHS_LONG[c.m] + ' ' + c.y + '</div>' +
      '<button type="button" class="icon-btn soft" data-action="cal-nav" data-v="1" aria-label="Next month">' + icon('chevron', 18, 2.4) + '</button></div>' +
      '<div class="cal-grid cal-dow" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>' +
      '<div class="cal-grid">' + cells + '</div>' +
      (legend ? '<div class="cal-legend">' + legend + '</div>' : '<p class="settings-help" style="text-align:center">No steps in ' + MONTHS_LONG[c.m] + '.</p>') +
      (!isThisMonth ? '<button type="button" class="linkish" style="align-self:center" data-action="cal-today">Back to today</button>' : '') +
      '</section>';

    var selEvs = (byDay[c.sel] || []).slice();
    var sd = new Date(+c.sel.slice(0, 4), +c.sel.slice(5, 7) - 1, +c.sel.slice(8, 10));
    h += '<div class="section-label">' + WEEKDAYS[sd.getDay()] + ', ' + MONTHS_LONG[sd.getMonth()] + ' ' + sd.getDate() + (c.sel === now ? ' · Today' : '') + '</div>';
    if (!selEvs.length) {
      h += '<div class="row-card"><span class="s" style="font-size:14px">No steps on this day.</span></div>';
    } else {
      h += '<div class="result-list">' + selEvs.map(function (s) {
        var j = journeyById(s.journeyId), st = stepsOf(j.id), i = st.indexOf(s), prev = i > 0 ? st[i - 1] : null;
        var detail = 'Day ' + days(st[0].date, s.date) + (prev ? ' · ' + (days(prev.date, s.date) === 0 ? 'same day as ' + prev.step : plural(days(prev.date, s.date), 'day') + ' after ' + prev.step) : '');
        return '<a class="result-row" href="#/j/' + esc(j.id) + '"><span class="dot-sm" style="background:' + colors[j.id] + '"></span><span class="rl-body">' +
          '<span class="t">' + esc(s.step) + '</span><span class="s">' + esc(j.name) + ' · ' + esc(detail) + '</span></span></a>';
      }).join('') + '</div>';
    }
    return h + '</main>';
  }

  // ---------- year in review ----------
  function yearStats(y) {
    var ys = String(y);
    var all = allInfo().filter(function (ii) { return ii.steps.length; });
    var finished = all.filter(function (ii) { return ii.done && ii.last.date.slice(0, 4) === ys; });
    var steps = state.data.steps.filter(function (s) { return validIso(s.date) && s.date.slice(0, 4) === ys && journeyById(s.journeyId); });
    var gaps = [];
    all.forEach(function (ii) {
      ii.steps.forEach(function (s, i) {
        if (i && s.date.slice(0, 4) === ys) gaps.push({ ii: ii, g: days(ii.steps[i - 1].date, s.date), from: ii.steps[i - 1].step, to: s.step });
      });
    });
    var months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    steps.forEach(function (s) { months[+s.date.slice(5, 7) - 1]++; });
    var byTotal = finished.slice().sort(function (a, b) { return a.total - b.total; });
    var byType = {};
    finished.forEach(function (ii) { var t = ii.j.type || 'Other'; (byType[t] = byType[t] || []).push(ii.total); });
    var outcomes = {};
    finished.forEach(function (ii) { if (ii.j.outcome) outcomes[ii.j.outcome] = (outcomes[ii.j.outcome] || 0) + 1; });
    var longestGap = gaps.slice().sort(function (a, b) { return b.g - a.g; })[0] || null;
    return {
      y: y, finished: finished, steps: steps.length, months: months,
      avg: gaps.length ? Math.round(gaps.reduce(function (a, x) { return a + x.g; }, 0) / gaps.length * 10) / 10 : null,
      fastest: byTotal[0] || null, longest: byTotal.length > 1 ? byTotal[byTotal.length - 1] : null,
      types: Object.keys(byType).map(function (t) { return { type: t, n: byType[t].length, avg: Math.round(byType[t].reduce(function (a, b) { return a + b; }, 0) / byType[t].length) }; })
        .sort(function (a, b) { return b.n - a.n || b.avg - a.avg; }).slice(0, 4),
      outcomes: outcomes, longestGap: longestGap && longestGap.g > 0 ? longestGap : null
    };
  }
  function yearsWithData() {
    var ys = {};
    ys[+today().slice(0, 4)] = true;
    state.data.steps.forEach(function (s) { if (validIso(s.date)) ys[+s.date.slice(0, 4)] = true; });
    return Object.keys(ys).map(Number).sort();
  }
  function yearScreen() {
    var cur = +today().slice(0, 4), years = yearsWithData();
    if (!state.year) state.year = cur;
    var y = state.year, st = yearStats(y);
    var canPrev = years[0] < y, canNext = y < years[years.length - 1];
    var h = '<main class="screen"><div class="top"><h1>Insights</h1>' + syncPill() + '</div>' + insightsTabs('year');
    var curMonth = y === cur ? +today().slice(5, 7) - 1 : 11;
    var maxM = Math.max.apply(null, st.months.concat([1]));
    h += '<section class="year-hero">' +
      '<div class="yh-head"><button type="button" class="yh-nav" data-action="year-nav" data-v="-1" aria-label="Previous year"' + (canPrev ? '' : ' disabled') + '>' + icon('back', 16, 2.6) + '</button>' +
      '<h2>' + y + (y === cur ? ' so far' : '') + '</h2>' +
      '<button type="button" class="yh-nav" data-action="year-nav" data-v="1" aria-label="Next year"' + (canNext ? '' : ' disabled') + '>' + icon('chevron', 16, 2.6) + '</button>' +
      '<span style="flex:1"></span>' +
      (st.steps ? '<button type="button" class="yh-share" data-action="share-year">' + icon('share', 16) + 'Share</button>' : '') + '</div>' +
      '<div class="yh-stats"><div><b>' + st.finished.length + '</b><span>' + (st.finished.length === 1 ? 'journey finished' : 'journeys finished') + '</span></div>' +
      '<div><b>' + st.steps + '</b><span>steps logged</span></div>' +
      '<div><b>' + (st.avg == null ? '–' : st.avg) + '</b><span>days between steps</span></div></div>' +
      '<div class="yh-months" role="img" aria-label="Steps per month: ' + esc(st.months.map(function (n, i) { return MONTHS[i] + ' ' + n; }).join(', ')) + '">' +
      st.months.map(function (n, i) {
        var future = i > curMonth;
        return '<div class="yh-col"><span class="yh-bar' + (future ? ' future' : n ? '' : ' zero') + '" style="height:' + (n ? Math.max(8, Math.round(n / maxM * 100)) : 4) + '%"></span><span class="yh-m">' + MONTHS[i].charAt(0) + '</span></div>';
      }).join('') + '</div></section>';

    if (!st.steps) return h + '<div class="empty"><p>Nothing logged in ' + y + '.</p></div></main>';

    if (st.fastest) {
      h += '<div class="tiles">' +
        '<a class="tile" href="#/j/' + esc(st.fastest.j.id) + '" style="color:inherit"><span>Fastest</span><b style="font-size:22px">' + plural(st.fastest.total, 'day') + '</b><span style="color:var(--ink-2)">' + esc(st.fastest.j.name) + '</span></a>' +
        (st.longest ? '<a class="tile" href="#/j/' + esc(st.longest.j.id) + '" style="color:inherit"><span>Longest</span><b style="font-size:22px">' + plural(st.longest.total, 'day') + '</b><span style="color:var(--ink-2)">' + esc(st.longest.j.name) + '</span></a>' : '') +
        '</div>';
    }
    if (st.types.length) {
      var maxT = Math.max.apply(null, st.types.map(function (t) { return t.avg; }).concat([1]));
      h += '<section class="panel"><h2>Average start to finish</h2>' + st.types.map(function (t) {
        return '<div class="bar-row"><div class="lab"><b>' + esc(t.type) + ' · ' + t.n + ' finished</b><span>' + plural(t.avg, 'day') + '</span></div>' +
          '<div class="track"><div class="fill" style="width:' + Math.max(4, Math.round(t.avg / maxT * 100)) + '%"></div></div></div>';
      }).join('') + '</section>';
    }
    var oc = OUTCOMES.filter(function (o) { return st.outcomes[o.id]; });
    if (oc.length) {
      h += '<section class="panel"><h2>How they ended</h2><div class="outcome-legend">' + oc.map(function (o) {
        return '<span><i class="ob ' + o.cls + '"></i><b>' + st.outcomes[o.id] + '</b> ' + esc(o.label) + '</span>';
      }).join('') + '</div></section>';
    }
    if (st.longestGap) {
      h += '<a class="hint warn" href="#/j/' + esc(st.longestGap.ii.j.id) + '" style="text-decoration:none">' + icon('clock', 18) +
        '<span><b>Longest single wait: ' + plural(st.longestGap.g, 'day') + '</b><br>' + esc(st.longestGap.ii.j.name + ', ' + st.longestGap.from + ' → ' + st.longestGap.to) + '</span></a>';
    }
    return h + '</main>';
  }

  // ---------- finish sheet (outcome) ----------
  function openFinishSheet(jid, opts) {
    opts = opts || {};
    var j = journeyById(jid);
    state.sheet = {
      kind: 'finish', jid: jid, outcomeOnly: !!opts.outcomeOnly,
      outcome: opts.outcomeOnly ? (j.outcome || '') : '',
      step: opts.step || '', stepTouched: !!opts.step, date: opts.date || today(), notes: opts.notes || ''
    };
    state.menu = false;
    render();
  }
  function finishSheetHtml(sh, j) {
    var ii = info(j);
    return '<div class="scrim" data-action="scrim"><form class="sheet" id="finish-form" role="dialog" aria-modal="true" aria-labelledby="fin-title" novalidate>' +
      '<div class="grab" aria-hidden="true"></div>' +
      '<div class="top"><div><div class="eyebrow">' + esc(j.name) + (ii.first ? ' · Day ' + ii.daysIn : '') + '</div><h1 class="small" id="fin-title" style="font-size:24px">How did it end?</h1></div>' +
      '<button type="button" class="icon-btn soft" data-action="close-sheet" aria-label="Close">' + icon('close', 18, 2.4) + '</button></div>' +
      '<div class="outcome-grid" role="group" aria-label="Outcome">' + OUTCOMES.map(function (o) {
        return '<button type="button" class="outcome-opt" data-action="pick-outcome" data-v="' + o.id + '" aria-pressed="' + (sh.outcome === o.id) + '">' +
          '<span class="oi ' + o.cls + '">' + icon(o.icon, 18, 2.6) + '</span><span><span class="t">' + esc(o.label) + '</span><span class="s">' + esc(o.hint) + '</span></span></button>';
      }).join('') + '</div>' +
      (sh.outcomeOnly ? '' :
        '<div class="field"><label for="fin-step">Last step</label><input class="input" id="fin-step" name="step" autocomplete="off" value="' + esc(sh.step) + '" placeholder="e.g. ' + esc(finalStepFor('got', j.type)) + '"></div>' +
        dateField('fin-date', sh.date) +
        '<div class="field"><label for="fin-notes">What happened? <span class="opt">(optional)</span></label><textarea class="input" id="fin-notes" name="notes" rows="2">' + esc(sh.notes) + '</textarea></div>') +
      '<div class="hint" id="fin-hint">' + icon('chart', 18) + '<span>' + esc(outcomeHint(j, sh.outcome)) + '</span></div>' +
      '<p class="error-text" id="fin-err" role="alert"></p>' +
      '<div style="display:flex;gap:10px">' +
      (sh.outcomeOnly && j.outcome ? '<button type="button" class="btn secondary" style="flex:none;padding:0 18px" data-action="clear-outcome">Clear</button>' : '') +
      '<button class="btn" type="submit">' + (sh.outcomeOnly ? 'Save outcome' : 'Finish journey') + '</button></div>' +
      '</form></div>';
  }
  function readFinishForm() {
    var f = document.getElementById('finish-form');
    if (!f || !state.sheet || state.sheet.kind !== 'finish') return;
    if (f.step) state.sheet.step = f.step.value;
    if (f.date) state.sheet.date = f.date.value;
    if (f.notes) state.sheet.notes = f.notes.value;
  }

  // ---------- share as image ----------
  function openShareSheet(what, id) {
    state.sheet = { kind: 'share', what: what, jid: what === 'journey' ? id : null, year: what === 'year' ? id : null, showDates: true, dark: false, url: null, blob: null };
    state.menu = false;
    render();
    buildShareImage();
  }
  function canShareFiles() {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })); } catch (e) { return false; }
  }
  function shareSheetHtml(sh) {
    var title = sh.what === 'journey' ? journeyById(sh.jid).name : (sh.year + ' in review');
    return '<div class="scrim" data-action="scrim"><div class="sheet" id="share-sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title">' +
      '<div class="grab" aria-hidden="true"></div>' +
      '<div class="top"><div><div class="eyebrow">' + esc(title) + '</div><h1 class="small" id="sh-title" style="font-size:24px">Share as an image</h1></div>' +
      '<button type="button" class="icon-btn soft" data-action="close-sheet" aria-label="Close">' + icon('close', 18, 2.4) + '</button></div>' +
      '<div class="share-preview">' + (sh.url ? '<img id="share-img" src="' + sh.url + '" alt="Preview of the image to share">' : '<span class="settings-help">Preparing image…</span>') + '</div>' +
      (sh.what === 'journey' ? '<label class="toggle-row" for="sh-dates"><span class="t">Show dates</span><input type="checkbox" id="sh-dates" data-share-opt="showDates"' + (sh.showDates ? ' checked' : '') + '></label>' : '') +
      '<label class="toggle-row" for="sh-dark"><span class="t">Dark card</span><input type="checkbox" id="sh-dark" data-share-opt="dark"' + (sh.dark ? ' checked' : '') + '></label>' +
      '<div style="display:flex;gap:10px"><button type="button" class="btn secondary" data-action="share-save">' + icon('download', 18) + 'Save image</button>' +
      (canShareFiles() ? '<button type="button" class="btn" data-action="share-send">' + icon('share', 18) + 'Share…</button>' : '') + '</div>' +
      '</div></div>';
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'journey'; }

  function journeyCardSpec(jid, showDates) {
    var j = journeyById(jid), ii = info(j), t = typeOf(j.type);
    var segs = ii.gaps.map(function (g) { return { v: g }; });
    if (!ii.done && ii.sinceLast > 0) segs.push({ v: ii.sinceLast, ongoing: true });
    var o = outcomeOf(j.outcome);
    return {
      kicker: t.id, title: j.name,
      subtitle: ii.done
        ? [{ t: ii.first.step + ' → ' + ii.last.step + ' in ' }, { t: plural(ii.total, 'day'), strong: true }]
        : [{ t: 'Day ' + ii.daysIn + ' · now: ' }, { t: ii.last ? ii.last.step : '—', strong: true }],
      badge: ii.done && o ? { text: o.label, cls: o.cls } : null,
      bars: segs.length ? segs : [{ v: 1 }],
      range: showDates && ii.first ? [fmt(ii.first.date, true), ii.done ? fmt(ii.last.date, true) : 'Today'] : null,
      items: ii.steps.map(function (s) { return { top: 'Day ' + days(ii.first.date, s.date), main: s.step, bottom: showDates ? fmt(s.date, true) : '' }; }),
      footLeft: ii.longest ? 'Longest wait: ' + plural(ii.longest, 'day') : '',
      file: slug(j.name) + '-timeline.png', shareTitle: j.name
    };
  }
  function yearCardSpec(y) {
    var st = yearStats(y), cur = +today().slice(0, 4);
    var items = [];
    if (st.fastest) items.push({ top: 'Fastest', main: st.fastest.j.name, bottom: plural(st.fastest.total, 'day') });
    if (st.longest) items.push({ top: 'Longest', main: st.longest.j.name, bottom: plural(st.longest.total, 'day') });
    return {
      kicker: 'Year in review', title: y + (y === cur ? ' so far' : ''),
      subtitle: [{ t: plural(st.finished.length, 'journey') + ' finished · ' }, { t: plural(st.steps, 'step'), strong: true }, { t: ' logged' }],
      stats: [{ v: String(st.finished.length), l: 'finished' }, { v: String(st.steps), l: 'steps' }, { v: st.avg == null ? '–' : String(st.avg), l: 'days between steps' }],
      months: st.months, items: items,
      footLeft: st.longestGap ? 'Longest wait: ' + plural(st.longestGap.g, 'day') : '',
      file: 'journeys-' + y + '.png', shareTitle: 'My ' + y + ' in journeys'
    };
  }

  // Draws a share card on a canvas. Two passes: measure the height, then draw.
  function drawCard(spec, dark) {
    var W = 1080, P = 84, IW = W - 2 * P;
    var C = dark
      ? { bg: '#0E1320', fg: '#E9EDF5', muted: '#A3ADC2', accent: '#7B9CFF', panel: '#171E2E', ramp: ['#7B9CFF', '#5C7FE6', '#4566C8', '#344F9E'], ink: ['#0E1320', '#0E1320', '#FFFFFF', '#FFFFFF'], warn: '#F4A261' }
      : { bg: '#EEF2FD', fg: '#16213A', muted: '#4A5570', accent: '#1F47C2', panel: '#FFFFFF', ramp: ['#2451D6', '#4A70E0', '#7E98EA', '#B3C4F3'], ink: ['#FFFFFF', '#FFFFFF', '#16213A', '#16213A'], warn: '#E8833A' };
    var BADGE = { got: ['#E3F4EA', '#17663A'], rejected: ['#FDECEA', '#A3271B'], withdrew: ['#FFF1E6', '#8A3D08'], other: ['#EEF1F5', '#3A4560'] };
    var F = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    function font(w, px) { ctx.font = w + ' ' + px + 'px ' + F; }
    function fit(text, maxW) {
      if (ctx.measureText(text).width <= maxW) return text;
      while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
      return text + '…';
    }
    function wrap(text, maxW, maxLines) {
      var words = String(text).split(/\s+/), lines = [], line = '';
      words.forEach(function (w) {
        var tryLine = line ? line + ' ' + w : w;
        if (ctx.measureText(tryLine).width <= maxW || !line) line = tryLine; else { lines.push(line); line = w; }
      });
      if (line) lines.push(line);
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = fit(lines[maxLines - 1] + '…', maxW); }
      return lines;
    }
    function rr(x, y, w, h, r, fill) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
    function layout(draw) {
      var y = P;
      if (draw) { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, canvas.height); }
      font('800', 30); ctx.textBaseline = 'top';
      if (draw) { ctx.fillStyle = C.accent; ctx.fillText(String(spec.kicker).toUpperCase(), P, y); }
      y += 52;
      var tSize = 76; font('800', tSize);
      var tl = wrap(spec.title, IW, 2);
      if (tl.length > 1) { tSize = 64; font('800', tSize); tl = wrap(spec.title, IW, 2); }
      tl.forEach(function (l) { if (draw) { ctx.fillStyle = C.fg; ctx.fillText(l, P, y); } y += tSize * 1.12; });
      y += 10;
      var x = P;
      spec.subtitle.forEach(function (part) {
        font(part.strong ? '800' : '600', 36);
        if (draw) { ctx.fillStyle = part.strong ? C.fg : C.muted; ctx.fillText(part.t, x, y); }
        x += ctx.measureText(part.t).width;
      });
      if (spec.badge) {
        font('800', 28);
        var bw = ctx.measureText(spec.badge.text).width + 36, bx = x + 20;
        if (bx + bw > P + IW) { y += 56; bx = P; }
        if (draw) { var bc = BADGE[spec.badge.cls]; rr(bx, y - 4, bw, 50, 25, bc[0]); ctx.fillStyle = bc[1]; ctx.fillText(spec.badge.text, bx + 18, y + 7); }
      }
      y += 76;
      if (spec.stats) {
        var sw = IW / spec.stats.length;
        spec.stats.forEach(function (s, i) {
          if (draw) { font('800', 84); ctx.fillStyle = C.fg; ctx.fillText(s.v, P + i * sw, y); font('600', 28); ctx.fillStyle = C.muted; ctx.fillText(fit(s.l, sw - 20), P + i * sw, y + 96); }
        });
        y += 160;
      }
      if (spec.bars) {
        var total = spec.bars.reduce(function (a, b) { return a + Math.max(1, b.v); }, 0), gap = 8, avail = IW - gap * (spec.bars.length - 1), bx2 = P;
        spec.bars.forEach(function (b, i) {
          var w = Math.max(14, avail * Math.max(1, b.v) / total);
          if (draw) {
            if (b.ongoing) {
              rr(bx2, y, w, 64, 14, C.panel);
              ctx.save(); ctx.beginPath(); ctx.rect(bx2, y, w, 64); ctx.clip();
              ctx.fillStyle = C.warn;
              for (var sx = bx2; sx < bx2 + w; sx += 28) ctx.fillRect(sx, y + 26, 16, 12);
              ctx.restore();
            } else {
              var ci = Math.min(i, C.ramp.length - 1);
              rr(bx2, y, w, 64, 14, C.ramp[ci]);
              font('800', 28);
              var lab = b.v + 'd';
              if (ctx.measureText(lab).width + 20 <= w) { ctx.fillStyle = C.ink[ci]; ctx.fillText(lab, bx2 + (w - ctx.measureText(lab).width) / 2, y + 17); }
            }
          }
          bx2 += w + gap;
        });
        y += 64 + 14;
        if (spec.range) {
          font('600', 26);
          if (draw) { ctx.fillStyle = C.muted; ctx.fillText(spec.range[0], P, y); var rw = ctx.measureText(spec.range[1]).width; ctx.fillText(spec.range[1], P + IW - rw, y); }
          y += 40;
        }
        y += 34;
      }
      if (spec.months) {
        var mx = Math.max.apply(null, spec.months.concat([1])), cw = IW / 12, bh = 150;
        spec.months.forEach(function (n, i) {
          var h = n ? Math.max(12, bh * n / mx) : 6;
          if (draw) { rr(P + i * cw + 8, y + bh - h, cw - 16, h, 8, n ? C.ramp[0] : C.panel); font('700', 24); ctx.fillStyle = C.muted; ctx.fillText(MONTHS[i].charAt(0), P + i * cw + cw / 2 - 8, y + bh + 12); }
        });
        y += bh + 64;
      }
      if (spec.items && spec.items.length) {
        var shown = spec.items.slice(0, 10), colW = (IW - 40) / 2;
        var rowH = 34 + 50 + (shown.some(function (it) { return it.bottom; }) ? 36 : 0) + 26;
        shown.forEach(function (it, i) {
          var cx = P + (i % 2) * (colW + 40), cy = y + Math.floor(i / 2) * rowH;
          if (draw) {
            font('800', 26); ctx.fillStyle = C.accent; ctx.fillText(it.top, cx, cy);
            font('800', 40); ctx.fillStyle = C.fg; ctx.fillText(fit(it.main, colW), cx, cy + 34);
            if (it.bottom) { font('600', 26); ctx.fillStyle = C.muted; ctx.fillText(it.bottom, cx, cy + 86); }
          }
        });
        y += Math.ceil(shown.length / 2) * rowH;
        if (spec.items.length > shown.length) {
          font('700', 28);
          if (draw) { ctx.fillStyle = C.muted; ctx.fillText('+ ' + plural(spec.items.length - shown.length, 'more step'), P, y); }
          y += 48;
        }
        y += 10;
      }
      font('700', 28);
      if (draw) {
        ctx.fillStyle = C.muted;
        if (spec.footLeft) ctx.fillText(spec.footLeft, P, y);
        var brand = 'Journeys', bwid = ctx.measureText(brand).width;
        ctx.fillText(brand, P + IW - bwid, y);
        ctx.beginPath(); ctx.arc(P + IW - bwid - 22, y + 15, 9, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
      }
      y += 40 + P;
      return y;
    }
    canvas.width = W; canvas.height = 10;
    var h = Math.ceil(layout(false));
    canvas.width = W; canvas.height = h;
    layout(true);
    return canvas;
  }

  function buildShareImage() {
    var sh = state.sheet;
    if (!sh || sh.kind !== 'share') return;
    var spec = sh.what === 'journey' ? journeyCardSpec(sh.jid, sh.showDates) : yearCardSpec(sh.year);
    var ready = (document.fonts && document.fonts.load)
      ? Promise.all([document.fonts.load('800 76px "Plus Jakarta Sans"'), document.fonts.load('600 36px "Plus Jakarta Sans"')]).catch(function () {})
      : Promise.resolve();
    ready.then(function () {
      if (state.sheet !== sh) return;
      var canvas = drawCard(spec, sh.dark);
      canvas.toBlob(function (blob) {
        if (state.sheet !== sh || !blob) return;
        if (sh.url) URL.revokeObjectURL(sh.url);
        sh.blob = blob; sh.url = URL.createObjectURL(blob); sh.file = spec.file; sh.shareTitle = spec.shareTitle;
        var box = document.querySelector('.share-preview');
        if (box) box.innerHTML = '<img id="share-img" src="' + sh.url + '" alt="Preview of the image to share">';
      }, 'image/png');
    });
  }

  // ---------- step sheet ----------
  function openStepSheet(jid, stepId) {
    var s = stepId ? state.data.steps.find(function (x) { return x.id === stepId; }) : null;
    state.sheet = { jid: jid, stepId: stepId || null, step: s ? s.step : '', date: s ? s.date : today(), notes: s ? s.notes : '', final: false };
    state.menu = false;
    render();
    setTimeout(function () { var el = document.getElementById('st-name'); if (el && !stepId) el.focus(); }, 60);
  }
  function closeSheet() {
    if (state.sheet && state.sheet.url) URL.revokeObjectURL(state.sheet.url);
    state.sheet = null; render();
  }

  function suggestions(j, current) {
    var t = typeOf(j.type);
    var used = stepsOf(j.id).map(function (s) { return s.step.toLowerCase(); });
    var fromOthers = [];
    state.data.journeys.forEach(function (o) {
      if (o.type === j.type && o.id !== j.id) stepsOf(o.id).forEach(function (s) { fromOthers.push(s.step); });
    });
    var list = [];
    t.steps.concat(fromOthers).forEach(function (n) {
      var k = n.toLowerCase();
      if (used.indexOf(k) < 0 && !list.some(function (x) { return x.toLowerCase() === k; })) list.push(n);
    });
    if (current && list.indexOf(current) < 0 && current) { /* keep typed value out of chips */ }
    return list.slice(0, 6);
  }

  function stepHint(jid, stepId, date) {
    if (!validIso(date)) return '';
    var st = stepsOf(jid).filter(function (s) { return s.id !== stepId; });
    var prev = null;
    st.forEach(function (s) { if (s.date <= date) prev = s; });
    if (!st.length) return 'This will be the first step.';
    var first = st[0].date < date ? st[0].date : date;
    if (!prev) return 'This is before ' + st[0].step + ' (' + days(date, st[0].date) + ' days earlier) and becomes the new first step.';
    var g = days(prev.date, date);
    return (g === 0 ? 'Same day as ' + prev.step : plural(g, 'day') + ' after ' + prev.step) + ' · Day ' + days(first, date) + ' of this journey';
  }

  function mountSheet(html, key) {
    document.body.style.overflow = 'hidden';
    var active = document.activeElement;
    var keep = active && sheetRoot.contains(active) && active.id ? { id: active.id, s: active.selectionStart } : null;
    if (sheetRoot.dataset.key === key && sheetRoot.firstChild) html = html.replace('<div class="scrim"', '<div class="scrim still"');
    sheetRoot.dataset.key = key;
    sheetRoot.innerHTML = html;
    if (keep) { var el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) { /* ignore */ } } }
  }

  function renderSheet() {
    var sh = state.sheet;
    if (!sh) {
      sheetRoot.dataset.key = ''; document.body.style.overflow = '';
      var old = sheetRoot.firstChild;
      if (old && old.classList && !reduceMotion()) {
        if (!old.classList.contains('closing')) {
          old.classList.add('closing'); // slide down, then remove
          clearTimeout(sheetTimer);
          sheetTimer = setTimeout(function () { if (!state.sheet) sheetRoot.innerHTML = ''; }, 200);
        }
      } else sheetRoot.innerHTML = '';
      return;
    }
    clearTimeout(sheetTimer);
    if (sheetRoot.firstChild && sheetRoot.firstChild.classList && sheetRoot.firstChild.classList.contains('closing')) { sheetRoot.innerHTML = ''; sheetRoot.dataset.key = ''; }
    if (sh.kind === 'finish') {
      var fj = journeyById(sh.jid);
      if (!fj) { state.sheet = null; sheetRoot.innerHTML = ''; return; }
      return mountSheet(finishSheetHtml(sh, fj), 'finish|' + sh.jid);
    }
    if (sh.kind === 'share') return mountSheet(shareSheetHtml(sh), 'share|' + (sh.jid || sh.year));
    if (sh.kind === 'addon') {
      var am = addons[sh.addon];
      if (!am) { state.sheet = null; sheetRoot.innerHTML = ''; document.body.style.overflow = ''; return; }
      return mountSheet(am.sheet(sh), 'addon|' + sh.addon + '|' + (sh.key || ''));
    }
    var j = state.data.journeys.find(function (x) { return x.id === sh.jid; });
    if (!j) { state.sheet = null; sheetRoot.innerHTML = ''; return; }
    document.body.style.overflow = 'hidden';
    var editing = !!sh.stepId;
    var sugg = suggestions(j, sh.step);
    var html = '<div class="scrim" data-action="scrim"><form class="sheet" id="step-form" role="dialog" aria-modal="true" aria-labelledby="st-title" novalidate>' +
      '<div class="grab" aria-hidden="true"></div>' +
      '<div class="top"><div><div class="eyebrow">' + esc(j.name) + '</div><h1 class="small" id="st-title" style="font-size:24px">' + (editing ? 'Edit step' : 'Add a step') + '</h1></div>' +
      '<button type="button" class="icon-btn soft" data-action="close-sheet" aria-label="Close">' + icon('close', 18, 2.4) + '</button></div>' +
      '<div class="field"><label for="st-name">What happened?</label><input class="input" id="st-name" name="step" autocomplete="off" placeholder="e.g. Got offer letter" value="' + esc(sh.step) + '" required>' +
      (sugg.length ? '<div class="chips">' + sugg.map(function (n) {
        return '<button type="button" class="chip accent" data-action="pick-step" data-v="' + esc(n) + '" aria-pressed="' + (sh.step === n) + '">' + esc(n) + '</button>';
      }).join('') + '</div>' : '') + '</div>' +
      dateField('st-date', sh.date) +
      '<div class="hint" id="st-hint">' + icon('clock', 18) + '<span>' + esc(stepHint(sh.jid, sh.stepId, sh.date)) + '</span></div>' +
      '<div class="field"><label for="st-notes">Notes <span class="opt">(optional)</span></label><textarea class="input" id="st-notes" name="notes" rows="3" placeholder="Anything worth remembering">' + esc(sh.notes) + '</textarea></div>' +
      (!editing && j.status !== 'Done' ? '<button type="button" class="linkish" style="align-self:flex-start;font-size:14px" data-action="to-finish">This finishes the journey…</button>' : '') +
      '<p class="error-text" id="st-err" role="alert"></p>' +
      '<div style="display:flex;gap:10px">' + (editing ? '<button type="button" class="btn danger" style="flex:none;padding:0 18px" data-action="delete-step">Delete</button>' : '') +
      '<button class="btn" type="submit">' + (editing ? 'Save changes' : 'Save step') + '</button></div>' +
      '</form></div>';
    var active = document.activeElement;
    var keep = active && sheetRoot.contains(active) && active.id ? { id: active.id, s: active.selectionStart } : null;
    var key = sh.jid + '|' + (sh.stepId || 'new');
    if (sheetRoot.dataset.key === key && sheetRoot.firstChild) html = html.replace('<div class="scrim"', '<div class="scrim still"');
    sheetRoot.dataset.key = key;
    sheetRoot.innerHTML = html;
    if (keep) { var el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) { /* ignore */ } } }
  }

  // ---------- toast ----------
  var toastTimer, sheetTimer;
  function toast(msg) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    else { el.classList.remove('out'); el.classList.remove('bump'); el.getBoundingClientRect(); el.classList.add('bump'); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('out');
      toastTimer = setTimeout(function () { el.remove(); }, reduceMotion() ? 0 : 220);
    }, 3200);
  }

  // ---------- events ----------
  var actions = {
    'filter': function (el) { state.filter = el.dataset.v; render(); },
    'new': function () { state.newForm = null; go('#/new'); },
    'sync-now': function () { if (isDemo()) go('#/settings'); else sync(); },
    'menu': function () { state.menu = !state.menu; render(); },
    'rename': function () {
      var id = route().id, j = state.data.journeys.find(function (x) { return x.id === id; });
      state.menu = false;
      var name = window.prompt('Rename journey', j.name);
      if (name && name.trim() && name.trim() !== j.name) updateJourney(id, { name: name.trim() }); else render();
    },
    'toggle-done': function () {
      var id = route().id, j = state.data.journeys.find(function (x) { return x.id === id; });
      state.menu = false;
      updateJourney(id, { status: j.status === 'Done' ? 'Active' : 'Done' });
    },
    'delete-journey': function () {
      var id = route().id, j = state.data.journeys.find(function (x) { return x.id === id; });
      state.menu = false;
      if (window.confirm('Delete "' + j.name + '" and all its steps? This also removes them from your Sheet.')) { deleteJourney(id); go('#/'); toast('Journey deleted'); }
      else render();
    },
    'add-step': function () { openStepSheet(route().id); },
    'finish': function () { openFinishSheet(route().id); },
    'change-outcome': function () { openFinishSheet(route().id, { outcomeOnly: true }); },
    'to-finish': function () {
      readSheetForm();
      var sh = state.sheet;
      openFinishSheet(sh.jid, { step: sh.step.trim(), date: sh.date, notes: sh.notes });
    },
    'pick-outcome': function (el) {
      readFinishForm();
      var sh = state.sheet, j = journeyById(sh.jid);
      sh.outcome = sh.outcome === el.dataset.v && sh.outcomeOnly ? '' : el.dataset.v;
      if (!sh.stepTouched && !sh.outcomeOnly) sh.step = finalStepFor(sh.outcome, j.type);
      renderSheet();
    },
    'clear-outcome': function () {
      var sh = state.sheet;
      updateJourney(sh.jid, { outcome: '' });
      state.sheet = null; render(); toast('Outcome cleared');
    },
    'share-journey': function () { openShareSheet('journey', route().id); },
    'share-year': function () { openShareSheet('year', state.year || +today().slice(0, 4)); },
    'share-save': function () {
      var sh = state.sheet;
      if (!sh || !sh.url) { toast('Still preparing the image'); return; }
      var a = document.createElement('a');
      a.href = sh.url; a.download = sh.file || 'journey.png';
      document.body.appendChild(a); a.click(); a.remove();
      toast('Image saved');
    },
    'share-send': function () {
      var sh = state.sheet;
      if (!sh || !sh.blob) { toast('Still preparing the image'); return; }
      var file = new File([sh.blob], sh.file || 'journey.png', { type: 'image/png' });
      navigator.share({ files: [file], title: sh.shareTitle }).catch(function (e) { if (e && e.name !== 'AbortError') toast("Couldn't open sharing. Save the image instead."); });
    },
    'search-clear': function () {
      state.search.q = '';
      var inp = document.getElementById('search-q');
      if (inp) { inp.value = ''; inp.focus(); }
      var box = document.getElementById('search-results');
      if (box) box.innerHTML = searchResultsHtml('');
    },
    'search-recent': function (el) {
      state.search.q = el.dataset.v;
      render();
      var inp = document.getElementById('search-q');
      if (inp) inp.focus();
    },
    'search-clear-recent': function () { store(LS.recent, []); render(); },
    'search-open': function (el) { rememberSearch(state.search.q); go(el.dataset.href); },
    'cal-day': function (el) { state.cal.sel = el.dataset.v; render(); },
    'cal-nav': function (el) {
      markEnter();
      var c = state.cal, m = c.m + Number(el.dataset.v);
      c.y += Math.floor(m / 12); c.m = ((m % 12) + 12) % 12;
      c.sel = c.y + '-' + pad(c.m + 1) + '-01';
      render();
    },
    'cal-today': function () { state.cal = null; render(); },
    'year-nav': function (el) { markEnter(); state.year = (state.year || +today().slice(0, 4)) + Number(el.dataset.v); render(); },
    'edit-step': function (el) { openStepSheet(route().id, el.dataset.id); },
    'close-sheet': closeSheet,
    'scrim': function (el, ev) { if (ev.target === el) closeSheet(); },
    'pick-step': function (el) { readSheetForm(); state.sheet.step = el.dataset.v; renderSheet(); },
    'set-date': function (el) {
      var input = document.getElementById(el.dataset.for);
      if (input) { input.value = el.dataset.v; input.dispatchEvent(new Event('input', { bubbles: true })); }
    },
    'nj-type': function (el) {
      readNewForm();
      var prevDefault = typeOf(state.newForm.type).first;
      state.newForm.type = el.dataset.v;
      if (!state.newForm.step || state.newForm.step === prevDefault) state.newForm.step = typeOf(el.dataset.v).first;
      render();
    },
    'delete-step': function () {
      var sh = state.sheet;
      var st = stepsOf(sh.jid);
      if (st.length === 1 && !window.confirm('This is the only step. Delete it anyway?')) return;
      deleteStep(sh.stepId); state.sheet = null; render(); toast('Step deleted');
    },
    'copy-mcp': function (el) {
      var v = el.dataset.v;
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Copied'); }, function () {
        var r = document.createRange(); r.selectNodeContents(document.getElementById('mcp-url'));
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Selected. Copy it from here');
      });
    },
    'reload-server-settings': function () { state.serverSettings = null; render(); },
    'reset-setting': function (el) {
      var k = el.dataset.k, body = { values: {} };
      body.values[k] = null;
      el.disabled = true;
      var sheetChanged = k === 'spreadsheetId';
      if (sheetChanged && state.outbox.length && !window.confirm(plural(state.outbox.length, 'change') + " haven't reached the current Sheet yet and will be discarded. Switch anyway?")) { el.disabled = false; return; }
      settingsCall('POST', body).then(function (p) {
        if (sheetChanged) { state.outbox = []; store(LS.outbox, []); }
        toast('Using the .env value');
        afterServerSave(p, sheetChanged);
      }, function (e) { el.disabled = false; toast(e.message); });
    },
    'ha-test': function (el) {
      haCall(el, 'api/ha/test', function () { return 'Test notification sent'; });
    },
    'ha-check': function (el) {
      haCall(el, 'api/ha/check', function (p) {
        return p.sent.length ? 'Nudged about ' + p.sent.join(', ') : 'Nothing is waiting longer than usual';
      });
    },
    'reset-demo': function () { state.data = sampleData(); saveData(); render(); toast('Sample data restored'); },
    'clear-demo': function () {
      if (!window.confirm('Remove all sample journeys from this device?')) return;
      state.data = { journeys: [], steps: [] }; saveData(); render();
    }
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (state.menu && (!el || ['rename', 'toggle-done', 'delete-journey', 'menu', 'finish', 'change-outcome', 'share-journey'].indexOf(el.dataset.action) < 0)) {
      state.menu = false; render();
      if (!el) return;
    }
    if (!el) return;
    var name = el.dataset.action, fn = actions[name];
    if (!fn) eachAddon(function (m) { if (!fn && m.actions && m.actions[name]) fn = m.actions[name]; });
    if (fn) { if (el.tagName === 'A') ev.preventDefault(); fn(el, ev); }
  });

  function readSheetForm() {
    var f = document.getElementById('step-form');
    if (!f || !state.sheet) return;
    state.sheet.step = f.step.value;
    state.sheet.date = f.date.value;
    state.sheet.notes = f.notes.value;
    if (f.final) state.sheet.final = f.final.checked;
  }
  function readNewForm() {
    var f = document.getElementById('new-form');
    if (!f) return;
    state.newForm = { name: f.name.value, type: state.newForm.type, step: f.step.value, date: f.date.value, notes: f.notes.value };
  }

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'st-date' || t.id === 'st-name' || t.id === 'st-notes') {
      readSheetForm();
      if (t.id === 'st-date') {
        var hint = document.querySelector('#st-hint span');
        if (hint) hint.textContent = stepHint(state.sheet.jid, state.sheet.stepId, state.sheet.date);
        syncDateChips('st-date');
      } else if (t.id === 'st-name') {
        document.querySelectorAll('#step-form [data-action="pick-step"]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.v === t.value)); });
      }
    }
    if (t.form && t.form.id === 'new-form') { readNewForm(); if (t.id === 'nj-date') syncDateChips('nj-date'); }
    eachAddon(function (m) { if (m.onInput) m.onInput(t, ev); });
    if (t.id === 'search-q') {
      state.search.q = t.value;
      var box = document.getElementById('search-results');
      if (box) box.innerHTML = searchResultsHtml(t.value);
    }
    if (t.form && t.form.id === 'finish-form') {
      readFinishForm();
      if (t.id === 'fin-step') state.sheet.stepTouched = true;
      if (t.id === 'fin-date') syncDateChips('fin-date');
    }
  });
  document.addEventListener('change', function (ev) {
    var at = ev.target.dataset && ev.target.dataset.addonToggle;
    if (at) { var ad = addonList().find(function (x) { return x.id === at; }); if (ad) toggleAddon(ad, ev.target.checked, ev.target); return; }
    var k = ev.target.dataset && ev.target.dataset.shareOpt;
    if (k && state.sheet && state.sheet.kind === 'share') { state.sheet[k] = ev.target.checked; buildShareImage(); }
  });
  function syncDateChips(id) {
    var v = document.getElementById(id).value;
    document.querySelectorAll('[data-action="set-date"][data-for="' + id + '"]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.v === v)); });
  }

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    var handled = false;
    eachAddon(function (m) { if (!handled && m.onSubmit && m.onSubmit(f)) handled = true; });
    if (handled) return;
    if (f.id === 'step-form') {
      readSheetForm();
      var sh = state.sheet, err = document.getElementById('st-err');
      var name = sh.step.trim();
      if (!name) { err.textContent = 'Give the step a name.'; f.step.focus(); return; }
      if (!validIso(sh.date)) { err.textContent = 'Pick a date.'; f.date.focus(); return; }
      if (sh.stepId) updateStep(sh.stepId, name, sh.date, sh.notes.trim());
      else addStep(sh.jid, name, sh.date, sh.notes.trim(), sh.final);
      var wasNew = !sh.stepId;
      state.sheet = null; render();
      toast(wasNew ? (sh.final ? 'Journey complete' : 'Step added') : 'Step updated');
    }
    if (f.id === 'search-form') {
      rememberSearch(state.search.q);
      var qi = document.getElementById('search-q');
      if (qi) qi.blur();
      return;
    }
    if (f.id === 'finish-form') {
      readFinishForm();
      var fs = state.sheet, fj = journeyById(fs.jid), ferr = document.getElementById('fin-err');
      if (fs.outcomeOnly) {
        if (!fs.outcome) { ferr.textContent = 'Pick how it ended.'; return; }
        updateJourney(fs.jid, { outcome: fs.outcome });
        state.sheet = null; render(); toast('Outcome saved');
        return;
      }
      var stepName = (fs.step || '').trim() || finalStepFor(fs.outcome, fj.type);
      if (!stepName) { ferr.textContent = 'Name the last step, or pick how it ended.'; f.step.focus(); return; }
      if (!validIso(fs.date)) { ferr.textContent = 'Pick a date.'; f.date.focus(); return; }
      addStep(fs.jid, stepName, fs.date, (fs.notes || '').trim(), true, fs.outcome);
      state.sheet = null; render();
      toast(fs.outcome ? 'Journey finished · ' + outcomeOf(fs.outcome).label : 'Journey finished');
      if (fs.outcome === 'got') confetti();
      return;
    }
    if (f.id === 'new-form') {
      readNewForm();
      var n = state.newForm, e2 = document.getElementById('nj-err');
      if (!n.name.trim()) { e2.textContent = 'Give the journey a name.'; f.name.focus(); return; }
      if (!n.step.trim()) { e2.textContent = 'Name the first step.'; f.step.focus(); return; }
      if (!validIso(n.date)) { e2.textContent = 'Pick a date.'; f.date.focus(); return; }
      var id = addJourney(n.name.trim(), n.type, n.step.trim(), n.date, (n.notes || '').trim());
      state.newForm = null;
      go('#/j/' + id);
    }
    if (f.id === 'server-form') {
      var cur = state.serverSettings.values, changes = {}, errEl = document.getElementById('srv-err');
      errEl.textContent = '';
      ['spreadsheetId', 'timeZone', 'haUrl', 'haNotify', 'nudgeHour', 'nudgeAfterDays', 'nudgeRepeatDays'].forEach(function (k) {
        var el = f.elements[k];
        if (el && String(el.value).trim() !== String(cur[k] == null ? '' : cur[k])) changes[k] = el.value.trim();
      });
      if (!Object.keys(changes).length) { toast('No changes'); return; }
      var sheetChanged = 'spreadsheetId' in changes;
      if (sheetChanged && state.outbox.length && !window.confirm(plural(state.outbox.length, 'change') + " haven't reached the current Sheet yet and will be discarded. Switch anyway?")) return;
      var sbtn = f.querySelector('[type=submit]'); sbtn.disabled = true; sbtn.textContent = sheetChanged ? 'Checking the Sheet…' : 'Saving…';
      settingsCall('POST', { values: changes }).then(function (p) {
        if (sheetChanged) { state.outbox = []; store(LS.outbox, []); }
        toast(p.storage.saved ? 'Saved' : 'Saved until the server restarts');
        afterServerSave(p, sheetChanged);
      }, function (e) {
        errEl.textContent = e.message;
        sbtn.disabled = false; sbtn.textContent = 'Save';
      });
    }
    if (f.id === 'cfg-form') {
      var tokenVal = f.token.value.trim(), e3 = document.getElementById('cfg-err');
      e3.textContent = '';
      var btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Checking…';
      var prevToken = cfg.token;
      cfg.token = tokenVal;
      api({ action: 'read' }).then(function () {
        store(LS.config, cfg);
        toast('Token saved');
        sync();
      }, function (err) {
        if (err.kind === 'auth') { cfg.token = prevToken; e3.textContent = 'That token was not accepted.'; }
        else { store(LS.config, cfg); e3.textContent = err.message; }
        btn.disabled = false; btn.textContent = 'Save token';
      });
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (state.sheet) closeSheet();
      else if (state.menu) { state.menu = false; render(); }
    }
  });

  window.addEventListener('hashchange', function () {
    state.menu = false; state.sheet = null;
    if (route().name === 'server') state.serverSettings = null;
    render(); window.scrollTo(0, 0);
    if (route().name === 'search') { var qi = document.getElementById('search-q'); if (qi) qi.focus(); }
  });
  window.addEventListener('online', function () { sync(); });
  window.addEventListener('offline', function () { if (!isDemo()) setSync('offline'); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync(); });

  // ---------- start ----------
  loadAddons(); // the last known list, so add-ons also work offline
  render();
  probe().then(sync);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline support unavailable */ }); });
  }
})();
