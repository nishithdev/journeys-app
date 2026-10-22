/*
 * Goals & habits add-on for the Journeys app.
 * Loaded only when it's switched on in Settings. Talks to the server at api/goals and keeps its own
 * data, offline queue and sample data, so it can be removed by deleting this folder.
 */
(function () {
  'use strict';
  var J = window.Journeys;
  if (!J) return;
  if (window.GoalsLogic) boot();
  else {
    var s = document.createElement('script');
    s.src = 'goals/logic.js';
    s.onload = boot;
    document.body.appendChild(s);
  }

  function boot() {
    var L = window.GoalsLogic, h = J.h, esc = h.esc, icon = h.icon;
    var KEY = { data: 'jt.goals.data', demo: 'jt.goals.demo', outbox: 'jt.goals.outbox' };
    var DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

    h.ICONS.target = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>';
    h.ICONS.checkBold = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
    h.ICONS.skip = '<path d="M5 12h14M13 6l6 6-6 6"/>';
    h.ICONS.bell = '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>';
    h.ICONS.homeAssist = '<path d="M3 11l9-7 9 7v9H3z"/><path d="M10 20v-5h4v5"/>';

    // ---------- data ----------
    var gs = {
      data: h.load(h.isDemo() ? KEY.demo : KEY.data, null),
      outbox: h.load(KEY.outbox, []),
      status: 'idle', error: '',
      month: null, view: 'milestones', menu: false, showArchived: false
    };
    if (!gs.data || !Array.isArray(gs.data.habits)) gs.data = h.isDemo() ? sample() : empty();
    function empty() { return { habits: [], checkins: [], goals: [], progress: [], settings: { checkinHour: 21, stallDays: 14, ha: false } }; }
    function save() { h.store(h.isDemo() ? KEY.demo : KEY.data, gs.data); }
    function settings() { return gs.data.settings || { checkinHour: 21, stallDays: 14, ha: false }; }

    function sample() {
      var t = h.today(), y = t.slice(0, 4), d = empty();
      var A = function (n) { return h.addDays(t, n); };
      d.habits = [
        { id: 'Hdemo1', name: 'Read 20 min', schedule: 'daily', times: 3, days: [], skips: 1, goalId: 'Gdemo1', reminder: true, created: A(-80), status: 'active' },
        { id: 'Hdemo2', name: 'Spanish lesson', schedule: 'daily', times: 3, days: [], skips: 0, goalId: '', reminder: true, created: A(-30), status: 'active' },
        { id: 'Hdemo3', name: 'Call family', schedule: 'weekly', times: 2, days: [], skips: 0, goalId: '', reminder: true, created: A(-60), status: 'active' },
        { id: 'Hdemo4', name: 'Gym', schedule: 'days', times: 3, days: [1, 3, 5], skips: 1, goalId: '', reminder: true, created: A(-50), status: 'active' },
        { id: 'Hdemo5', name: 'Journal', schedule: 'weekly', times: 3, days: [], skips: 0, goalId: '', reminder: false, created: A(-20), status: 'active' }
      ];
      var c = [], i;
      for (i = -40; i <= 0; i++) if (i !== -12) c.push(['Hdemo1', A(i)]);
      for (i = -55; i <= -45; i++) c.push(['Hdemo1', A(i)]);
      for (i = -12; i <= -1; i++) c.push(['Hdemo2', A(i)]);
      [-1, -5, -9, -13, -17, -22].forEach(function (n) { c.push(['Hdemo3', A(n)]); });
      for (i = -45; i <= -1; i++) if (L.scheduled(d.habits[3], A(i)) && i !== -20) c.push(['Hdemo4', A(i)]);
      [-2, -4, -8, -9].forEach(function (n) { c.push(['Hdemo5', A(n)]); });
      d.checkins = c.map(function (x, k) { return { id: 'Cdemo' + k, habitId: x[0], date: x[1], result: 'done', source: 'app' }; });
      d.checkins.push({ id: 'Cdemoskip', habitId: 'Hdemo1', date: A(-12), result: 'skip', source: 'app' });
      var started = y + '-01-01';
      d.goals = [
        { id: 'Gdemo1', name: 'Read 12 books this year', measure: 'number', target: 12, unit: 'books', started: started, due: y + '-12-31', milestones: L.evenMilestones(12, started, y + '-12-31'), status: 'active', finished: '' },
        { id: 'Gdemo2', name: 'Save $10k for a car', measure: 'number', target: 10000, unit: '$', started: A(-120), due: A(245), milestones: L.evenMilestones(10000, A(-120), A(245)), status: 'active', finished: '' },
        { id: 'Gdemo3', name: 'Launch side project', measure: 'number', target: 5, unit: 'steps', started: A(-60), due: A(60), milestones: L.evenMilestones(5, A(-60), A(60)), status: 'active', finished: '' }
      ];
      var bookDays = [-280, -250, -217, -190, -160, -135, -110, -80, -50, -12].map(function (n) { return h.addDays(t, n); }).filter(function (x) { return x >= started; });
      var p = bookDays.map(function (x) { return ['Gdemo1', x, 1, '']; });
      p.push(['Gdemo2', A(-110), 1500, 'Opened the savings account'], ['Gdemo2', A(-80), 1200, ''], ['Gdemo2', A(-50), 1500, 'Bonus'], ['Gdemo2', A(-20), 1000, ''], ['Gdemo2', A(-3), 1000, '']);
      p.push(['Gdemo3', A(-50), 1, 'Picked the idea'], ['Gdemo3', A(-18), 1, 'Landing page draft']);
      d.progress = p.map(function (x, k) { return { id: 'Pdemo' + k, goalId: x[0], date: x[1], amount: x[2], note: x[3] }; });
      return d;
    }

    function habitById(id) { return gs.data.habits.find(function (x) { return x.id === id; }); }
    function goalById(id) { return gs.data.goals.find(function (x) { return x.id === id; }); }
    function stats(hb) { return L.habitStats(hb, gs.data.checkins, h.today()); }
    // Habits due today that aren't done or skipped yet.
    function dueOpen() {
      return gs.data.habits.filter(function (x) { if (x.status === 'archived') return false; var st = stats(x); return st.dueToday && !st.today; }).length;
    }
    function gstats(g) { return L.goalStats(g, gs.data.progress, gs.data.checkins, gs.data.habits, h.today(), settings().stallDays); }
    function amt(n, unit) { return L.formatAmount(n, unit); }
    function streakText(s) {
      if (s.unit === 'weeks') return h.plural(s.streak, 'week');
      return h.plural(s.streak, 'day');
    }

    // ---------- sync (same pattern as the journeys: optimistic, queued offline) ----------
    function api(body) {
      var headers = { 'Content-Type': 'application/json' };
      if (h.token()) headers.Authorization = 'Bearer ' + h.token();
      return fetch('api/goals', { method: 'POST', headers: headers, body: JSON.stringify(body), cache: 'no-store' }).then(function (res) {
        return res.json().catch(function () { throw new Error('The server answered with HTTP ' + res.status + '.'); }).then(function (j) {
          if (!j.ok) { var e = new Error(j.error || 'The server reported an error.'); e.server = true; e.kind = j.kind || 'retry'; throw e; }
          return j.payload;
        });
      });
    }
    // Changes are queued on the phone, then sent together: one request (and one Sheet read and write)
    // for a burst of taps, so we stay under Google's 60-reads-a-minute limit.
    var BATCH_WAIT = 1200, BATCH_MAX = 100;
    var syncing = null, soonTimer = null, retryTimer = null, retryDelay = 0;
    function syncSoon() { clearTimeout(soonTimer); soonTimer = setTimeout(sync, BATCH_WAIT); }
    function retryLater() {
      retryDelay = Math.min(retryDelay ? retryDelay * 2 : 30000, 5 * 60000);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(sync, retryDelay);
      return Math.round(retryDelay / 1000);
    }
    function sync() {
      clearTimeout(soonTimer);
      if (h.isDemo()) return Promise.resolve();
      if (syncing) { syncing.again = true; return syncing.p; }
      if (!navigator.onLine) { gs.status = 'offline'; return Promise.resolve(); }
      clearTimeout(retryTimer);
      var run = { again: false };
      gs.status = 'syncing';
      run.p = (function flush(last) {
        if (!gs.outbox.length) return Promise.resolve(last);
        var ops = gs.outbox.slice(0, BATCH_MAX);
        return api({ action: 'batch', ops: ops }).then(function (p) {
          gs.outbox = gs.outbox.slice(ops.length); h.store(KEY.outbox, gs.outbox);
          var bad = (p.result || []).filter(function (r) { return !r.ok; });
          if (bad.length) h.toast('A change could not be saved: ' + bad[0].error + (bad.length > 1 ? ' (and ' + (bad.length - 1) + ' more)' : ''));
          return flush(p);
        }, function (err) {
          if (err.kind === 'user') { // the server can't use this batch at all; drop it so it doesn't block the rest
            gs.outbox = gs.outbox.slice(ops.length); h.store(KEY.outbox, gs.outbox);
            h.toast('Changes could not be saved: ' + err.message);
            return flush(last);
          }
          throw err;
        });
      })(null).then(function (p) {
        return p || api({ action: 'read' }); // a batch already answers with fresh data
      }).then(function (p) {
        if (!gs.outbox.length) { gs.data = p.data; save(); }
        gs.status = 'synced'; gs.error = ''; retryDelay = 0;
      }).catch(function (err) {
        var wait = err.kind === 'config' || err.kind === 'auth' ? 0 : retryLater();
        gs.status = err.server ? 'error' : 'offline';
        gs.error = (err.server ? err.message.replace(/ It will retry\.?$/, '') : "Can't reach your Journeys server.") +
          (wait ? ' Trying again in ' + (wait >= 60 ? Math.round(wait / 60) + ' min' : wait + ' s') + '. Your changes are kept on this phone.' : '');
      }).then(function () {
        syncing = null;
        if (onScreen()) refresh();
        if (run.again) return sync();
      });
      syncing = run;
      return run.p;
    }
    function onScreen() { var hs = location.hash || ''; return hs.indexOf('#/goals') === 0 || !!(h.sheet() && h.sheet().addon === 'goals'); }
    // Redraw unless someone is typing in one of this add-on's forms.
    function refresh() {
      var a = document.activeElement;
      if (a && a.form && /^g-/.test(a.form.id || '')) return;
      h.render();
    }
    function mutate(op) {
      applyOp(gs.data, op);
      save();
      if (!h.isDemo()) { gs.outbox.push(op); h.store(KEY.outbox, gs.outbox); }
      h.render();
      syncSoon();
    }
    // The same changes the server makes (server/goals.js), so the screen updates before the Sheet does.
    function applyOp(d, b) {
      var t = h.today();
      switch (b.action) {
        case 'addHabit':
          d.habits.push({ id: b.id, name: b.name, schedule: b.schedule, times: b.times || 3, days: L.normDays(b.days), skips: b.skips == null ? 1 : b.skips, goalId: b.goalId || '', reminder: b.reminder !== false, created: t, status: 'active' });
          break;
        case 'updateHabit': {
          var hb = d.habits.find(function (x) { return x.id === b.id; });
          if (!hb) return;
          ['name', 'schedule', 'times', 'skips', 'reminder', 'status', 'goalId'].forEach(function (k) { if (b[k] != null) hb[k] = b[k]; });
          if (b.days != null) hb.days = L.normDays(b.days);
          break;
        }
        case 'deleteHabit':
          d.habits = d.habits.filter(function (x) { return x.id !== b.id; });
          d.checkins = d.checkins.filter(function (c) { return c.habitId !== b.id; });
          break;
        case 'checkin': {
          var ex = d.checkins.find(function (c) { return c.habitId === b.habitId && c.date === b.date; });
          if (b.result === 'none') { d.checkins = d.checkins.filter(function (c) { return c !== ex; }); break; }
          if (ex) ex.result = b.result;
          else d.checkins.push({ id: b.id, habitId: b.habitId, date: b.date, result: b.result, source: 'app' });
          break;
        }
        case 'addGoal':
          var ng = { id: b.id, name: b.name, measure: b.measure, target: +b.target, startValue: +b.startValue || 0, unit: b.unit || '', started: b.started || t, due: b.due || '', status: 'active', finished: '' };
          ng.milestones = L.goalMilestones(ng);
          d.goals.push(ng);
          break;
        case 'updateGoal': {
          var g = d.goals.find(function (x) { return x.id === b.id; });
          if (!g) return;
          var reshape = false;
          if (b.name != null) g.name = b.name;
          if (b.unit != null) g.unit = b.unit;
          if (b.target != null) { g.target = +b.target; reshape = true; }
          if (b.startValue != null) { g.startValue = +b.startValue; reshape = true; }
          if (b.due !== undefined) { g.due = b.due || ''; reshape = true; }
          if (reshape) g.milestones = L.goalMilestones(g);
          if (b.status != null) { g.status = b.status; g.finished = b.status === 'active' ? '' : t; }
          break;
        }
        case 'deleteGoal':
          d.goals = d.goals.filter(function (x) { return x.id !== b.id; });
          d.progress = d.progress.filter(function (p) { return p.goalId !== b.id; });
          d.habits.forEach(function (x) { if (x.goalId === b.id) x.goalId = ''; });
          break;
        case 'addProgress':
          d.progress.push({ id: b.id, goalId: b.goalId, date: b.date, amount: +b.amount, note: b.note || '' });
          break;
        case 'deleteProgress':
          d.progress = d.progress.filter(function (p) { return p.id !== b.id; });
          break;
      }
    }
    function checkin(habitId, date, result) {
      mutate({ action: 'checkin', id: h.uid('C'), habitId: habitId, date: date, result: result });
    }

    // ---------- routes ----------
    function route(hash) {
      var m;
      if (hash === '/goals') return { name: 'g-today', tab: 'goals' };
      if ((m = /^\/goals\/h\/([\w-]+)$/.exec(hash))) return { name: 'g-habit', id: m[1], tab: 'goals' };
      if ((m = /^\/goals\/g\/([\w-]+)$/.exec(hash))) return { name: 'g-goal', id: m[1], tab: 'goals' };
      if (hash === '/goals/settings') return { name: 'g-settings', tab: 'settings' };
      return null;
    }
    function screen(r) {
      if (r.name === 'g-habit') return habitScreen(r.id);
      if (r.name === 'g-goal') return goalScreen(r.id);
      if (r.name === 'g-settings') return settingsScreen();
      return todayScreen();
    }

    function banner() {
      if (h.isDemo()) return '<div class="banner"><span>Sample goals and habits, kept on this device.</span></div>';
      if (gs.status === 'error') return '<div class="banner error" role="alert"><span>' + esc(gs.error) + '</span></div>';
      if (gs.outbox.length && gs.status === 'offline') return '<div class="banner"><span>' + esc(gs.error || 'Offline.') + ' ' + h.plural(gs.outbox.length, 'change') + ' waiting.</span></div>';
      return '';
    }

    // ---------- Today ----------
    function todayScreen() {
      var t = h.today();
      var d = new Date();
      var dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      var list = gs.data.habits.filter(function (x) { return x.status !== 'archived'; }).map(function (x) { return { hb: x, s: stats(x) }; });
      var archived = gs.data.habits.filter(function (x) { return x.status === 'archived'; });
      // Today's habits first, the rest after. Checking one off doesn't move it, so quick taps land where you aim.
      var rank = function (e) { return e.s.dueToday || e.s.today ? 0 : 1; };
      list.sort(function (a, b) { return rank(a) - rank(b); });
      var due = list.filter(function (e) { return e.s.dueToday && !e.s.skippedToday; });
      var doneN = due.filter(function (e) { return e.s.doneToday; }).length;
      var active = gs.data.goals.filter(function (g) { return g.status === 'active'; });
      var finished = gs.data.goals.filter(function (g) { return g.status !== 'active'; });

      var out = '<main class="screen"><div class="top"><div><div class="eyebrow">' + esc(dateLabel) + '</div><h1>Today</h1></div>' +
        '<div class="top-actions">' + h.syncPill() + '<button class="icon-btn g-add" data-action="g-new" aria-label="New habit or goal">' + icon('plus', 22, 2.6) + '</button></div></div>' + banner();

      if (!list.length && !active.length) {
        out += '<div class="empty"><h2>Build a habit, chase a goal</h2><p>Habits are things you repeat, like reading every day. Goals have a target and a date, like saving $10k by August.</p>' +
          '<div style="display:flex;gap:10px"><button class="btn small" data-action="g-new" data-v="habit">' + icon('plus', 18, 2.6) + 'Add a habit</button>' +
          '<button class="btn secondary small" data-action="g-new" data-v="goal">Add a goal</button></div></div>';
        return out + '</main>';
      }

      if (due.length) {
        var C = 2 * Math.PI * 21, frac = doneN / due.length;
        out += '<section class="g-ring-card"><svg role="img" aria-label="' + doneN + ' of ' + due.length + ' habits done today" width="52" height="52" viewBox="0 0 52 52">' +
          '<circle cx="26" cy="26" r="21" fill="none" stroke="#EEF1F5" stroke-width="7"/>' +
          '<circle data-anim="g-ring" cx="26" cy="26" r="21" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (C * frac).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 26 26)"/></svg>' +
          '<div><b>' + doneN + ' of ' + h.plural(due.length, 'habit') + ' done</b><span>' + esc(doneN === due.length ? 'Everything done for today.' : (settings().ha ? 'Home Assistant checks in at ' + h.pad(settings().checkinHour) + ':00' : 'Tap the circle when you\'ve done one.')) + '</span></div></section>';
      }

      if (list.length) {
        out += '<div class="section-label">Habits</div><div class="g-list">' + list.map(function (e) { return habitRow(e.hb, e.s, t); }).join('') + '</div>';
      }
      if (archived.length) {
        out += '<button class="linkish" style="align-self:flex-start;margin:0" data-action="g-show-archived" aria-expanded="' + gs.showArchived + '">' + (gs.showArchived ? 'Hide' : 'Show') + ' archived habits (' + archived.length + ')</button>';
        if (gs.showArchived) out += '<div class="g-list">' + archived.map(function (x) {
          return '<a class="g-row" href="#/goals/h/' + esc(x.id) + '"><span class="g-body"><span class="t">' + esc(x.name) + '</span><span class="s">Archived · ' + esc(L.scheduleLabel(x)) + '</span></span>' + icon('chevron', 18) + '</a>';
        }).join('') + '</div>';
      }

      out += '<div class="section-label">Goals</div>';
      if (!active.length) out += '<button class="row-card" data-action="g-new" data-v="goal" style="text-align:left"><div><div class="t">Add a goal</div><div class="s">A target with a date, split into milestones</div></div>' + icon('plus', 20) + '</button>';
      out += active.map(goalCard).join('');
      if (finished.length) {
        out += '<div class="section-label">Finished</div>' + finished.map(function (g) {
          var s = gstats(g);
          return '<a class="row-card" href="#/goals/g/' + esc(g.id) + '"><div style="min-width:0"><div class="t">' + esc(g.name) + '</div><div class="s">' + (g.status === 'achieved' ? 'Achieved' : 'Abandoned') + (g.finished ? ' ' + esc(h.fmt(g.finished)) : '') + ' · ' + esc(L.goalProgressText(s)) + '</div></div>' + icon('chevron', 20) + '</a>';
        }).join('');
      }
      return out + '</main>';
    }

    function habitRow(hb, s) {
      var meta = s.schedule, right = '';
      if (s.weekTarget) { meta += ' · ' + s.weekDone + ' of ' + s.weekTarget + ' this week'; right = s.streak ? h.plural(s.streak, 'wk') : ''; }
      else right = s.streak ? streakText(s) : '';
      if (!s.dueToday && !s.today) meta = s.weekTarget ? 'Done for this week · ' + s.weekDone + ' of ' + s.weekTarget : 'Not today · ' + s.schedule;
      if (s.skippedToday) meta = 'Skipped today · streak kept';
      var on = s.doneToday, skip = s.skippedToday;
      var label = (on ? 'Done today: ' : skip ? 'Skipped today: ' : 'Mark done today: ') + hb.name;
      return '<div class="g-row' + (!s.dueToday && !s.today ? ' off' : '') + (gs.pop === hb.id ? ' pop' : '') + '">' +
        '<button class="g-check' + (on ? ' on' : skip ? ' skip' : '') + '" data-action="g-check" data-id="' + esc(hb.id) + '" aria-pressed="' + on + '" aria-label="' + esc(label) + '">' + icon(skip ? 'skip' : 'checkBold', 18, 3) + '</button>' +
        '<a class="g-body" href="#/goals/h/' + esc(hb.id) + '"><span class="t">' + esc(hb.name) + '</span><span class="s">' + esc(meta) + '</span></a>' +
        (right ? '<span class="g-streak' + (on ? ' on' : '') + '">' + esc(right) + '</span>' : '') + '</div>';
    }

    var STATUS = {
      ahead: { cls: 'good', text: function (s) { return 'Ahead of plan' + (s.projected ? ' · on pace to finish ' + h.fmt(s.projected) : ''); } },
      'on track': { cls: '', text: function (s, g) { return 'On track' + (s.next ? ' · next: ' + amt(s.next.value, g.unit) + ' by ' + h.fmt(s.next.due) : ''); } },
      behind: { cls: 'warn', text: function (s, g) { return 'Behind plan · ' + amt(Math.round(s.plan * 10) / 10, g.unit) + ' planned by now'; } },
      stalled: { cls: 'warn', text: function (s) { return 'Stalled · no progress in ' + h.plural(s.quietDays, 'day'); } },
      reached: { cls: 'good', text: function () { return 'Target reached · mark it achieved'; } },
      active: { cls: '', text: function (s) {
        if (s.lastProgress) return 'Last update ' + h.fmt(s.lastProgress);
        return s.measure === 'value' ? 'Started at ' + amt(s.startValue, s.unit) + ' · log a reading when it changes' : 'No progress logged yet';
      } },
      achieved: { cls: 'good', text: function () { return 'Achieved'; } },
      abandoned: { cls: '', text: function () { return 'Abandoned'; } }
    };
    function goalCard(g) {
      var s = gstats(g), st = STATUS[s.status];
      return '<a class="g-goal" href="#/goals/g/' + esc(g.id) + '"><div class="g-goal-head"><span class="t">' + esc(g.name) + '</span><span class="v">' + esc(g.measure === 'value' ? amt(s.total, g.unit) + ' → ' + amt(s.target, g.unit) : g.measure === 'number' && g.unit === '$' ? amt(s.total, '$') : s.total + ' / ' + amt(s.target, g.unit === '$' ? '' : g.unit)) + '</span></div>' +
        '<div class="g-bar" role="img" aria-label="' + s.pct + ' percent"><div data-anim="gbar-' + esc(g.id) + '" class="' + st.cls + '" style="width:' + Math.max(s.pct, 2) + '%"></div></div>' +
        '<span class="g-status ' + st.cls + '">' + esc(st.text(s, g)) + '</span></a>';
    }

    // ---------- habit detail ----------
    function habitScreen(id) {
      var hb = habitById(id);
      if (!hb) return '<main class="screen"><a class="icon-btn" href="#/goals" aria-label="Back">' + icon('back', 20, 2.2) + '</a><div class="empty"><h2>Habit not found</h2><p>It may have been deleted on another device.</p></div></main>';
      var s = stats(hb), t = h.today();
      var m = gs.month && gs.month.id === id ? gs.month : (gs.month = { id: id, y: +t.slice(0, 4), m: +t.slice(5, 7) - 1 });
      var goal = hb.goalId ? goalById(hb.goalId) : null;
      var out = '<main class="screen white"><div class="top"><a class="icon-btn soft" href="#/goals" aria-label="Back to today">' + icon('back', 20, 2.2) + '</a>' +
        '<div class="top-actions"><span class="pill pill-accent">' + esc(hb.status === 'archived' ? 'Archived' : 'Habit · ' + s.schedule.toLowerCase()) + '</span>' +
        '<button class="icon-btn soft" data-action="g-menu" aria-label="Habit options" aria-expanded="' + gs.menu + '">' + icon('more', 20, 2.4) + '</button></div></div>';
      if (gs.menu) {
        out += '<div class="menu" role="menu"><button role="menuitem" data-action="g-edit-habit" data-id="' + esc(id) + '">Edit</button>' +
          '<button role="menuitem" data-action="g-archive" data-id="' + esc(id) + '">' + (hb.status === 'archived' ? 'Bring back' : 'Archive') + '</button>' +
          '<button role="menuitem" class="danger" data-action="g-delete-habit" data-id="' + esc(id) + '">Delete habit</button></div>';
      }
      var skipNote = hb.schedule === 'weekly' ? '' : hb.skips ? ' · ' + (hb.skips === 1 ? '1 skip' : hb.skips + ' skips') + ' allowed each week' : ' · no skips';
      out += '<div><h1 class="small">' + esc(hb.name) + '</h1><p class="settings-help" style="margin-top:4px">Started ' + esc(h.fmt(s.started)) + esc(skipNote) + '</p></div>';
      out += '<div class="stats"><div class="stat"><b>' + esc(streakText(s)) + '</b><span>Current streak</span></div>' +
        '<div class="stat"><b>' + esc(streakText({ streak: s.best, unit: s.unit })) + '</b><span>Best streak</span></div>' +
        (s.weekTarget ? '<div class="stat"><b>' + s.weekDone + ' / ' + s.weekTarget + '</b><span>This week</span></div>'
          : '<div class="stat"><b>' + s.monthDone + ' / ' + s.monthDays + '</b><span>Done this month</span></div>') + '</div>';

      if (hb.status !== 'archived') {
        if (s.doneToday || s.skippedToday) {
          out += '<div class="hint">' + icon(s.doneToday ? 'check' : 'skip', 18) + '<span style="flex:1">' + (s.doneToday ? 'Done today.' : 'Skipped today. Your streak is kept.') + '</span>' +
            '<button class="linkish" data-action="g-day" data-v="' + t + '" data-set="none">Undo</button></div>';
        } else if (s.dueToday) {
          out += '<div style="display:flex;gap:10px"><button class="btn" data-action="g-day" data-v="' + t + '" data-set="done">' + icon('checkBold', 18, 3) + 'Done today</button>' +
            (s.skipsLeftThisWeek > 0 ? '<button class="btn secondary" style="flex:none" data-action="g-day" data-v="' + t + '" data-set="skip">Use a skip</button>' : '') + '</div>';
        } else {
          out += '<p class="settings-help">' + (s.weekTarget ? 'Done ' + s.weekDone + ' of ' + s.weekTarget + ' times this week. Nice.' : 'Not scheduled today.') + '</p>';
        }
      }

      out += calendar(hb, s, m);
      if (goal) {
        var gst = gstats(goal);
        out += '<a class="row-card" href="#/goals/g/' + esc(goal.id) + '"><span class="g-ic">' + icon('target', 20) + '</span><div style="flex:1;min-width:0"><div class="s">Counts toward</div><div class="t">' + esc(goal.name) + ' · ' + esc(L.goalProgressText(gst)) + '</div></div>' + icon('chevron', 20) + '</a>';
      }
      var ha = settings().ha;
      out += '<div class="toggle-row g-panel"><label for="g-remind" style="flex:1"><span class="t">Evening reminder</span><span class="s">' +
        (ha ? 'Home Assistant asks at ' + h.pad(settings().checkinHour) + ':00 if it isn\'t done.' : h.isDemo() ? 'On your server, Home Assistant asks in the evening if it isn\'t done.' : 'Set up Home Assistant in Server settings to get it.') + '</span></label>' +
        '<input type="checkbox" role="switch" class="switch" id="g-remind" data-g-remind="' + esc(id) + '"' + (hb.reminder ? ' checked' : '') + '></div>';
      if (!h.isDemo()) out += '<p class="settings-help">ID for Home Assistant automations: <code>' + esc(hb.id) + '</code> (e.g. check it off automatically from a sensor).</p>';
      return out + '</main>';
    }

    function calendar(hb, s, m) {
      var t = h.today();
      var first = m.y + '-' + h.pad(m.m + 1) + '-01';
      var lead = L.weekday(first);
      var nDays = new Date(m.y, m.m + 1, 0).getDate();
      var map = {};
      gs.data.checkins.forEach(function (c) { if (c.habitId === hb.id) map[c.date] = c.result; });
      var cells = '';
      for (var i = 0; i < lead; i++) cells += '<span></span>';
      for (var dnum = 1; dnum <= nDays; dnum++) {
        var iso = m.y + '-' + h.pad(m.m + 1) + '-' + h.pad(dnum);
        var st = iso > t ? 'future' : s.dayState[iso] || (iso < s.started ? (map[iso] ? map[iso] : 'before') : 'off');
        var word = { done: 'done', skip: 'skip used', forgiven: 'missed, skip used', missed: 'missed', off: 'not scheduled', open: 'not done yet', future: '', before: '' }[st] || '';
        var cls = 'g-day ' + st + (iso === t ? ' today' : '') + (gs.pop === hb.id + '|' + iso ? ' pop' : '');
        if (iso > t) cells += '<span class="' + cls + '" aria-hidden="true">' + dnum + '</span>';
        else cells += '<button class="' + cls + '" data-action="g-day" data-v="' + iso + '" aria-label="' + esc(h.fmt(iso, true) + (word ? ', ' + word : '') + '. Tap to change.') + '">' + dnum + '</button>';
      }
      var canNext = m.y < +t.slice(0, 4) || (m.y === +t.slice(0, 4) && m.m < +t.slice(5, 7) - 1);
      return '<section class="panel cal"><div class="cal-head"><button class="icon-btn soft" data-action="g-month" data-v="-1" aria-label="Previous month">' + icon('back', 18, 2.4) + '</button>' +
        '<span class="cal-title">' + esc(h.MONTHS_LONG[m.m] + ' ' + m.y) + '</span>' +
        '<button class="icon-btn soft" data-action="g-month" data-v="1" aria-label="Next month"' + (canNext ? '' : ' disabled') + '>' + icon('chevron', 18, 2.4) + '</button></div>' +
        '<div class="g-cal">' + DAY_SHORT.map(function (x) { return '<span class="cal-dow" aria-hidden="true">' + x + '</span>'; }).join('') + cells + '</div>' +
        '<div class="g-legend"><span><i class="done"></i>Done</span>' + (hb.schedule === 'weekly' ? '' : '<span><i class="skip"></i>Skip used</span><span><i class="missed"></i>Missed</span>') + '</div>' +
        '<p class="settings-help" style="text-align:center">Tap a past day to fill it in.</p></section>';
    }

    // ---------- goal detail ----------
    function goalScreen(id) {
      var g = goalById(id);
      if (!g) return '<main class="screen"><a class="icon-btn" href="#/goals" aria-label="Back">' + icon('back', 20, 2.2) + '</a><div class="empty"><h2>Goal not found</h2><p>It may have been deleted on another device.</p></div></main>';
      var s = gstats(g), st = STATUS[s.status], t = h.today();
      var out = '<main class="screen white"><div class="top"><a class="icon-btn soft" href="#/goals" aria-label="Back to today">' + icon('back', 20, 2.2) + '</a>' +
        '<div class="top-actions"><span class="g-badge ' + st.cls + '">' + esc({ ahead: 'Ahead of plan', 'on track': 'On track', behind: 'Behind plan', stalled: 'Stalled', reached: 'Target reached', active: 'In progress', achieved: 'Achieved', abandoned: 'Abandoned' }[s.status]) + '</span>' +
        '<button class="icon-btn soft" data-action="g-menu" aria-label="Goal options" aria-expanded="' + gs.menu + '">' + icon('more', 20, 2.4) + '</button></div></div>';
      if (gs.menu) {
        out += '<div class="menu" role="menu"><button role="menuitem" data-action="g-edit-goal" data-id="' + esc(id) + '">Edit</button>' +
          (g.status === 'active'
            ? '<button role="menuitem" data-action="g-goal-status" data-id="' + esc(id) + '" data-v="achieved">Mark achieved</button><button role="menuitem" data-action="g-goal-status" data-id="' + esc(id) + '" data-v="abandoned">Abandon</button>'
            : '<button role="menuitem" data-action="g-goal-status" data-id="' + esc(id) + '" data-v="active">Reopen</button>') +
          '<button role="menuitem" class="danger" data-action="g-delete-goal" data-id="' + esc(id) + '">Delete goal</button></div>';
      }
      var sub = g.due ? 'Goal · by ' + h.fmt(g.due) + (g.status === 'active' ? ' · ' + (s.daysLeft >= 0 ? h.plural(s.daysLeft, 'day') + ' left' : h.plural(-s.daysLeft, 'day') + ' past the deadline') : '') : 'Goal · no deadline';
      out += '<div><h1 class="small">' + esc(g.name) + '</h1><p class="settings-help" style="margin-top:4px">' + esc(sub) + '</p></div>';
      var perWeek = s.perDay * 7;
      var first = g.measure === 'value'
        ? '<div class="stat"><b>' + esc(amt(s.total, g.unit)) + '</b><span>' + esc('Now · goal ' + amt(s.target, g.unit)) + '</span></div>'
        : '<div class="stat"><b>' + esc(g.unit === '$' ? amt(s.total, '$') : s.total + ' / ' + s.target) + '</b><span>' + esc(g.unit === '$' ? 'of ' + amt(s.target, '$') : (g.unit || 'done')) + '</span></div>';
      var weekly = Math.abs(perWeek) >= 10 ? Math.round(perWeek) : Math.round(perWeek * 10) / 10;
      out += '<div class="stats">' + first +
        '<div class="stat"><b>' + esc(s.status === 'reached' || g.status !== 'active' ? s.pct + '%' : s.projected ? h.fmt(s.projected) : '–') + '</b><span>' + (s.status === 'reached' || g.status !== 'active' ? 'Of target' : 'Projected finish') + '</span></div>' +
        '<div class="stat"><b>' + esc(s.early ? '–' : (g.measure === 'value' && weekly > 0 ? '+' : '') + (g.unit === '$' ? amt(weekly, '$') : String(weekly))) + '</b><span>' + (g.measure === 'value' ? 'Change per week' : 'Per week, avg') + '</span></div></div>';
      if (g.measure === 'value' && g.status === 'active') out += '<p class="settings-help">' + esc(L.goalProgressText(s)) + ' (' + s.pct + '%). Started at ' + esc(amt(s.startValue, g.unit)) + ' on ' + esc(h.fmt(g.started)) + '.</p>';

      if (s.status === 'reached' && g.status === 'active') {
        out += '<div class="hint good">' + icon('check', 18) + '<span style="flex:1">You reached the target.</span><button class="linkish" data-action="g-goal-status" data-id="' + esc(id) + '" data-v="achieved">Mark achieved</button></div>';
      } else if (s.status === 'stalled') {
        out += '<div class="hint warn">' + icon('clock', 18) + '<span>No progress in ' + h.plural(s.quietDays, 'day') + '.' + (s.next ? ' Next milestone: ' + esc(amt(s.next.value, g.unit)) + ' by ' + esc(h.fmt(s.next.due)) + '.' : '') + '</span></div>';
      }

      if (s.milestones.length) {
        out += '<div class="seg" role="group" aria-label="View"><button class="seg-item" data-action="g-view" data-v="milestones" aria-current="' + (gs.view === 'milestones' ? 'page' : 'false') + '">Milestones</button>' +
          '<button class="seg-item" data-action="g-view" data-v="pace" aria-current="' + (gs.view === 'pace' ? 'page' : 'false') + '">Pace</button></div>';
        out += gs.view === 'pace' ? paceChart(g, s) : milestones(g, s);
      }

      if (g.measure === 'number' || g.measure === 'value') {
        var isVal = g.measure === 'value';
        var sign = function (n) { return isVal ? '' : n > 0 ? '+' : ''; };
        if (g.status === 'active') out += '<button class="btn" style="flex:none" data-action="g-log" data-id="' + esc(id) + '">' + icon('plus', 18, 2.6) + (isVal ? 'Log a reading' : 'Log progress') + '</button>';
        var entries = gs.data.progress.filter(function (p) { return p.goalId === id; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
        if (entries.length) {
          out += '<div class="section-label">' + (isVal ? 'Readings' : 'Progress') + '</div><div class="result-list">' + entries.slice(0, 30).map(function (p) {
            return '<button class="result-row g-entry" data-action="g-del-entry" data-id="' + esc(p.id) + '" aria-label="' + esc(sign(p.amount) + amt(p.amount, g.unit) + ' on ' + h.fmt(p.date) + '. Tap to delete.') + '"><span class="rl-body"><span class="rl-row"><span class="t">' + esc(sign(p.amount) + amt(p.amount, g.unit)) + '</span><span class="s">' + esc(h.fmt(p.date)) + '</span></span>' +
              (p.note ? '<span class="s">' + esc(p.note) + '</span>' : '') + '</span></button>';
          }).join('') + '</div>';
        }
      }
      var linked = gs.data.habits.filter(function (x) { return x.goalId === id; });
      if (linked.length || g.measure === 'checkins') {
        out += '<div class="section-label">' + (g.measure === 'checkins' ? 'Counts check-ins from' : 'Driven by') + '</div>';
        out += linked.length ? linked.map(function (x) {
          var hs = stats(x);
          return '<a class="row-card" href="#/goals/h/' + esc(x.id) + '"><span class="g-ic solid">' + icon('checkBold', 18, 3) + '</span><div style="flex:1;min-width:0"><div class="t">' + esc(x.name) + '</div><div class="s">' + esc(streakText(hs)) + ' streak · ' + esc(hs.schedule) + '</div></div>' + icon('chevron', 20) + '</a>';
        }).join('') : '<p class="settings-help">No habits count toward this goal yet. Edit a habit and pick this goal under "Counts toward".</p>';
      }
      return out + '</main>';
    }

    function milestones(g, s) {
      var t = h.today();
      return '<div class="tl">' + s.milestones.map(function (m, i) {
        var last = i === s.milestones.length - 1;
        var badge, cls;
        if (m.hit) { badge = m.early > 0 ? h.plural(m.early, 'day') + ' early' : m.early < 0 ? h.plural(-m.early, 'day') + ' late' : 'On the day'; cls = m.early >= 0 ? 'good' : 'warn'; }
        else if (m.overdue) { badge = 'Overdue'; cls = 'warn'; }
        else if (s.next && s.next.value === m.value) { badge = 'Next'; cls = ''; }
        else { badge = 'Later'; cls = 'muted'; }
        var meta = 'Planned ' + h.fmt(m.due) + (m.hit ? ' · done ' + h.fmt(m.hit) : m.due >= t ? ' · in ' + h.plural(h.days(t, m.due), 'day') : '');
        return '<div class="tl-item"><div class="tl-rail"><div class="tl-node' + (m.hit ? '' : ' cur') + '" style="width:18px;height:18px;margin-top:2px' + (m.hit ? '' : ';border-width:2px;border-style:dashed;border-color:#9AA3B5') + '"></div>' +
          (last ? '' : '<div class="tl-line" style="min-height:22px"></div>') + '</div>' +
          '<div class="tl-body" style="padding-top:0"><div class="tl-row"><span class="tl-name">' + esc(amt(m.value, g.unit)) + '</span><span class="g-badge ' + cls + '">' + esc(badge) + '</span></div>' +
          '<span class="tl-date" style="white-space:normal">' + esc(meta) + '</span></div></div>';
      }).join('') + '</div>';
    }

    function paceChart(g, s) {
      var t = h.today(), start = g.started, end = g.due && g.due > start ? g.due : t;
      if (end < t) end = t;
      var span = Math.max(1, h.days(start, end)), isValue = g.measure === 'value', from = isValue ? s.startValue : 0;
      // y range: 0 → target for amounts; around start, target and readings for reach-a-number goals
      var vals = [from, s.target, s.total].concat(s.series.map(function (p) { return p.total; }));
      var lo = isValue ? Math.min.apply(null, vals) : 0, hi = Math.max.apply(null, vals);
      if (isValue) { var padY = Math.max((hi - lo) * 0.08, 0.5); lo = Math.floor(lo - padY); hi = Math.ceil(hi + padY); }
      if (hi <= lo) hi = lo + 1;
      var X0 = 34, X1 = 336, Y0 = 170, Y1 = 12;
      var x = function (iso) { return X0 + (X1 - X0) * Math.min(1, Math.max(0, h.days(start, iso) / span)); };
      var y = function (v) { return Y0 - (Y0 - Y1) * Math.min(1, Math.max(0, (v - lo) / (hi - lo))); };
      var pts = [[x(start), y(from)]], prev = from;
      s.series.forEach(function (p) {
        if (p.date < start) return;
        if (!isValue) pts.push([x(p.date), y(prev)]); // amounts step up; readings connect directly
        pts.push([x(p.date), y(p.total)]); prev = p.total;
      });
      pts.push([x(g.status === 'active' ? t : (g.finished || t)), y(prev)]);
      var line = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
      var plan = g.due ? '<polyline points="' + x(start).toFixed(1) + ',' + y(from).toFixed(1) + ' ' + x(g.due).toFixed(1) + ',' + y(s.target).toFixed(1) + '" fill="none" stroke="#9AA3B5" stroke-width="2" stroke-dasharray="5 5"/>' : '';
      var proj = '';
      if (s.projected && g.status === 'active') {
        var px, pv;
        if (s.projected <= end) { px = x(s.projected); pv = s.target; } else { px = X1; pv = s.total + s.perDay * h.days(t, end); }
        proj = '<polyline points="' + x(t).toFixed(1) + ',' + y(s.total).toFixed(1) + ' ' + px.toFixed(1) + ',' + y(pv).toFixed(1) + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="2 5" stroke-linecap="round"/>';
      }
      var mid = h.addDays(start, Math.round(span / 2));
      var label = 'Progress from ' + h.fmt(start) + ': ' + L.goalProgressText(s) + (s.plan != null ? ', plan says ' + amt(Math.round(s.plan * 10) / 10, g.unit) + ' by today' : '') + '.';
      var text = s.projected ? 'At your pace you reach ' + amt(s.target, g.unit) + ' on ' + h.fmt(s.projected, true) + (g.due ? (s.projected <= g.due ? ', ' + h.plural(h.days(s.projected, g.due), 'day') + ' before the deadline.' : ', ' + h.plural(h.days(g.due, s.projected), 'day') + ' after the deadline.') : '.') : s.status === 'reached' ? 'Target reached.' : isValue ? 'Log a few readings to see your pace.' : 'Log some progress to see your pace.';
      return '<section class="g-pace"><svg role="img" aria-label="' + esc(label) + '" viewBox="0 0 340 200" width="100%">' +
        '<line x1="' + X0 + '" y1="' + Y1 + '" x2="' + X1 + '" y2="' + Y1 + '" stroke="#EEF1F5"/><line x1="' + X0 + '" y1="' + ((Y0 + Y1) / 2) + '" x2="' + X1 + '" y2="' + ((Y0 + Y1) / 2) + '" stroke="#EEF1F5"/><line x1="' + X0 + '" y1="' + Y0 + '" x2="' + X1 + '" y2="' + Y0 + '" stroke="#DDE1E8"/>' +
        '<text x="0" y="' + (Y1 + 4) + '" class="g-axis">' + esc(shortNum(hi)) + '</text><text x="0" y="' + ((Y0 + Y1) / 2 + 4) + '" class="g-axis">' + esc(shortNum((hi + lo) / 2)) + '</text><text x="0" y="' + (Y0 + 4) + '" class="g-axis">' + esc(shortNum(lo)) + '</text>' +
        plan + proj + '<polyline class="g-draw" pathLength="1" points="' + line + '" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<circle cx="' + x(g.status === 'active' ? t : (g.finished || t)).toFixed(1) + '" cy="' + y(s.total).toFixed(1) + '" r="6" fill="#fff" stroke="var(--accent)" stroke-width="3"/>' +
        '<text x="' + X0 + '" y="194" class="g-axis">' + esc(h.fmt(start)) + '</text><text x="' + ((X0 + X1) / 2) + '" y="194" class="g-axis" text-anchor="middle">' + esc(h.fmt(mid)) + '</text><text x="' + X1 + '" y="194" class="g-axis" text-anchor="end">' + esc(h.fmt(end)) + '</text></svg>' +
        '<div class="g-legend"><span><i class="done"></i>You</span>' + (g.due ? '<span><i class="plan"></i>Plan</span>' : '') + '</div>' +
        '<p class="settings-help" style="color:var(--ink-2)">' + esc(text) + '</p></section>';
    }
    function shortNum(n) { return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(Math.round(n * 10) / 10); }

    // ---------- settings ----------
    function settingsPanel() {
      return '<a class="row-card" href="#/goals/settings" style="margin-top:2px"><div style="min-width:0"><div class="t">Goals & habits settings</div><div class="s">Check-in time, when a goal counts as stalled</div></div>' + icon('chevron', 20) + '</a>';
    }
    function settingsScreen() {
      var st = settings();
      var out = '<main class="screen"><div class="top"><a class="icon-btn" href="#/settings" aria-label="Back to settings">' + icon('back', 20, 2.2) + '</a></div>' +
        '<div><h1 class="small">Goals & habits</h1><p class="settings-help" style="margin-top:6px">Saved in your Sheet on the Habits, Check-ins, Goals and Goal progress tabs.</p></div>';
      if (h.isDemo()) return out + '<p class="settings-help">Open the app from your Journeys server to change these. With sample data, everything stays on this device.</p></main>';
      var hours = [];
      for (var i = 0; i < 24; i++) hours.push(i);
      out += '<form id="g-settings-form" style="display:flex;flex-direction:column;gap:14px" novalidate><section class="panel"><h2>Reminders</h2>' +
        '<div class="field"><label for="g-hour">Evening check-in</label><select class="input" id="g-hour" name="checkinHour">' +
        hours.map(function (x) { return '<option value="' + x + '"' + (x === st.checkinHour ? ' selected' : '') + '>' + h.pad(x) + ':00</option>'; }).join('') + '</select>' +
        '<span class="field-note">Home Assistant asks about each habit that isn\'t done yet, with Done, Use a skip and In 1 hour buttons.</span></div>' +
        '<div class="field"><label for="g-stall">A goal is stalled after (days without progress)</label><input class="input" id="g-stall" name="goalStallDays" type="number" inputmode="numeric" min="2" max="365" value="' + esc(st.stallDays) + '">' +
        '<span class="field-note">Stalled goals get a nudge at the daily check hour, at most once a week.</span></div></section>' +
        '<p class="error-text" id="g-set-err" role="alert"></p><button class="btn" type="submit" style="flex:none">Save</button></form>';
      out += '<section class="panel"><h2>Home Assistant</h2>' +
        (st.ha ? '<p class="settings-help">To make the notification buttons work, add <code>homeassistant/journeys-goals.yaml</code> to Home Assistant (see the README). It also adds sensors for habits due and done today.</p>' +
          '<button class="btn secondary small" type="button" data-action="g-ha-check">Send check-ins now</button>'
          : '<p class="settings-help">Home Assistant isn\'t set up yet. Add its URL and notify service under Server settings, and HA_TOKEN in .env.</p>') + '</section>';
      return out + '</main>';
    }

    // ---------- sheets: add/edit habit or goal, log progress ----------
    function openForm(kind, editId) {
      var f = { addon: 'goals', key: kind + '|' + (editId || 'new'), form: kind, editId: editId || null };
      if (kind === 'habit') {
        var hb = editId ? habitById(editId) : null;
        Object.assign(f, hb ? { name: hb.name, schedule: hb.schedule, times: hb.times, days: (hb.days || []).slice(), skips: hb.skips, goalId: hb.goalId || '', reminder: hb.reminder }
          : { name: '', schedule: 'daily', times: 3, days: [1, 3, 5], skips: 1, goalId: '', reminder: true });
      } else if (kind === 'goal') {
        var g = editId ? goalById(editId) : null;
        Object.assign(f, g ? { name: g.name, measure: g.measure, target: String(g.target), startValue: g.measure === 'value' ? String(g.startValue) : '', unit: g.unit, started: g.started, due: g.due || '', habits: gs.data.habits.filter(function (x) { return x.goalId === g.id; }).map(function (x) { return x.id; }) }
          : { name: '', measure: 'number', target: '', startValue: '', unit: '', started: h.today(), due: '', habits: [] });
      } else if (kind === 'progress') {
        Object.assign(f, { goalId: editId, amount: '', date: h.today(), note: '' });
      }
      gs.menu = false;
      h.openSheet(f);
      setTimeout(function () { var el = document.getElementById(kind === 'progress' ? 'g-amount' : 'g-name'); if (el && !editId) el.focus(); else if (el && kind === 'progress') el.focus(); }, 60);
    }
    function sheetHtml(f) {
      if (f.form === 'progress') return progressSheet(f);
      var isHabit = f.form === 'habit', editing = !!f.editId;
      var out = '<div class="scrim" data-action="scrim"><form class="sheet" id="g-form" role="dialog" aria-modal="true" aria-labelledby="g-title" novalidate>' +
        '<div class="grab" aria-hidden="true"></div><div class="top"><h1 class="small" id="g-title" style="font-size:24px">' + (editing ? (isHabit ? 'Edit habit' : 'Edit goal') : 'New') + '</h1>' +
        '<button type="button" class="icon-btn soft" data-action="close-sheet" aria-label="Close">' + icon('close', 18, 2.4) + '</button></div>';
      if (!editing) {
        out += '<div class="seg" role="group" aria-label="What to add"><button type="button" class="seg-item" data-action="g-form-kind" data-v="habit" aria-current="' + (isHabit ? 'page' : 'false') + '">Habit</button>' +
          '<button type="button" class="seg-item" data-action="g-form-kind" data-v="goal" aria-current="' + (!isHabit ? 'page' : 'false') + '">Goal</button></div>';
      }
      out += isHabit ? habitFields(f) : goalFields(f);
      out += '<p class="error-text" id="g-err" role="alert"></p><button class="btn" type="submit" style="flex:none">' + (editing ? 'Save changes' : isHabit ? 'Add habit' : 'Add goal') + '</button></form></div>';
      return out;
    }
    function chip(action, v, on, label, extra) {
      return '<button type="button" class="chip accent" data-action="' + action + '" data-v="' + esc(v) + '" aria-pressed="' + !!on + '"' + (extra || '') + '>' + esc(label) + '</button>';
    }
    function habitFields(f) {
      var goals = gs.data.goals.filter(function (g) { return g.status === 'active' || g.id === f.goalId; });
      var out = '<div class="field"><label for="g-name">Habit</label><input class="input" id="g-name" name="name" autocomplete="off" placeholder="e.g. Read 20 min" value="' + esc(f.name) + '"></div>' +
        '<div class="field"><span class="label" id="g-often">How often?</span><div class="chips" role="group" aria-labelledby="g-often">' +
        chip('g-f-schedule', 'daily', f.schedule === 'daily', 'Every day') + chip('g-f-schedule', 'weekly', f.schedule === 'weekly', 'Times a week') + chip('g-f-schedule', 'days', f.schedule === 'days', 'Set days') + '</div>';
      if (f.schedule === 'weekly') {
        out += '<div class="g-stepper"><span>' + (f.times === 1 ? 'Once a week' : f.times + ' times a week') + '</span><div><button type="button" class="icon-btn" data-action="g-f-times" data-v="-1" aria-label="Fewer"' + (f.times <= 1 ? ' disabled' : '') + '>−</button>' +
          '<button type="button" class="icon-btn" data-action="g-f-times" data-v="1" aria-label="More"' + (f.times >= 7 ? ' disabled' : '') + '>+</button></div></div>';
      }
      if (f.schedule === 'days') {
        out += '<div class="chips g-days" role="group" aria-label="Days">' + WEEK_ORDER.map(function (d) { return chip('g-f-day', d, f.days.indexOf(d) >= 0, L.DAY_NAMES[d]); }).join('') + '</div>';
      }
      out += '</div>';
      if (f.schedule !== 'weekly') {
        out += '<div class="field"><span class="label" id="g-skips">Skips allowed each week</span><div class="chips" role="group" aria-labelledby="g-skips">' +
          [0, 1, 2, 3].map(function (n) { return chip('g-f-skips', n, f.skips === n, n === 0 ? 'None' : String(n)); }).join('') + '</div>' +
          '<span class="field-note">' + (f.skips ? 'Miss up to ' + h.plural(f.skips, 'day') + ' a week without breaking your streak.' : 'Any missed day breaks the streak.') + '</span></div>';
      }
      if (goals.length) {
        out += '<div class="field"><span class="label" id="g-toward">Counts toward a goal</span><div class="chips" role="group" aria-labelledby="g-toward">' +
          chip('g-f-goal', '', !f.goalId, 'None') + goals.map(function (g) { return chip('g-f-goal', g.id, f.goalId === g.id, g.name); }).join('') + '</div></div>';
      }
      out += '<div class="toggle-row"><label for="g-f-remind" style="flex:1"><span class="t">Evening reminder</span><span class="s">From Home Assistant, if it isn\'t done</span></label><input type="checkbox" role="switch" class="switch" id="g-f-remind" name="reminder"' + (f.reminder ? ' checked' : '') + '></div>';
      return out;
    }
    function goalFields(f) {
      var out = '<div class="field"><label for="g-name">Goal</label><input class="input" id="g-name" name="name" autocomplete="off" placeholder="e.g. Save $10k for a car" value="' + esc(f.name) + '"></div>';
      if (!f.editId) {
        out += '<div class="field"><span class="label" id="g-measure">Track it by</span><div class="chips" role="group" aria-labelledby="g-measure">' +
          chip('g-f-measure', 'number', f.measure === 'number', 'Adding up amounts') + chip('g-f-measure', 'value', f.measure === 'value', 'Reaching a number') +
          chip('g-f-measure', 'checkins', f.measure === 'checkins', 'Counting habit check-ins') + '</div>' +
          '<span class="field-note">' + esc({ number: 'Each entry adds to the total, like $500 saved or 1 book read.', value: 'Log readings as you go, like your weight, and move from where you are now to your goal.', checkins: 'Each check-in of a linked habit counts as 1.' }[f.measure]) + '</span></div>';
      }
      if (f.measure === 'value') {
        out += '<div class="g-two"><div class="field"><label for="g-startv">Now</label><input class="input" id="g-startv" name="startValue" inputmode="decimal" autocomplete="off" placeholder="200" value="' + esc(f.startValue) + '"></div>' +
          '<div class="field"><label for="g-target">Goal</label><input class="input" id="g-target" name="target" inputmode="decimal" autocomplete="off" placeholder="180" value="' + esc(f.target) + '"></div></div>' +
          '<div class="field"><label for="g-unit">Unit <span class="opt">(optional)</span></label><input class="input" id="g-unit" name="unit" autocomplete="off" placeholder="lbs, kg, minutes" value="' + esc(f.unit) + '"></div>';
      } else {
        out += '<div class="g-two"><div class="field"><label for="g-target">Target</label><input class="input" id="g-target" name="target" inputmode="decimal" autocomplete="off" placeholder="' + (f.measure === 'checkins' ? '50' : '10000') + '" value="' + esc(f.target) + '"></div>' +
          '<div class="field"><label for="g-unit">Unit <span class="opt">(optional)</span></label><input class="input" id="g-unit" name="unit" autocomplete="off" placeholder="' + (f.measure === 'checkins' ? 'times' : '$, books, km') + '" value="' + esc(f.unit) + '"></div></div>';
      }
      out += '<div class="g-two">' + (f.editId ? '' : '<div class="field"><label for="g-start">Start</label><input class="input" type="date" id="g-start" name="started" value="' + esc(f.started) + '" max="' + h.today() + '"></div>') +
        '<div class="field"><label for="g-due">Deadline <span class="opt">(optional)</span></label><input class="input" type="date" id="g-due" name="due" value="' + esc(f.due) + '"></div></div>';
      out += '<div id="g-preview" style="display:contents">' + goalPreview(f) + '</div>';
      if (f.measure === 'checkins') {
        var habits = gs.data.habits.filter(function (x) { return x.status !== 'archived'; });
        out += '<div class="field"><span class="label" id="g-from">Count check-ins from</span>' + (habits.length
          ? '<div class="chips" role="group" aria-labelledby="g-from">' + habits.map(function (x) { return chip('g-f-habit', x.id, f.habits.indexOf(x.id) >= 0, x.name); }).join('') + '</div>'
          : '<span class="field-note">Add a habit first, then link it here.</span>') + '</div>';
      } else {
        out += '<span class="field-note">You\'ll get a nudge if nothing moves for ' + h.plural(settings().stallDays, 'day') + '.</span>';
      }
      return out;
    }
    // Milestones and pace for the goal form; updated in place while you type.
    function goalPreview(f) {
      var out = '';
      var draft = { measure: f.measure, target: parseFloat(String(f.target).replace(/[,$€£₹\s]/g, '')), startValue: parseFloat(String(f.startValue).replace(/[,$€£₹\s]/g, '')),
        unit: (f.unit || '').trim(), started: f.editId ? goalById(f.editId).started : f.started, due: f.due };
      var ms = f.measure === 'value' && !isFinite(draft.startValue) ? [] : L.goalMilestones(draft);
      var pace = f.measure === 'checkins' || (f.measure === 'value' && !isFinite(draft.startValue)) ? null : L.goalPace(draft, function (x) { return h.fmt(x, true); });
      if (ms.length) {
        out += '<div class="field"><span class="label">Milestones</span><div class="result-list">' + ms.map(function (m) {
          return '<div class="result-row" style="padding:11px 14px"><span class="rl-body"><span class="rl-row"><span class="t" style="font-size:14px">' + esc(amt(m.value, f.unit)) + '</span><span class="s">by ' + esc(h.fmt(m.due, true)) + '</span></span></span></div>';
        }).join('') + '</div><span class="field-note">Split evenly. You can change them in the Goals tab of your Sheet.</span></div>';
      }
      if (pace) {
        out += '<div class="hint' + (pace.warn ? ' warn' : '') + '" role="' + (pace.warn ? 'alert' : 'status') + '" style="align-items:flex-start">' + icon('clock', 18) + '<span style="flex:1">' + esc(pace.text) +
          (pace.suggestedDue ? ' <button type="button" class="linkish" style="margin:0;font-size:13px" data-action="g-f-due" data-v="' + pace.suggestedDue + '">Use ' + esc(h.fmt(pace.suggestedDue, true)) + '</button>' : '') + '</span></div>';
      }
      return out;
    }
    function progressSheet(f) {
      var g = goalById(f.goalId);
      if (!g) return '';
      var isVal = g.measure === 'value', cur = isVal ? gstats(g).total : null;
      return '<div class="scrim" data-action="scrim"><form class="sheet" id="g-progress-form" role="dialog" aria-modal="true" aria-labelledby="g-title" novalidate>' +
        '<div class="grab" aria-hidden="true"></div><div class="top"><div><div class="eyebrow">' + esc(g.name) + '</div><h1 class="small" id="g-title" style="font-size:24px">' + (isVal ? 'Log a reading' : 'Log progress') + '</h1></div>' +
        '<button type="button" class="icon-btn soft" data-action="close-sheet" aria-label="Close">' + icon('close', 18, 2.4) + '</button></div>' +
        (isVal
          ? '<div class="field"><label for="g-amount">Reading' + (g.unit ? ' (' + esc(g.unit) + ')' : '') + '</label><input class="input" id="g-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="e.g. ' + esc(String(cur)) + '" value="' + esc(f.amount) + '">' +
            '<span class="field-note">Where you are now, like what the scale says. Last: ' + esc(amt(cur, g.unit)) + '. Goal: ' + esc(amt(g.target, g.unit)) + '.</span></div>'
          : '<div class="field"><label for="g-amount">How much' + (g.unit ? ' (' + esc(g.unit) + ')' : '') + '?</label><input class="input" id="g-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="e.g. ' + (g.unit === '$' ? '500' : '1') + '" value="' + esc(f.amount) + '">' +
            '<span class="field-note">Adds to your total. Use a minus to correct, like -200.</span></div>') +
        h.dateField('g-date', f.date) +
        '<div class="field"><label for="g-note">Note <span class="opt">(optional)</span></label><input class="input" id="g-note" name="note" autocomplete="off" value="' + esc(f.note) + '"></div>' +
        '<p class="error-text" id="g-err" role="alert"></p><button class="btn" type="submit" style="flex:none">Save</button></form></div>';
    }
    function readForm() {
      var f = h.sheet(), el = document.getElementById('g-form') || document.getElementById('g-progress-form');
      if (!f || f.addon !== 'goals' || !el) return f;
      ['name', 'target', 'startValue', 'unit', 'started', 'due', 'amount', 'date', 'note'].forEach(function (k) { if (el.elements[k]) f[k] = el.elements[k].value; });
      if (el.elements.reminder) f.reminder = el.elements.reminder.checked;
      return f;
    }
    function reform(fn) { var f = readForm(); fn(f); h.renderSheet(); }

    function submitForm(form) {
      var f = readForm(), err = document.getElementById('g-err');
      function fail(msg, field) { err.textContent = msg; if (field && form.elements[field]) form.elements[field].focus(); return true; }
      if (form.id === 'g-progress-form') {
        var a = parseFloat(String(f.amount).replace(/[,$€£₹\s]/g, ''));
        var g0 = goalById(f.goalId);
        if (g0.measure === 'value' ? !isFinite(a) || String(f.amount).trim() === '' : !isFinite(a) || !a) return fail(g0.measure === 'value' ? 'Enter the reading, like 196.4.' : 'Enter an amount, like 500.', 'amount');
        if (!h.validIso(f.date)) return fail('Pick a date.', 'date');
        var before = gstats(g0);
        mutate({ action: 'addProgress', id: h.uid('P'), goalId: f.goalId, amount: a, date: f.date, note: (f.note || '').trim() });
        h.closeSheet();
        var s0 = gstats(g0);
        var hitsBefore = before.milestones.filter(function (m) { return m.hit; }).length;
        var newHits = s0.milestones.filter(function (m) { return m.hit; });
        if (s0.status === 'reached' && before.status !== 'reached') { h.motion.confetti(); h.toast('Target reached! ' + L.goalProgressText(s0)); }
        else if (newHits.length > hitsBefore) {
          h.motion.burst(window.innerWidth / 2, window.innerHeight * 0.35, { count: 22, spread: 70 });
          h.toast('Milestone reached · ' + amt(newHits[newHits.length - 1].value, g0.unit));
        } else h.toast('Logged · ' + L.goalProgressText(s0));
        return true;
      }
      var name = (f.name || '').trim();
      if (f.form === 'habit') {
        if (!name) return fail('Give the habit a name.', 'name');
        if (f.schedule === 'days' && !f.days.length) return fail('Pick at least one day.');
        var hop = { name: name, schedule: f.schedule, times: f.times, days: f.days, skips: f.schedule === 'weekly' ? 0 : f.skips, goalId: f.goalId || '', reminder: !!f.reminder };
        if (f.editId) mutate(Object.assign({ action: 'updateHabit', id: f.editId }, hop));
        else { hop.id = h.uid('H'); mutate(Object.assign({ action: 'addHabit' }, hop)); }
        h.closeSheet();
        h.toast(f.editId ? 'Habit updated' : 'Habit added');
        return true;
      }
      var target = parseFloat(String(f.target).replace(/[,$€£₹\s]/g, ''));
      if (!name) return fail('Give the goal a name.', 'name');
      var startValue = parseFloat(String(f.startValue).replace(/[,$€£₹\s]/g, ''));
      if (f.measure === 'value') {
        if (!isFinite(startValue)) return fail('Enter where you are now, like 200.', 'startValue');
        if (!isFinite(target)) return fail('Enter your goal, like 180.', 'target');
        if (target === startValue) return fail('Your goal must be different from where you are now.', 'target');
      } else if (!(target > 0)) return fail('Enter a target, like 10000.', 'target');
      var startD = f.editId ? goalById(f.editId).started : f.started;
      if (!h.validIso(startD)) return fail('Pick a start date.', 'started');
      if (f.due && (!h.validIso(f.due) || f.due <= startD)) return fail('The deadline must be after the start.', 'due');
      var unit = (f.unit || '').trim() || (f.measure === 'checkins' ? 'times' : '');
      var id = f.editId || h.uid('G');
      var vals = f.measure === 'value' ? { startValue: startValue } : {};
      if (f.editId) mutate(Object.assign({ action: 'updateGoal', id: id, name: name, target: target, unit: unit, due: f.due || '' }, vals));
      else mutate(Object.assign({ action: 'addGoal', id: id, name: name, measure: f.measure, target: target, unit: unit, started: startD, due: f.due || '' }, vals));
      if (f.measure === 'checkins') {
        gs.data.habits.forEach(function (x) {
          var want = f.habits.indexOf(x.id) >= 0;
          if (want && x.goalId !== id) mutate({ action: 'updateHabit', id: x.id, goalId: id });
          if (!want && x.goalId === id) mutate({ action: 'updateHabit', id: x.id, goalId: '' });
        });
      }
      h.closeSheet();
      if (!f.editId) h.go('#/goals/g/' + id);
      h.toast(f.editId ? 'Goal updated' : 'Goal added');
      return true;
    }

    // ---------- actions ----------
    var actions = {
      'g-new': function (el) { openForm(el.dataset.v === 'goal' ? 'goal' : 'habit'); },
      'g-form-kind': function (el) { var f = readForm(); var name = f.name; openForm(el.dataset.v); var n = h.sheet(); n.name = name; h.renderSheet(); },
      'g-f-schedule': function (el) { reform(function (f) { f.schedule = el.dataset.v; }); },
      'g-f-times': function (el) { reform(function (f) { f.times = Math.min(7, Math.max(1, f.times + Number(el.dataset.v))); }); },
      'g-f-day': function (el) { reform(function (f) { var d = +el.dataset.v, i = f.days.indexOf(d); if (i >= 0) f.days.splice(i, 1); else f.days.push(d); f.days.sort(); }); },
      'g-f-skips': function (el) { reform(function (f) { f.skips = +el.dataset.v; }); },
      'g-f-goal': function (el) { reform(function (f) { f.goalId = el.dataset.v; }); },
      'g-f-measure': function (el) { reform(function (f) { f.measure = el.dataset.v; }); },
      'g-f-due': function (el) { reform(function (f) { f.due = el.dataset.v; }); },
      'g-f-habit': function (el) { reform(function (f) { var i = f.habits.indexOf(el.dataset.v); if (i >= 0) f.habits.splice(i, 1); else f.habits.push(el.dataset.v); }); },
      'g-check': function (el) {
        var hb = habitById(el.dataset.id), s = stats(hb), t = h.today();
        var to = s.doneToday ? 'none' : 'done';
        var where = el.getBoundingClientRect();
        var openBefore = dueOpen();
        gs.pop = to === 'done' ? hb.id : null;
        checkin(hb.id, t, to);
        if (to === 'done') {
          h.motion.burst(where.left + where.width / 2, where.top + where.height / 2);
          var after = stats(habitById(hb.id));
          if (openBefore > 0 && dueOpen() === 0) { h.motion.confetti(); h.toast('Everything done for today. Nice work!'); }
          else h.toast(after.weekTarget ? hb.name + ' · ' + after.weekDone + ' of ' + after.weekTarget + ' this week' : after.streak > 1 ? hb.name + ' · ' + after.streak + ' days in a row' : hb.name + ' · done');
        }
        setTimeout(function () { gs.pop = null; }, 600);
      },
      'g-day': function (el) {
        var hb = habitById(location.hash.split('/').pop());
        if (!hb) return;
        var date = el.dataset.v, cur = (gs.data.checkins.find(function (c) { return c.habitId === hb.id && c.date === date; }) || {}).result || 'none';
        var next = el.dataset.set || (hb.schedule === 'weekly' ? (cur === 'done' ? 'none' : 'done') : { none: 'done', done: 'skip', skip: 'none' }[cur]);
        if (next === 'done') h.motion.burstAt(el, el.dataset.set ? null : { count: 10, spread: 24 });
        gs.pop = hb.id + '|' + date;
        checkin(hb.id, date, next);
        setTimeout(function () { gs.pop = null; }, 600);
      },
      'g-month': function (el) {
        var m = gs.month, n = m.m + Number(el.dataset.v);
        m.y += Math.floor(n / 12); m.m = ((n % 12) + 12) % 12;
        h.motion.enter();
        h.render();
      },
      'g-menu': function () { gs.menu = !gs.menu; h.render(); },
      'g-edit-habit': function (el) { openForm('habit', el.dataset.id); },
      'g-edit-goal': function (el) { openForm('goal', el.dataset.id); },
      'g-archive': function (el) {
        var hb = habitById(el.dataset.id); gs.menu = false;
        mutate({ action: 'updateHabit', id: hb.id, status: hb.status === 'archived' ? 'active' : 'archived' });
        h.toast(hb.status === 'archived' ? 'Archived. Its history stays.' : 'Back on your list');
      },
      'g-delete-habit': function (el) {
        var hb = habitById(el.dataset.id); gs.menu = false;
        if (!window.confirm('Delete "' + hb.name + '" and all its check-ins? This also removes them from your Sheet. To keep the history, archive it instead.')) { h.render(); return; }
        mutate({ action: 'deleteHabit', id: hb.id }); h.go('#/goals'); h.toast('Habit deleted');
      },
      'g-goal-status': function (el) {
        var g = goalById(el.dataset.id), v = el.dataset.v; gs.menu = false;
        mutate({ action: 'updateGoal', id: g.id, status: v });
        if (v === 'achieved') h.motion.confetti();
        h.toast(v === 'achieved' ? 'Goal achieved. Nice work.' : v === 'abandoned' ? 'Goal abandoned' : 'Goal reopened');
      },
      'g-delete-goal': function (el) {
        var g = goalById(el.dataset.id); gs.menu = false;
        if (!window.confirm('Delete "' + g.name + '" and its progress? This also removes them from your Sheet.')) { h.render(); return; }
        mutate({ action: 'deleteGoal', id: g.id }); h.go('#/goals'); h.toast('Goal deleted');
      },
      'g-view': function (el) { gs.view = el.dataset.v; h.motion.enter(); h.render(); },
      'g-log': function (el) { openForm('progress', el.dataset.id); },
      'g-del-entry': function (el) {
        var p = gs.data.progress.find(function (x) { return x.id === el.dataset.id; });
        if (!p) return;
        var g = goalById(p.goalId);
        if (!window.confirm('Delete ' + (p.amount > 0 ? '+' : '') + amt(p.amount, g ? g.unit : '') + ' from ' + h.fmt(p.date) + '?')) return;
        mutate({ action: 'deleteProgress', id: p.id }); h.toast('Entry deleted');
      },
      'g-show-archived': function () { gs.showArchived = !gs.showArchived; h.render(); },
      'g-ha-check': function (el) {
        h.haCall(el, 'api/goals/ha/check', function (p) {
          var parts = [];
          if (p.sent.length) parts.push('Asked about ' + p.sent.join(', '));
          if (p.stalled.length) parts.push('nudged ' + p.stalled.join(', '));
          return parts.length ? parts.join('; ') : 'Nothing open: every habit is done and no goal is stalled';
        });
      }
    };

    function onSubmit(form) {
      if (form.id === 'g-form' || form.id === 'g-progress-form') return submitForm(form);
      if (form.id === 'g-settings-form') {
        var errEl = document.getElementById('g-set-err'), btn = form.querySelector('[type=submit]');
        errEl.textContent = '';
        btn.disabled = true; btn.textContent = 'Saving…';
        h.settingsCall('POST', { values: { checkinHour: form.elements.checkinHour.value, goalStallDays: form.elements.goalStallDays.value } }).then(function (p) {
          gs.data.settings = Object.assign({}, settings(), { checkinHour: p.values.checkinHour, stallDays: p.values.goalStallDays });
          save(); h.toast('Saved'); h.render();
        }, function (e) { errEl.textContent = e.message; btn.disabled = false; btn.textContent = 'Save'; });
        return true;
      }
      return false;
    }
    function onInput(t) {
      if (t.form && (t.form.id === 'g-form' || t.form.id === 'g-progress-form')) {
        readForm();
        if (t.id === 'g-target' || t.id === 'g-startv' || t.id === 'g-due' || t.id === 'g-start' || t.id === 'g-unit') {
          // milestone preview depends on these; redraw the sheet (focus is kept)
          clearTimeout(onInput.timer);
          onInput.timer = setTimeout(function () {
            var f = readForm(), box = document.getElementById('g-preview');
            if (f && box && f.form === 'goal') box.innerHTML = goalPreview(f); // only the preview, never the fields being typed in
          }, 250);
        }
        if (t.id === 'g-date') document.querySelectorAll('[data-action="set-date"][data-for="g-date"]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.v === t.value)); });
      }
    }
    // Reminder switch on the habit screen.
    document.addEventListener('change', function (ev) {
      var id = ev.target.dataset && ev.target.dataset.gRemind;
      if (id) { mutate({ action: 'updateHabit', id: id, reminder: ev.target.checked }); h.toast(ev.target.checked ? 'Reminder on' : 'Reminder off'); }
    });
    // Close this add-on's menu on any outside click.
    document.addEventListener('click', function (ev) {
      if (!gs.menu) return;
      var el = ev.target.closest('[data-action]');
      if (el && /^g-(menu|edit-|archive|delete-|goal-status)/.test(el.dataset.action)) return;
      gs.menu = false; h.render();
    }, true);
    window.addEventListener('hashchange', function () { gs.menu = false; });
    window.addEventListener('online', function () { sync(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sync();
      else if (gs.outbox.length && soonTimer) sync(); // leaving the app: send queued taps now
    });

    J.register({
      id: 'goals',
      tab: { id: 'goals', href: '#/goals', icon: 'target', label: 'Goals' },
      route: route, screen: screen, actions: actions, sheet: sheetHtml,
      onSubmit: onSubmit, onInput: onInput, settingsPanel: settingsPanel,
      start: function () { sync(); setTimeout(function () { if (gs.status === 'idle') sync(); }, 1500); }
    });
  }
})();
