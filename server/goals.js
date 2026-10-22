/*
 * Goals & habits add-on for the Journeys server.
 *
 * Everything for this feature lives here, in app/goals/ and in homeassistant/journeys-goals.yaml.
 * The core server only: merges `settings`, calls `init()`, forwards /api/goals* to `handle()`,
 * lists `addon()` in /api/health, adds `mcpTools()` to the MCP endpoint, and calls `start()`.
 * Turned off (the default), it does nothing: no Sheet tabs, no routes, no tools, no notifications.
 *
 * Sheet tabs (created the first time it's used): Habits, Check-ins, Goals, Goal progress.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');

const TABS = {
  habits: { title: 'Habits', headers: ['Habit ID', 'Habit', 'Schedule', 'Times a week', 'Days', 'Skips a week', 'Goal ID', 'Reminder', 'Created', 'Status', 'Last reminded'], dates: [8, 10] },
  checkins: { title: 'Check-ins', headers: ['Check-in ID', 'Habit ID', 'Habit', 'Date', 'Result', 'Source'], dates: [3] },
  goals: { title: 'Goals', headers: ['Goal ID', 'Goal', 'Measure', 'Target', 'Unit', 'Started', 'Due', 'Milestones', 'Status', 'Finished', 'Last nudged', 'Start value'], dates: [5, 6, 9, 10] },
  progress: { title: 'Goal progress', headers: ['Entry ID', 'Goal ID', 'Goal', 'Date', 'Amount', 'Total', 'Note'], dates: [3] }
};
const KEYS = Object.keys(TABS);
const SCHEDULES = { daily: 'Every day', weekly: 'Times a week', days: 'Set days' };
// number: amounts add up · checkins: counts linked habit check-ins · value: readings move from a start value to the target (e.g. weight)
const MEASURES = { number: 'Number', checkins: 'Check-ins', value: 'Reach a number' };
const GOAL_STATUS = { active: 'Active', achieved: 'Achieved', abandoned: 'Abandoned' };
const SOURCES = { app: 'App', ha: 'Home Assistant', mcp: 'AI assistant' };

const colLetter = (n) => String.fromCharCode(65 + n);
const quoted = (title) => `'${title.replace(/'/g, "''")}'`;
const idFrom = (map, v, def) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  for (const [id, label] of Object.entries(map)) if (s === id || s === label.toLowerCase()) return id;
  return def;
};
const truthy = (v) => v === true || /^(true|yes|on|1)$/i.test(String(v == null ? '' : v).trim());

// Settings this add-on adds to Settings → Server settings / .env. Merged into the core SETTINGS table.
function settings({ intIn, userError }) {
  const bool = (v) => {
    if (typeof v === 'boolean') return v;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (/^(true|yes|on|1)$/.test(s)) return true;
    if (/^(false|no|off|0|)$/.test(s)) return false;
    throw userError('Goals & habits must be on or off.');
  };
  return {
    goalsEnabled: { env: 'GOALS_ENABLED', def: false, parse: bool },
    checkinHour: { env: 'CHECKIN_HOUR', def: 21, parse: intIn('Check-in hour', 0, 23) },
    goalStallDays: { env: 'GOAL_STALL_DAYS', def: 14, parse: intIn('Stalled after', 2, 365) }
  };
}

function init(x) {
  const { conf, sheets, exclusive, today, validIso, toSerial, toIso, str, userError, AppError, haNotify, haEnabled, plural, days, addDays, sheetUrl, NUDGE_CHECK_MS, STATIC_DIR } = x;
  const L = require(path.join(STATIC_DIR, 'goals', 'logic.js'));
  const enabled = () => conf.goalsEnabled === true;
  const newId = (p) => p + crypto.randomBytes(5).toString('hex');
  const clean = (v, max) => str(v).trim().slice(0, max);
  const offError = () => new AppError('user', 'Goals & habits is turned off. Turn it on in Settings.');

  // ---------- Sheet ----------
  let setup = null;
  function ensureTabs() {
    if (!setup || setup.sheet !== conf.spreadsheetId) {
      const p = doSetup().catch((e) => { if (setup && setup.p === p) setup = null; throw e; });
      setup = { sheet: conf.spreadsheetId, p };
    }
    return setup.p;
  }
  async function doSetup() {
    const meta = await sheets('GET', '?fields=sheets.properties(sheetId,title)');
    const ids = {};
    (meta.sheets || []).forEach((s) => { ids[s.properties.title] = s.properties.sheetId; });
    const missing = KEYS.map((k) => TABS[k].title).filter((t) => ids[t] === undefined);
    if (missing.length) {
      const r = await sheets('POST', ':batchUpdate', {
        requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }))
      });
      r.replies.forEach((rep, i) => { ids[missing[i]] = rep.addSheet.properties.sheetId; });
    }
    const requests = [];
    for (const k of KEYS) {
      const t = TABS[k], sheetId = ids[t.title];
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: t.headers.length }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
      for (const c of t.dates) {
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } });
      }
    }
    await sheets('POST', ':batchUpdate', { requests });
    await sheets('POST', '/values:batchUpdate', {
      valueInputOption: 'RAW',
      data: KEYS.map((k) => ({ range: `${quoted(TABS[k].title)}!A1:${colLetter(TABS[k].headers.length - 1)}1`, values: [TABS[k].headers] }))
    });
    if (missing.length) console.log(`[goals] Sheet tabs created: ${missing.join(', ')}`);
  }

  async function read() {
    const q = KEYS.map((k) => `ranges=${encodeURIComponent(`${quoted(TABS[k].title)}!A2:${colLetter(TABS[k].headers.length - 1)}`)}`).join('&') +
      '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS';
    const r = await sheets('GET', `/values:batchGet?${q}`);
    const [hr, cr, gr, pr] = (r.valueRanges || []).map((v) => v.values || []);
    const hasId = (row) => row && row[0] != null && String(row[0]).trim() !== '';
    const num = (v, def) => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[,$€£₹\s]/g, '')); return isFinite(n) ? n : def; };
    const d = {
      rows: { habits: (hr || []).length, checkins: (cr || []).length, goals: (gr || []).length, progress: (pr || []).length },
      habits: (hr || []).filter(hasId).map((row) => {
        const schedule = idFrom(SCHEDULES, row[2], 'daily');
        return {
          id: String(row[0]).trim(), name: str(row[1]), schedule,
          times: Math.min(7, Math.max(1, Math.round(num(row[3], 3)))), days: L.normDays(row[4]),
          skips: Math.min(3, Math.max(0, Math.round(num(row[5], 0)))), goalId: str(row[6]).trim(),
          reminder: row[7] === '' || row[7] == null ? true : truthy(row[7]),
          created: toIso(row[8]), status: /^archived$/i.test(str(row[9]).trim()) ? 'archived' : 'active', lastReminded: toIso(row[10])
        };
      }),
      checkins: (cr || []).filter(hasId).map((row) => ({
        id: String(row[0]).trim(), habitId: str(row[1]).trim(), date: toIso(row[3]),
        result: /^skip/i.test(str(row[4]).trim()) ? 'skip' : 'done', source: idFrom(SOURCES, row[5], 'app')
      })).filter((c) => c.date),
      goals: (gr || []).filter(hasId).map((row) => ({
        id: String(row[0]).trim(), name: str(row[1]), measure: idFrom(MEASURES, row[2], 'number'),
        target: num(row[3], 0), unit: str(row[4]).trim(), started: toIso(row[5]), due: toIso(row[6]),
        milestones: L.parseMilestones(row[7]), status: idFrom(GOAL_STATUS, row[8], 'active'),
        finished: toIso(row[9]), lastNudged: toIso(row[10]), startValue: num(row[11], 0)
      })),
      progress: (pr || []).filter(hasId).map((row) => ({
        id: String(row[0]).trim(), goalId: str(row[1]).trim(), date: toIso(row[3]), amount: num(row[4], 0), note: str(row[6])
      })).filter((p) => p.date)
    };
    d.goals.forEach((g) => { if (!g.started) g.started = today(); });
    return d;
  }

  async function write(d) {
    const dc = (s) => (validIso(s) ? toSerial(s) : '');
    const hName = {}, gName = {};
    d.habits.forEach((h) => { hName[h.id] = h.name; });
    d.goals.forEach((g) => { gName[g.id] = g.name; });
    const byNameThenDate = (names, key) => (a, b) => (names[a[key]] || '').localeCompare(names[b[key]] || '') || a[key].localeCompare(b[key]) || a.date.localeCompare(b.date);
    const rows = {
      habits: d.habits.map((h) => [h.id, h.name, SCHEDULES[h.schedule], h.schedule === 'weekly' ? h.times : '', h.schedule === 'days' ? h.days.map((n) => L.DAY_NAMES[n]).join(', ') : '',
        h.schedule === 'weekly' ? '' : h.skips, h.goalId || '', !!h.reminder, dc(h.created), h.status === 'archived' ? 'Archived' : 'Active', dc(h.lastReminded)]),
      checkins: d.checkins.slice().sort(byNameThenDate(hName, 'habitId')).map((c) => [c.id, c.habitId, hName[c.habitId] || '', dc(c.date), c.result === 'skip' ? 'Skip' : 'Done', SOURCES[c.source] || 'App']),
      goals: d.goals.map((g) => [g.id, g.name, MEASURES[g.measure], g.target, g.unit || '', dc(g.started), dc(g.due), L.formatMilestones(g.milestones),
        GOAL_STATUS[g.status], dc(g.finished), dc(g.lastNudged), g.measure === 'value' ? g.startValue : '']),
      progress: []
    };
    let cur = null, total = 0;
    d.progress.slice().sort(byNameThenDate(gName, 'goalId')).forEach((p) => {
      if (p.goalId !== cur) { cur = p.goalId; total = 0; }
      const goal = d.goals.find((g) => g.id === p.goalId);
      total = goal && goal.measure === 'value' ? p.amount : Math.round((total + p.amount) * 100) / 100; // readings: the latest one
      rows.progress.push([p.id, p.goalId, gName[p.goalId] || '', dc(p.date), p.amount, total, p.note || '']);
    });
    const data = [];
    for (const k of KEYS) {
      const n = rows[k].length;
      while (rows[k].length < d.rows[k]) rows[k].push(Array(TABS[k].headers.length).fill(''));
      if (rows[k].length) data.push({ range: `${quoted(TABS[k].title)}!A2`, values: rows[k] });
      d.rows[k] = n;
    }
    if (data.length) await sheets('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data });
  }

  // ---------- changes ----------
  function findHabit(d, id) { const h = d.habits.find((x) => x.id === id); if (!h) throw userError('Habit not found.'); return h; }
  function findGoal(d, id) { const g = d.goals.find((x) => x.id === id); if (!g) throw userError('Goal not found.'); return g; }
  function dateOr(v, def) { if (v == null || v === '') return def; if (!validIso(v)) throw userError('Dates must look like 2026-01-31.'); return v; }
  function amount(v, label) {
    const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[,$€£₹\s]/g, ''));
    if (!isFinite(n)) throw userError(`${label} must be a number.`);
    return Math.round(n * 100) / 100;
  }
  function habitFields(h, b, isNew) {
    if (b.name != null || isNew) { const n = clean(b.name, 120); if (!n) throw userError('Habit needs a name.'); h.name = n; }
    if (b.schedule != null || isNew) {
      const s = idFrom(SCHEDULES, b.schedule, null);
      if (!s) throw userError('Schedule must be daily, weekly or days.');
      h.schedule = s;
    }
    if (b.times != null) { const t = Math.round(amount(b.times, 'Times a week')); if (t < 1 || t > 7) throw userError('Times a week must be 1 to 7.'); h.times = t; }
    if (b.days != null) h.days = L.normDays(b.days);
    if (b.skips != null) { const s = Math.round(amount(b.skips, 'Skips')); if (s < 0 || s > 3) throw userError('Skips a week must be 0 to 3.'); h.skips = s; }
    if (b.reminder != null) h.reminder = !!b.reminder;
    if (b.status != null) h.status = b.status === 'archived' ? 'archived' : 'active';
    if (h.schedule === 'days' && !(h.days || []).length) throw userError('Pick at least one day.');
  }

  function apply(b, d) {
    switch (b.action) {
      case 'addHabit': {
        const id = clean(b.id, 40) || newId('H');
        if (d.habits.some((h) => h.id === id)) return { id };
        const h = { id, times: 3, days: [], skips: 1, goalId: '', reminder: true, created: today(), status: 'active', lastReminded: '' };
        habitFields(h, b, true);
        if (b.goalId) h.goalId = findGoal(d, b.goalId).id;
        d.habits.push(h);
        return { id };
      }
      case 'updateHabit': {
        const h = findHabit(d, b.id);
        habitFields(h, b, false);
        if (b.goalId != null) h.goalId = b.goalId ? findGoal(d, b.goalId).id : '';
        return { id: h.id };
      }
      case 'deleteHabit':
        d.habits = d.habits.filter((h) => h.id !== b.id);
        d.checkins = d.checkins.filter((c) => c.habitId !== b.id);
        return { id: b.id };
      case 'checkin': {
        const h = findHabit(d, b.habitId);
        const date = dateOr(b.date, today());
        if (date > today()) throw userError("You can't check in for a day that hasn't happened yet.");
        const result = b.result === 'skip' ? 'skip' : b.result === 'none' ? 'none' : 'done';
        const existing = d.checkins.find((c) => c.habitId === h.id && c.date === date);
        if (result === 'none') { d.checkins = d.checkins.filter((c) => c !== existing); return { id: null }; }
        if (existing) { existing.result = result; existing.source = SOURCES[b.source] ? b.source : 'app'; return { id: existing.id }; }
        const id = clean(b.id, 40) || newId('C');
        d.checkins.push({ id, habitId: h.id, date, result, source: SOURCES[b.source] ? b.source : 'app' });
        return { id };
      }
      case 'addGoal': {
        const id = clean(b.id, 40) || newId('G');
        if (d.goals.some((g) => g.id === id)) return { id };
        const name = clean(b.name, 120);
        if (!name) throw userError('Goal needs a name.');
        const measure = idFrom(MEASURES, b.measure, 'number');
        const target = amount(b.target, 'Target');
        let startValue = 0;
        if (measure === 'value') {
          startValue = amount(b.startValue, 'Starting value');
          if (target === startValue) throw userError('The goal must be different from where you start.');
        } else if (!(target > 0)) throw userError('Target must be more than 0.');
        const started = dateOr(b.started, today());
        const due = dateOr(b.due, '');
        if (due && due <= started) throw userError('The deadline must be after the start.');
        const g = { id, name, measure, target, startValue, unit: clean(b.unit, 20) || (measure === 'checkins' ? 'times' : ''), started, due, milestones: [], status: 'active', finished: '', lastNudged: '' };
        g.milestones = Array.isArray(b.milestones) ? cleanMilestones(b.milestones) : L.goalMilestones(g);
        d.goals.push(g);
        return { id };
      }
      case 'updateGoal': {
        const g = findGoal(d, b.id);
        let reshape = false;
        if (b.name != null) { const n = clean(b.name, 120); if (!n) throw userError('Goal needs a name.'); g.name = n; }
        if (b.unit != null) g.unit = clean(b.unit, 20);
        if (b.target != null) { const t = amount(b.target, 'Target'); if (g.measure !== 'value' && !(t > 0)) throw userError('Target must be more than 0.'); g.target = t; reshape = true; }
        if (b.startValue != null && g.measure === 'value') { g.startValue = amount(b.startValue, 'Starting value'); reshape = true; }
        if (g.measure === 'value' && g.target === g.startValue) throw userError('The goal must be different from where you start.');
        if (b.due !== undefined) { g.due = dateOr(b.due, ''); if (g.due && g.due <= g.started) throw userError('The deadline must be after the start.'); reshape = true; }
        if (Array.isArray(b.milestones)) g.milestones = cleanMilestones(b.milestones);
        else if (reshape) g.milestones = L.goalMilestones(g);
        if (b.status != null) {
          const s = idFrom(GOAL_STATUS, b.status, null);
          if (!s) throw userError('Status must be active, achieved or abandoned.');
          g.status = s;
          g.finished = s === 'active' ? '' : dateOr(b.finished, today());
        }
        return { id: g.id };
      }
      case 'deleteGoal':
        d.goals = d.goals.filter((g) => g.id !== b.id);
        d.progress = d.progress.filter((p) => p.goalId !== b.id);
        d.habits.forEach((h) => { if (h.goalId === b.id) h.goalId = ''; });
        return { id: b.id };
      case 'addProgress': {
        const g = findGoal(d, b.goalId);
        if (g.measure === 'checkins') throw userError('This goal counts habit check-ins by itself.');
        const id = clean(b.id, 40) || newId('P');
        if (d.progress.some((p) => p.id === id)) return { id };
        const a = amount(b.amount, g.measure === 'value' ? 'Reading' : 'Amount');
        if (!a && g.measure !== 'value') throw userError('Amount can\'t be 0.');
        d.progress.push({ id, goalId: g.id, date: dateOr(b.date, today()), amount: a, note: clean(b.note, 500) });
        return { id };
      }
      case 'goalNudged': // "Not now" on a stalled-goal notification: don't ask again for a week
        findGoal(d, b.id).lastNudged = today();
        return { id: b.id };
      case 'deleteProgress':
        d.progress = d.progress.filter((p) => p.id !== b.id);
        return { id: b.id };
      default:
        throw userError(`Unknown action: ${b.action}`);
    }
  }
  function cleanMilestones(list) {
    return list.map((m) => ({ value: amount(m && m.value, 'Milestone'), due: dateOr(m && m.due, '') }))
      .filter((m) => m.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 24);
  }

  const view = (d) => ({
    habits: d.habits, checkins: d.checkins, goals: d.goals, progress: d.progress,
    settings: { checkinHour: conf.checkinHour, stallDays: conf.goalStallDays, ha: haEnabled() },
    sheetUrl: sheetUrl()
  });
  async function current() { if (!enabled()) throw offError(); await ensureTabs(); return read(); }
  async function change(body) {
    if (!enabled()) throw offError();
    await ensureTabs();
    return exclusive(async () => {
      const d = await read();
      const result = apply(body, d);
      await write(d);
      return { result, d };
    });
  }
  async function handleApi(body) {
    if (!body || typeof body.action !== 'string') throw userError('Missing action.');
    if (body.action === 'read') return { result: null, data: view(await current()) };
    const { result, d } = await change(body);
    return { result, data: view(d) };
  }

  // ---------- summaries (Home Assistant sensor, MCP) ----------
  function summary(d) {
    const t = today();
    const active = d.habits.filter((h) => h.status !== 'archived');
    const habits = active.map((h) => {
      const s = L.habitStats(h, d.checkins, t);
      return {
        id: h.id, name: h.name, schedule: s.schedule, due_today: s.dueToday, done_today: s.doneToday, skipped_today: s.skippedToday,
        streak: s.streak, best_streak: s.best, streak_unit: s.unit,
        this_week: s.weekTarget ? `${s.weekDone} of ${s.weekTarget}` : null, skips_left_this_week: s.skipsLeftThisWeek, goal_id: h.goalId || null
      };
    });
    const goals = d.goals.filter((g) => g.status === 'active').map((g) => goalFacts(d, g, t));
    return {
      habits_due: habits.filter((h) => h.due_today && !h.done_today && !h.skipped_today).length,
      habits_done: habits.filter((h) => h.done_today).length,
      habits_today: habits.filter((h) => h.due_today).length,
      goals_active: goals.length,
      goals_stalled: goals.filter((g) => g.status === 'stalled').length,
      updated: new Date().toISOString(),
      habits, goals
    };
  }
  function goalFacts(d, g, t) {
    const s = L.goalStats(g, d.progress, d.checkins, d.habits, t, conf.goalStallDays);
    return {
      id: g.id, name: g.name, measure: g.measure, progress: s.total, target: s.target, unit: s.unit, percent: s.pct,
      progress_text: L.goalProgressText(s), start_value: s.startValue,
      status: s.status, started: g.started, due: g.due || null, days_left: s.daysLeft, projected_finish: s.projected,
      last_progress: s.lastProgress, days_without_progress: s.quietDays,
      next_milestone: s.next ? { value: s.next.value, due: s.next.due } : null,
      milestones: s.milestones.map((m) => ({ value: m.value, due: m.due, reached: m.hit, days_early: m.early })),
      habits: d.habits.filter((h) => h.goalId === g.id).map((h) => h.name)
    };
  }

  // ---------- Home Assistant: evening check-ins and stalled-goal nudges ----------
  const later = new Map(); // habitId → time to ask again ("In 1 hour"); not kept across restarts
  function checkinMessage(d, h, s, t) {
    let msg;
    if (s.weekTarget) msg = `${s.weekDone} of ${s.weekTarget} this week.`;
    else if (s.streak > 1) msg = `You're on a ${s.streak}-day streak.`;
    else msg = 'Check in to keep it going.';
    const others = d.habits.filter((o) => o.id !== h.id && o.status !== 'archived').filter((o) => {
      const os = L.habitStats(o, d.checkins, t); return os.dueToday && !os.today;
    }).map((o) => o.name);
    if (others.length) msg += ` Still open: ${others.slice(0, 3).join(', ')}${others.length > 3 ? '…' : ''}.`;
    const actions = [{ action: `HABIT_DONE:${h.id}:${t}`, title: 'Done' }];
    if (s.skipsLeftThisWeek > 0) actions.push({ action: `HABIT_SKIP:${h.id}:${t}`, title: 'Use a skip' });
    actions.push({ action: `HABIT_LATER:${h.id}`, title: 'In 1 hour' });
    return { title: `${h.name}: done today?`, message: msg, data: { tag: `habit-${h.id}`, group: 'journeys-habits', actions } };
  }
  function openHabits(d, t) {
    return d.habits.filter((h) => h.status !== 'archived' && h.reminder).map((h) => ({ h, s: L.habitStats(h, d.checkins, t) }))
      .filter(({ s }) => s.dueToday && !s.today);
  }
  // force: send even if already reminded today ("Check now" in the app)
  async function sendReminders(force, onlyIds) {
    if (!enabled()) throw offError();
    await ensureTabs();
    return exclusive(async () => {
      const d = await read(), t = today(), sent = [];
      try {
        for (const { h, s } of openHabits(d, t)) {
          if (onlyIds && !onlyIds.includes(h.id)) continue;
          if (!force && !onlyIds && h.lastReminded === t) continue;
          await haNotify(checkinMessage(d, h, s, t));
          h.lastReminded = t;
          sent.push(h.name);
        }
      } finally { if (sent.length) await write(d); }
      return { sent };
    });
  }
  async function sendStallNudges() {
    if (!enabled()) throw offError();
    await ensureTabs();
    return exclusive(async () => {
      const d = await read(), t = today(), sent = [];
      try {
        for (const g of d.goals.filter((x) => x.status === 'active')) {
          const s = L.goalStats(g, d.progress, d.checkins, d.habits, t, conf.goalStallDays);
          if (s.status !== 'stalled') continue;
          if (validIso(g.lastNudged) && days(g.lastNudged, t) < 7) continue;
          const actions = [];
          if (g.measure === 'value') actions.push({ action: `GOAL_LOG:${g.id}`, title: 'Log a reading', behavior: 'textInput', textInputButtonTitle: 'Save', textInputPlaceholder: g.unit ? `Today's reading (${g.unit})` : "Today's reading" });
          else if (g.measure === 'number') actions.push({ action: `GOAL_LOG:${g.id}`, title: 'Log progress', behavior: 'textInput', textInputButtonTitle: 'Add', textInputPlaceholder: g.unit ? `How much? (${g.unit})` : 'How much?' });
          actions.push({ action: `GOAL_SNOOZE:${g.id}`, title: 'Not now' });
          const next = s.next ? ` Next milestone: ${L.formatAmount(s.next.value, s.unit)} by ${s.next.due}.` : '';
          await haNotify({ title: `"${g.name}" has stalled`, message: `No progress in ${plural(s.quietDays, 'day')}.${next}`, data: { tag: `goal-${g.id}`, group: 'journeys-goals', actions } });
          g.lastNudged = t;
          sent.push(g.name);
        }
      } finally { if (sent.length) await write(d); }
      return { sent };
    });
  }

  async function haAction(body) {
    if (!enabled()) throw offError();
    const m = /^(HABIT_DONE|HABIT_SKIP|HABIT_LATER|GOAL_LOG|GOAL_SNOOZE):([^:]+)(?::(\d{4}-\d{2}-\d{2}))?$/.exec(String((body && body.action) || ''));
    if (!m) throw userError('Unknown action.');
    const [, kind, id, date] = m;
    if (kind === 'HABIT_LATER') {
      later.set(id, Date.now() + 60 * 60 * 1000);
      return { askAgainAt: new Date(later.get(id)).toISOString() };
    }
    if (kind === 'GOAL_SNOOZE') {
      await change({ action: 'goalNudged', id });
      return { snoozed: true };
    }
    if (kind === 'GOAL_LOG') {
      const { result, d } = await change({ action: 'addProgress', goalId: id, amount: body.reply, date: today() });
      const g = d.goals.find((x) => x.id === id), s = L.goalStats(g, d.progress, d.checkins, d.habits, today(), conf.goalStallDays);
      haNotify({ title: g.name, message: `Logged. ${L.goalProgressText(s)}.`, data: { tag: `goal-${g.id}`, group: 'journeys-goals' } })
        .catch((e) => console.warn('[goals] confirmation not sent:', e.message));
      return result;
    }
    later.delete(id);
    const { result, d } = await change({ action: 'checkin', habitId: id, date: date || today(), result: kind === 'HABIT_SKIP' ? 'skip' : 'done', source: 'ha' });
    const h = d.habits.find((x) => x.id === id), s = L.habitStats(h, d.checkins, today());
    let msg;
    if (kind === 'HABIT_SKIP') msg = `Skip used. Streak kept at ${plural(s.streak, s.unit === 'weeks' ? 'week' : 'day')}.`;
    else if (s.weekTarget) msg = `Logged. ${s.weekDone} of ${s.weekTarget} this week.`;
    else msg = s.streak > 1 ? `Logged. ${s.streak} days in a row.` : 'Logged.';
    haNotify({ title: h.name, message: msg, data: { tag: `habit-${h.id}`, group: 'journeys-habits' } }).catch((e) => console.warn('[goals] confirmation not sent:', e.message));
    return result;
  }

  let lastCheckinDay = null, lastStallDay = null, ticking = false;
  function start() {
    if (enabled()) console.log(`Goals & habits on${haEnabled() ? `: check-ins at ${String(conf.checkinHour).padStart(2, '0')}:00` : ''}`);
    const tick = async () => {
      if (ticking || !enabled() || !haEnabled()) return;
      ticking = true;
      try {
        const t = today(), hour = new Date().getHours();
        const dueLater = [...later.entries()].filter(([, at]) => Date.now() >= at).map(([id]) => id);
        if (dueLater.length) { dueLater.forEach((id) => later.delete(id)); await sendReminders(true, dueLater).catch((e) => console.error(`[goals] ${e.message}`)); }
        if (hour >= conf.checkinHour && lastCheckinDay !== t) {
          lastCheckinDay = t;
          try { const r = await sendReminders(false); if (r.sent.length) console.log(`Check-ins sent: ${r.sent.join(', ')}`); } catch (e) { lastCheckinDay = null; console.error(`[goals] ${e.message}`); }
        }
        if (hour >= conf.nudgeHour && lastStallDay !== t) {
          lastStallDay = t;
          try { const r = await sendStallNudges(); if (r.sent.length) console.log(`Stalled-goal nudges sent: ${r.sent.join(', ')}`); } catch (e) { lastStallDay = null; console.error(`[goals] ${e.message}`); }
        }
      } finally { ticking = false; }
    };
    setInterval(tick, NUDGE_CHECK_MS).unref();
    setTimeout(tick, Math.min(6000, NUDGE_CHECK_MS)).unref();
  }

  // ---------- HTTP (already authorized by the core server) ----------
  async function handle(route, req, res, { readJson, sendJson }) {
    if (!enabled()) return sendJson(res, 404, { ok: false, error: 'Goals & habits is turned off. Turn it on in Settings.', kind: 'user' });
    if (route === 'POST /api/goals') return sendJson(res, 200, { ok: true, payload: await handleApi(await readJson(req)) });
    if (route === 'GET /api/goals/ha') return sendJson(res, 200, summary(await current()));
    if (route === 'POST /api/goals/ha/action') return sendJson(res, 200, { ok: true, payload: await haAction(await readJson(req)) });
    if (route === 'POST /api/goals/ha/check') {
      const r = await sendReminders(true);
      const g = await sendStallNudges();
      return sendJson(res, 200, { ok: true, payload: { sent: r.sent, stalled: g.sent } });
    }
    return sendJson(res, 404, { ok: false, error: 'Not found.', kind: 'user' });
  }

  function addon() {
    return {
      id: 'goals', name: 'Goals & habits', setting: 'goalsEnabled', enabled: enabled(),
      description: 'Habits with streaks, goals with milestones, and evening check-ins from Home Assistant.',
      script: 'goals/goals.js', style: 'goals/goals.css'
    };
  }

  // ---------- MCP tools (listed only while the add-on is on) ----------
  function mcpTools({ parseDate }) {
    const s = (description, extra) => Object.assign({ type: 'string', description }, extra || {});
    const RO = { readOnlyHint: true, openWorldHint: false };
    const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    const pick = (list, ref, what) => {
      const r = String(ref || '').trim(), low = r.toLowerCase();
      const hit = list.find((x) => x.id === r) || list.find((x) => x.name.toLowerCase() === low);
      if (hit) return hit;
      const part = list.filter((x) => x.name.toLowerCase().includes(low));
      if (part.length === 1) return part[0];
      if (!part.length) throw userError(`No ${what} matches "${r}".`);
      throw userError(`"${r}" matches several ${what}s: ${part.map((x) => `${x.name} (${x.id})`).join(', ')}. Use the id.`);
    };
    const habitLine = (h) => `- ${h.name} (${h.id}) · ${h.schedule} · ${h.done_today ? 'done today' : h.skipped_today ? 'skipped today' : h.due_today ? 'not done yet today' : 'not due today'} · streak ${h.streak} ${h.streak_unit}${h.this_week ? ` · ${h.this_week} this week` : ''}`;
    const goalLine = (g) => `- ${g.name} (${g.id}) · ${g.progress_text} (${g.percent}%) · ${g.status}${g.due ? ` · due ${g.due}` : ''}${g.projected_finish ? ` · projected ${g.projected_finish}` : ''}`;
    return [
      {
        name: 'list_habits', title: 'List habits',
        description: "Habits with today's check-in state, schedule, current and best streak. Use this before check_in.",
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: Object.assign({ title: 'List habits' }, RO),
        async run() { const sm = summary(await current()); return { text: sm.habits.length ? `${sm.habits_done} of ${sm.habits_today} due habits done today (${today()}):\n${sm.habits.map(habitLine).join('\n')}` : 'No habits yet.', data: { today: today(), habits: sm.habits } }; }
      },
      {
        name: 'check_in', title: 'Check in a habit',
        description: 'Mark a habit done (or skipped, or undo) for a day. One check-in per habit per day.',
        inputSchema: { type: 'object', properties: {
          habit: s('Habit id or name.'), date: s('YYYY-MM-DD, "today" or "yesterday". Defaults to today.'),
          result: s('done, skip (uses one of the week\'s allowed skips), or none to undo.', { enum: ['done', 'skip', 'none'], default: 'done' })
        }, required: ['habit'], additionalProperties: false },
        annotations: Object.assign({ title: 'Check in a habit' }, WRITE),
        async run(a) {
          const h = pick((await current()).habits, a.habit, 'habit');
          const { d } = await change({ action: 'checkin', habitId: h.id, date: parseDate(a.date), result: a.result || 'done', source: 'mcp' });
          const st = L.habitStats(d.habits.find((x) => x.id === h.id), d.checkins, today());
          return { text: `${h.name}: ${a.result === 'none' ? 'check-in removed' : a.result === 'skip' ? 'skipped' : 'done'}. Streak: ${st.streak} ${st.unit}${st.weekTarget ? `, ${st.weekDone} of ${st.weekTarget} this week` : ''}.`, data: { habit: h.id, streak: st.streak, unit: st.unit } };
        }
      },
      {
        name: 'add_habit', title: 'Add a habit',
        description: 'Create a habit to check in on.',
        inputSchema: { type: 'object', properties: {
          name: s('What to do, e.g. "Read 20 min".'),
          schedule: s('daily, weekly (a number of times a week), or days (set weekdays).', { enum: ['daily', 'weekly', 'days'], default: 'daily' }),
          times_a_week: { type: 'integer', description: 'For weekly: 1 to 7.', minimum: 1, maximum: 7 },
          days: s('For days: weekdays like "Mon, Wed, Fri".'),
          skips_a_week: { type: 'integer', description: 'For daily or days: missed days allowed each week before the streak breaks (0 to 3). Default 1.', minimum: 0, maximum: 3 },
          goal: s('Optional goal id or name this habit counts toward.')
        }, required: ['name'], additionalProperties: false },
        annotations: Object.assign({ title: 'Add a habit' }, WRITE),
        async run(a) {
          const d0 = await current();
          const goalId = a.goal ? pick(d0.goals, a.goal, 'goal').id : '';
          const { result } = await change({ action: 'addHabit', name: a.name, schedule: a.schedule || 'daily', times: a.times_a_week, days: a.days, skips: a.skips_a_week, goalId });
          return { text: `Added habit "${a.name}" (${result.id}).`, data: result };
        }
      },
      {
        name: 'list_goals', title: 'List goals',
        description: 'Goals with progress, status (ahead, on track, behind, stalled, reached, achieved, abandoned), deadline, projected finish and milestones.',
        inputSchema: { type: 'object', properties: { include_finished: { type: 'boolean', description: 'Also list achieved and abandoned goals.', default: false } }, additionalProperties: false },
        annotations: Object.assign({ title: 'List goals' }, RO),
        async run(a) {
          const d = await current(), t = today();
          const gs = d.goals.filter((g) => a.include_finished || g.status === 'active').map((g) => goalFacts(d, g, t));
          return { text: gs.length ? `${plural(gs.length, 'goal')} (today is ${t}):\n${gs.map(goalLine).join('\n')}` : 'No goals yet.', data: { today: t, goals: gs } };
        }
      },
      {
        name: 'add_goal', title: 'Add a goal',
        description: 'Create a goal with a target. With a deadline, it is split into 4 evenly spaced milestones. measure=checkins counts done check-ins of habits linked to it.',
        inputSchema: { type: 'object', properties: {
          name: s('The goal, e.g. "Save $10k for a car".'),
          target: { type: 'number', description: 'Target, e.g. 10000 to save, or 180 to reach that weight.' },
          start_value: { type: 'number', description: 'For measure=value: where you are now, e.g. 200 (current weight).' },
          unit: s('Unit, e.g. "$", "books", "km". Optional.'),
          due: s('Optional deadline, YYYY-MM-DD.'),
          measure: s('number (logged amounts add up), value (log readings that move from start_value to target, up or down, e.g. weight), or checkins (counts linked habit check-ins).', { enum: ['number', 'value', 'checkins'], default: 'number' })
        }, required: ['name', 'target'], additionalProperties: false },
        annotations: Object.assign({ title: 'Add a goal' }, WRITE),
        async run(a) {
          if (a.measure === 'value' && a.start_value == null) throw userError('For measure=value, give start_value (where you are now).');
          const { result, d } = await change({ action: 'addGoal', name: a.name, target: a.target, startValue: a.start_value, unit: a.unit, due: a.due ? parseDate(a.due, 'due') : '', measure: a.measure || 'number' });
          const f = goalFacts(d, d.goals.find((g) => g.id === result.id), today());
          const pace = L.goalPace(d.goals.find((g) => g.id === result.id));
          return { text: `Added goal "${f.name}" (${f.id}): ${f.progress_text}${f.milestones.length ? `. Milestones: ${f.milestones.map((m) => `${L.formatAmount(m.value, f.unit)} by ${m.due}`).join(', ')}` : ''}.${pace ? ' ' + pace.text : ''}`, data: f };
        }
      },
      {
        name: 'log_progress', title: 'Log goal progress',
        description: 'Add progress to a goal: for number goals an amount that adds up (500 toward savings, 1 book; negative to correct); for value goals the new reading (e.g. today\'s weight, 196.4).',
        inputSchema: { type: 'object', properties: {
          goal: s('Goal id or name.'), amount: { type: 'number', description: 'How much to add, or the new reading for value goals.' },
          date: s('YYYY-MM-DD, "today" or "yesterday". Defaults to today.'), note: s('Optional note.')
        }, required: ['goal', 'amount'], additionalProperties: false },
        annotations: Object.assign({ title: 'Log goal progress' }, WRITE),
        async run(a) {
          const g = pick((await current()).goals, a.goal, 'goal');
          const { d } = await change({ action: 'addProgress', goalId: g.id, amount: a.amount, date: parseDate(a.date), note: a.note || '' });
          const f = goalFacts(d, d.goals.find((x) => x.id === g.id), today());
          return { text: `${g.name}: ${f.progress_text} (${f.percent}%), ${f.status}.`, data: f };
        }
      },
      {
        name: 'update_goal', title: 'Finish or change a goal',
        description: 'Mark a goal achieved or abandoned (or active again), or change its target or deadline.',
        inputSchema: { type: 'object', properties: {
          goal: s('Goal id or name.'),
          status: s('New status.', { enum: ['active', 'achieved', 'abandoned'] }),
          target: { type: 'number', description: 'New target.' }, due: s('New deadline, YYYY-MM-DD.')
        }, required: ['goal'], additionalProperties: false },
        annotations: Object.assign({ title: 'Finish or change a goal' }, WRITE),
        async run(a) {
          const g = pick((await current()).goals, a.goal, 'goal');
          const body = { action: 'updateGoal', id: g.id };
          if (a.status) body.status = a.status;
          if (a.target != null) body.target = a.target;
          if (a.due) body.due = parseDate(a.due, 'due');
          const { d } = await change(body);
          const f = goalFacts(d, d.goals.find((x) => x.id === g.id), today());
          return { text: `${g.name}: ${f.status}, ${f.progress_text}.`, data: f };
        }
      }
    ];
  }

  return { enabled, handle, addon, start, mcpTools, apply, summary };
}

module.exports = { settings, init };
