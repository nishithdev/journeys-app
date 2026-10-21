/* Journeys — a small PWA that tracks life journeys step by step, synced to a Google Sheet. */
(function () {
  'use strict';

  // ---------- constants ----------
  var LS = { config: 'jt.config', data: 'jt.data', outbox: 'jt.outbox', demo: 'jt.demo', mode: 'jt.mode' };
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
    sync: '<path d="M20 11a8 8 0 0 0-14.7-4.4M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4M20 20v-4h-4"/>'
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
    menu: false
  };
  function isDemo() { return mode !== 'server'; }
  if (!state.data) state.data = isDemo() ? sampleData() : { journeys: [], steps: [] };

  function saveData() { store(isDemo() ? LS.demo : LS.data, state.data); }

  function sampleData() {
    var t = today();
    var j = [
      { id: 'Jdemo1', name: 'Acme Corp', type: 'Job', status: 'Active' },
      { id: 'Jdemo2', name: 'Passport renewal', type: 'Documents', status: 'Active' },
      { id: 'Jdemo3', name: 'Lakeview apartment', type: 'Home', status: 'Done' }
    ];
    var s = [
      ['Jdemo1', 'Applied', -25, 'Via LinkedIn'], ['Jdemo1', 'Interview', -15, '2 rounds, panel + manager'],
      ['Jdemo1', 'Background check', -5, ''], ['Jdemo1', 'Offer letter', 0, ''],
      ['Jdemo2', 'Submitted', -15, 'Online, paid expedite fee'], ['Jdemo2', 'Processing', -12, ''],
      ['Jdemo3', 'Applied', -80, ''], ['Jdemo3', 'Approved', -77, ''], ['Jdemo3', 'Moved in', -61, 'Unit 4B']
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
        if (mode !== 'server') {
          mode = 'server'; store(LS.mode, mode);
          state.data = load(LS.data, null) || { journeys: [], steps: [] };
          render();
        }
      });
  }

  var syncing = null;
  function sync() {
    if (isDemo()) { setSync('demo'); return Promise.resolve(); }
    if (syncing) { syncing.again = true; return syncing.p; }
    if (!navigator.onLine) { setSync('offline'); return Promise.resolve(); }
    var run = { again: false };
    setSync('syncing');
    run.p = (function flush() {
      if (!state.outbox.length) return Promise.resolve();
      var op = state.outbox[0];
      return api(op).then(function () {
        state.outbox.shift(); store(LS.outbox, state.outbox); return flush();
      }, function (err) {
        if (err.kind === 'user') {
          // The server rejected this change itself; drop it so it doesn't block everything else.
          state.outbox.shift(); store(LS.outbox, state.outbox);
          toast('A change could not be saved: ' + err.message);
          return flush();
        }
        throw err;
      });
    })().then(function () {
      return api({ action: 'read' });
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
  function addStep(jid, step, date, notes, final) {
    var id = uid('S');
    mutate({ action: 'addStep', id: id, journeyId: jid, step: step, date: date, notes: notes, final: !!final }, function (d) {
      d.steps.push({ id: id, journeyId: jid, step: step, date: date, notes: notes });
      if (final) d.journeys.forEach(function (j) { if (j.id === jid) j.status = 'Done'; });
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
      d.journeys.forEach(function (j) { if (j.id === id) Object.assign(j, fields); });
    });
  }
  function deleteJourney(id) {
    mutate({ action: 'deleteJourney', id: id }, function (d) {
      d.journeys = d.journeys.filter(function (j) { return j.id !== id; });
      d.steps = d.steps.filter(function (s) { return s.journeyId !== id; });
    });
  }

  // ---------- routing ----------
  function route() {
    var h = (location.hash || '#/').slice(1);
    var m;
    if ((m = /^\/j\/([\w-]+)$/.exec(h))) return { name: 'journey', id: m[1] };
    if (h === '/new') return { name: 'new' };
    if (h === '/insights') return { name: 'insights' };
    if (h === '/settings') return { name: 'settings' };
    if (h === '/server') return { name: 'server' };
    return { name: 'home' };
  }
  function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

  // ---------- rendering ----------
  var root = document.getElementById('app');
  var sheetRoot = document.createElement('div');
  document.body.appendChild(sheetRoot);

  function render() {
    var r = route();
    var html;
    if (r.name === 'journey') html = journeyScreen(r.id);
    else if (r.name === 'new') html = newScreen();
    else if (r.name === 'insights') html = insightsScreen() + tabbar('insights');
    else if (r.name === 'settings') html = settingsScreen() + tabbar('settings');
    else if (r.name === 'server') html = serverScreen() + tabbar('settings');
    else html = homeScreen() + tabbar('home');
    var active = document.activeElement;
    var keepFocus = active && active.id && root.contains(active) ? { id: active.id, val: active.value, s: active.selectionStart } : null;
    root.innerHTML = html;
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
    return '<nav class="tabbar" aria-label="Main"><div class="tabbar-inner">' +
      tab('home', '#/', 'list', 'Journeys') + tab('insights', '#/insights', 'chart', 'Insights') + tab('settings', '#/settings', 'gear', 'Settings') +
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
      '<div class="top"><div><div class="eyebrow">' + esc(dateLabel) + '</div><h1>Journeys</h1></div>' + syncPill() + '</div>' +
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
          '<div class="v">' + plural(ii.total, 'day') + '</div></a>';
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
        '<button role="menuitem" data-action="toggle-done">' + (ii.done ? 'Reopen journey' : 'Mark as done') + '</button>' +
        '<button role="menuitem" class="danger" data-action="delete-journey">Delete journey</button></div>';
    }
    h += '<div><div class="kicker">' + esc(t.id) + (ii.done ? ' · Done' : '') + '</div><h1 class="small">' + esc(j.name) + '</h1></div>';
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

    var h = '<main class="screen"><div class="top"><h1>Insights</h1>' + syncPill() + '</div>' +
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
    h += '<p class="settings-help" style="text-align:center">Journeys v2.2</p></main>';
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

  // ---------- step sheet ----------
  function openStepSheet(jid, stepId) {
    var s = stepId ? state.data.steps.find(function (x) { return x.id === stepId; }) : null;
    state.sheet = { jid: jid, stepId: stepId || null, step: s ? s.step : '', date: s ? s.date : today(), notes: s ? s.notes : '', final: false };
    state.menu = false;
    render();
    setTimeout(function () { var el = document.getElementById('st-name'); if (el && !stepId) el.focus(); }, 60);
  }
  function closeSheet() { state.sheet = null; render(); }

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

  function renderSheet() {
    var sh = state.sheet;
    if (!sh) { sheetRoot.innerHTML = ''; sheetRoot.dataset.key = ''; document.body.style.overflow = ''; return; }
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
      (!editing && j.status !== 'Done' ? '<label class="toggle-row" for="st-final"><span><span class="t">This is the last step</span><span class="s">Marks the journey as done</span></span><input type="checkbox" id="st-final" name="final"' + (sh.final ? ' checked' : '') + '></label>' : '') +
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
  var toastTimer;
  function toast(msg) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.remove(); }, 3200);
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
    if (state.menu && (!el || ['rename', 'toggle-done', 'delete-journey', 'menu'].indexOf(el.dataset.action) < 0)) {
      state.menu = false; render();
      if (!el) return;
    }
    if (!el) return;
    var fn = actions[el.dataset.action];
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
  });
  function syncDateChips(id) {
    var v = document.getElementById(id).value;
    document.querySelectorAll('[data-action="set-date"][data-for="' + id + '"]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.v === v)); });
  }

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
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
  });
  window.addEventListener('online', function () { sync(); });
  window.addEventListener('offline', function () { if (!isDemo()) setSync('offline'); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync(); });

  // ---------- start ----------
  render();
  probe().then(sync);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline support unavailable */ }); });
  }
})();
