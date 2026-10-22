/*
 * Goals & habits add-on: streaks, schedules and goal progress.
 * Shared by the app (loaded as a script) and the server (require), so both agree on the numbers.
 * Dates are YYYY-MM-DD strings. Weeks start on Monday.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoalsLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ---------- dates ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function utc(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function validIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(utc(s)); }
  function fromUtc(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(iso, n) { return fromUtc(utc(iso) + n * 86400000); }
  function days(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function weekday(iso) { return new Date(utc(iso)).getUTCDay(); } // 0 = Sunday
  function weekStart(iso) { return addDays(iso, -((weekday(iso) + 6) % 7)); }
  function minIso(a, b) { return !a ? b : !b ? a : a < b ? a : b; }

  // ---------- habits ----------
  // habit: { id, name, schedule: 'daily'|'weekly'|'days', times, days: [0..6], skips, goalId, reminder, created, status }
  // checkins: [{ habitId, date, result: 'done'|'skip' }]
  function normDays(v) {
    var list = Array.isArray(v) ? v : String(v || '').split(/[\s,]+/);
    var out = [];
    list.forEach(function (x) {
      var n = typeof x === 'number' ? x : DAY_NAMES.map(function (d) { return d.toLowerCase(); }).indexOf(String(x).trim().toLowerCase().slice(0, 3));
      if (n >= 0 && n <= 6 && out.indexOf(n) < 0) out.push(n);
    });
    return out.sort();
  }
  function scheduled(h, iso) {
    if (h.schedule === 'days') return (h.days || []).indexOf(weekday(iso)) >= 0;
    return true;
  }
  function scheduleLabel(h) {
    if (h.schedule === 'weekly') return h.times === 1 ? 'Once a week' : h.times + ' times a week';
    if (h.schedule === 'days') {
      var ds = h.days || [];
      if (ds.length === 5 && ds.join() === '1,2,3,4,5') return 'Weekdays';
      return ds.map(function (d) { return DAY_NAMES[d]; }).join(', ') || 'No days picked';
    }
    return 'Every day';
  }

  function byDateOf(checkins, habitId) {
    var m = {};
    (checkins || []).forEach(function (c) { if (c.habitId === habitId && validIso(c.date)) m[c.date] = c.result === 'skip' ? 'skip' : 'done'; });
    return m;
  }

  // Everything the screens, Home Assistant and MCP need about one habit.
  function habitStats(h, checkins, today) {
    var map = byDateOf(checkins, h.id);
    var dates = Object.keys(map).sort();
    var start = minIso(validIso(h.created) ? h.created : '', dates[0] || '') || today;
    if (start > today) start = today;
    var dayState = {}; // date → done | skip | forgiven | missed | off | open
    var cur = 0, best = 0, unit = h.schedule === 'weekly' ? 'weeks' : 'days';
    var thisWeek = weekStart(today);
    var weekDone = 0, weekSkipsUsed = 0;

    if (h.schedule === 'weekly') {
      var target = Math.max(1, h.times || 1);
      var counts = {};
      dates.forEach(function (d) { if (map[d] === 'done') { var w = weekStart(d); counts[w] = (counts[w] || 0) + 1; } });
      for (var w = weekStart(start); w <= thisWeek; w = addDays(w, 7)) {
        var n = counts[w] || 0;
        if (w === thisWeek) { if (n >= target) cur++; } // the current week only counts once it's met
        else if (n >= target) cur++;
        else cur = 0;
        if (cur > best) best = cur;
      }
      weekDone = counts[thisWeek] || 0;
      for (var d0 = start; d0 <= today; d0 = addDays(d0, 1)) dayState[d0] = map[d0] || 'off';
      return finish();
    }

    // daily / set days: a few skipped or missed days a week are allowed before the streak breaks
    var allowance = Math.max(0, h.skips || 0), used = {};
    for (var d = start; d <= today; d = addDays(d, 1)) {
      if (!scheduled(h, d)) { dayState[d] = map[d] === 'done' ? 'done' : 'off'; continue; }
      var s = map[d], wk = weekStart(d);
      if (s === 'done') { cur++; dayState[d] = 'done'; }
      else if (d === today && !s) { dayState[d] = 'open'; } // today isn't over yet
      else if ((used[wk] || 0) < allowance) { used[wk] = (used[wk] || 0) + 1; cur++; dayState[d] = s === 'skip' ? 'skip' : 'forgiven'; }
      else { cur = 0; dayState[d] = 'missed'; }
      if (cur > best) best = cur;
    }
    weekSkipsUsed = used[thisWeek] || 0;
    for (var dd = thisWeek; dd <= today; dd = addDays(dd, 1)) if (map[dd] === 'done') weekDone++;
    return finish();

    function finish() {
      var t = map[today] || null;
      var weekTarget = h.schedule === 'weekly' ? Math.max(1, h.times || 1) : null;
      var due = h.status !== 'archived' && (h.schedule === 'weekly' ? (weekDone < weekTarget || t === 'done') : scheduled(h, today));
      var monthKey = today.slice(0, 7), monthDone = 0, monthDays = 0;
      Object.keys(dayState).forEach(function (k) {
        if (k.slice(0, 7) !== monthKey) return;
        if (dayState[k] === 'done') monthDone++;
        if (h.schedule === 'weekly' ? false : dayState[k] !== 'off') monthDays++;
      });
      return {
        id: h.id, name: h.name, schedule: scheduleLabel(h),
        today: t, doneToday: t === 'done', skippedToday: t === 'skip', dueToday: due,
        streak: cur, best: Math.max(best, cur), unit: unit,
        weekDone: weekDone, weekTarget: weekTarget,
        skipsLeftThisWeek: h.schedule === 'weekly' ? 0 : Math.max(0, (h.skips || 0) - weekSkipsUsed),
        totalDone: dates.filter(function (k) { return map[k] === 'done'; }).length,
        monthDone: monthDone, monthDays: monthDays,
        started: start, dayState: dayState
      };
    }
  }

  // ---------- goals ----------
  // goal: { id, name, measure: 'number'|'checkins', target, unit, started, due, milestones: [{value, due}], status: 'active'|'achieved'|'abandoned', finished }
  // progress: [{ goalId, date, amount }]
  function evenMilestones(target, started, due, count) {
    if (!(target > 0) || !validIso(started) || !validIso(due) || due <= started) return [];
    var n = count || 4, span = days(started, due), out = [];
    for (var i = 1; i <= n; i++) {
      var v = target * i / n;
      v = target >= 20 ? Math.round(v) : Math.round(v * 10) / 10;
      out.push({ value: v, due: addDays(started, Math.round(span * i / n)) });
    }
    return out;
  }
  function parseMilestones(text) {
    return String(text || '').split(/[;\n]+/).map(function (part) {
      var m = /^\s*([\d.,]+)\s*@\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(part);
      return m ? { value: Number(m[1].replace(/,/g, '')), due: m[2] } : null;
    }).filter(function (x) { return x && isFinite(x.value) && validIso(x.due); })
      .sort(function (a, b) { return a.value - b.value; });
  }
  function formatMilestones(list) { return (list || []).map(function (m) { return m.value + '@' + m.due; }).join('; '); }

  function goalStats(g, progress, checkins, habits, today, stallDays) {
    var end = g.status !== 'active' && validIso(g.finished) ? g.finished : today;
    var events = [];
    if (g.measure === 'checkins') {
      var linked = (habits || []).filter(function (h) { return h.goalId === g.id; }).map(function (h) { return h.id; });
      (checkins || []).forEach(function (c) {
        if (linked.indexOf(c.habitId) >= 0 && c.result !== 'skip' && validIso(c.date) && c.date >= g.started && c.date <= end) events.push({ date: c.date, amount: 1 });
      });
    } else {
      (progress || []).forEach(function (p) { if (p.goalId === g.id && validIso(p.date)) events.push({ date: p.date, amount: Number(p.amount) || 0 }); });
    }
    events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var total = 0, series = [];
    events.forEach(function (e) {
      total += e.amount;
      if (series.length && series[series.length - 1].date === e.date) series[series.length - 1].total = total;
      else series.push({ date: e.date, total: total });
    });
    total = Math.round(total * 100) / 100;
    var target = Number(g.target) || 0;
    var ms = (g.milestones && g.milestones.length ? g.milestones : evenMilestones(target, g.started, g.due)).map(function (m) {
      var hit = null;
      for (var i = 0; i < series.length; i++) if (series[i].total >= m.value) { hit = series[i].date; break; }
      return { value: m.value, due: m.due, hit: hit, early: hit ? days(hit, m.due) : null, overdue: !hit && m.due < today };
    });
    var elapsed = Math.max(1, days(g.started, end));
    var rate = total / elapsed; // per day
    var reached = target > 0 && total >= target;
    var projected = !reached && rate > 0 && g.status === 'active' ? addDays(today, Math.ceil((target - total) / rate)) : null;
    var plan = null;
    if (validIso(g.due) && g.due > g.started) plan = target * Math.min(1, Math.max(0, days(g.started, today) / days(g.started, g.due)));
    var last = series.length ? series[series.length - 1].date : null;
    var quiet = days(last && last > g.started ? last : g.started, today);
    var status;
    if (g.status === 'achieved' || g.status === 'abandoned') status = g.status;
    else if (reached) status = 'reached';
    else if (stallDays && quiet >= stallDays) status = 'stalled';
    else if (plan == null) status = 'active';
    else if (total >= plan + target * 0.05) status = 'ahead';
    else if (total <= plan - target * 0.05) status = 'behind';
    else status = 'on track';
    var next = null;
    for (var k = 0; k < ms.length; k++) if (!ms[k].hit) { next = ms[k]; break; }
    return {
      id: g.id, name: g.name, total: total, target: target, unit: g.unit || '',
      pct: target > 0 ? Math.min(100, Math.round(total / target * 100)) : 0,
      status: status, plan: plan == null ? null : Math.round(plan * 100) / 100,
      projected: projected, daysLeft: validIso(g.due) ? days(today, g.due) : null,
      lastProgress: last, quietDays: quiet, perDay: rate,
      milestones: ms, next: next, series: series
    };
  }

  function formatAmount(n, unit) {
    var v = Math.round(Number(n) * 100) / 100;
    var s = Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);
    if (unit === '$' || unit === '€' || unit === '£' || unit === '₹') return (v < 0 ? '-' : '') + unit + s.replace(/^-/, '');
    if (unit && Math.abs(v) === 1 && /[^s]s$/.test(unit)) unit = unit.slice(0, -1); // 1 book, 1 km
    return unit ? s + ' ' + unit : s;
  }

  // "10 of 12 books", "$6,200 of $10,000"
  function progressText(total, target, unit) {
    var money = unit === '$' || unit === '€' || unit === '£' || unit === '₹';
    return money ? formatAmount(total, unit) + ' of ' + formatAmount(target, unit) : formatAmount(total, '') + ' of ' + formatAmount(target, unit);
  }

  return {
    progressText: progressText,
    DAY_NAMES: DAY_NAMES, validIso: validIso, addDays: addDays, days: days, weekday: weekday, weekStart: weekStart,
    normDays: normDays, scheduled: scheduled, scheduleLabel: scheduleLabel, habitStats: habitStats,
    evenMilestones: evenMilestones, parseMilestones: parseMilestones, formatMilestones: formatMilestones,
    goalStats: goalStats, formatAmount: formatAmount
  };
});
