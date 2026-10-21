/*
 * MCP (Model Context Protocol) endpoint for Journeys, so AI assistants such as Claude can
 * read and update your journeys. Streamable HTTP transport, JSON responses, no sessions.
 * Spec: https://modelcontextprotocol.io/specification
 */
'use strict';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const INSTRUCTIONS = [
  'Journeys tracks life events as journeys made of dated steps (e.g. a job application: Applied → Interview → Offer letter → Joined).',
  'Each step has a date; the useful facts are usually the days between steps and how long the current step has been waiting.',
  'Use list_journeys to find a journey, then get_journey for its steps. Journeys can be referred to by id or by name.',
  'Dates are YYYY-MM-DD; "today" and "yesterday" are also accepted. Mark the final step with final=true to complete a journey.',
  'Changes are saved to the user\'s Google Sheet immediately, so confirm with the user before deleting anything.'
].join(' ');

const RPC = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 };

module.exports = function createMcp(x) {
  const { VERSION, ensureSetup, readAll, writeAll, apply, exclusive, stepsOf, history, journeyStatus, days, today, validIso, addDays, userError, AppError, sheetUrl } = x;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // ---------- helpers ----------
  function parseDate(v, field) {
    if (v == null || v === '') return today();
    const s = String(v).trim().toLowerCase();
    if (s === 'today') return today();
    if (s === 'yesterday') return addDays(today(), -1);
    if (validIso(s)) return s;
    throw userError(`${field || 'Date'} must be YYYY-MM-DD, "today" or "yesterday".`);
  }
  // Find a journey by id, exact name, or a unique part of its name.
  function findJourney(d, ref) {
    const r = String(ref || '').trim();
    if (!r) throw userError('Say which journey (its id or name).');
    const byId = d.journeys.find((j) => j.id === r);
    if (byId) return byId;
    const low = r.toLowerCase();
    const exact = d.journeys.filter((j) => j.name.toLowerCase() === low);
    if (exact.length === 1) return exact[0];
    const part = exact.length ? exact : d.journeys.filter((j) => j.name.toLowerCase().includes(low));
    if (part.length === 1) return part[0];
    if (!part.length) throw userError(`No journey matches "${r}". Use list_journeys to see them.`);
    throw userError(`"${r}" matches several journeys: ${part.map((j) => `${j.name} (${j.id})`).join(', ')}. Use the id.`);
  }
  function journeyFacts(d, j, h, t) {
    const st = stepsOf(d, j.id);
    const first = st[0], last = st[st.length - 1];
    const done = j.status === 'Done';
    const s = !done && st.length ? journeyStatus(d, j, h, t) : null;
    return {
      id: j.id, name: j.name, type: j.type || 'Other', status: done ? 'done' : 'active',
      steps: st.length,
      started: first ? first.date : null,
      current_step: last ? last.step : null,
      current_step_date: last ? last.date : null,
      days_so_far: first ? (done ? days(first.date, last.date) : Math.max(0, days(first.date, t))) : 0,
      days_since_last_step: last && !done ? Math.max(0, days(last.date, t)) : null,
      usual_days_for_current_step: s ? s.usual_days : null,
      waiting_longer_than_usual: s ? s.waiting : false,
      likely_next_step: s ? s.next_step : null
    };
  }
  function line(f) {
    const when = f.status === 'done'
      ? `done, ${plural(f.days_so_far, 'day')} start to finish`
      : `Day ${f.days_so_far}, now: ${f.current_step || 'no steps'}${f.days_since_last_step != null ? ` (${f.days_since_last_step === 0 ? 'today' : plural(f.days_since_last_step, 'day') + ' ago'})` : ''}${f.waiting_longer_than_usual ? ' — waiting longer than usual' : ''}`;
    return `- ${f.name} [${f.type}] ${when}; ${plural(f.steps, 'step')}; id ${f.id}`;
  }
  function journeyDetail(d, j) {
    const t = today(), h = history(d);
    const f = journeyFacts(d, j, h, t);
    const st = stepsOf(d, j.id);
    const first = st[0];
    const steps = st.map((s, i) => ({
      id: s.id, step: s.step, date: s.date,
      day: first ? days(first.date, s.date) : 0,
      days_since_previous: i ? days(st[i - 1].date, s.date) : null,
      notes: s.notes || ''
    }));
    const text = [`${j.name} [${f.type}], ${f.status}. Started ${f.started || '—'}.`]
      .concat(steps.map((s) => `${s.date} · Day ${s.day} · ${s.step}${s.days_since_previous != null ? ` (+${s.days_since_previous}d)` : ''}${s.notes ? ' — ' + s.notes : ''}  [step id ${s.id}]`))
      .concat(f.status === 'active' && f.current_step
        ? [`Waiting ${plural(f.days_since_last_step, 'day')} on ${f.current_step}` +
           (f.usual_days_for_current_step != null ? `; usually ${plural(f.usual_days_for_current_step, 'day')}` : '') +
           (f.likely_next_step ? `; likely next: ${f.likely_next_step}` : '') + '.']
        : [])
      .join('\n');
    return { text, data: Object.assign(f, { steps_detail: steps }) };
  }
  async function change(body) {
    return exclusive(async () => {
      await ensureSetup();
      const d = await readAll();
      const result = apply(body, d);
      await writeAll(d);
      return { d, result };
    });
  }
  async function current() { await ensureSetup(); return readAll(); }

  // ---------- tools ----------
  const str = (description, extra) => Object.assign({ type: 'string', description }, extra || {});
  const DATE = str('YYYY-MM-DD, "today" or "yesterday". Defaults to today.');
  const JOURNEY = str('Journey id or name (a unique part of the name works too).');
  const RO = { readOnlyHint: true, openWorldHint: false };
  const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

  const tools = [
    {
      name: 'list_journeys', title: 'List journeys',
      description: 'List journeys with their current step, days so far, and days since the last step. Use this first to find a journey.',
      inputSchema: { type: 'object', properties: {
        status: str('Which journeys to include.', { enum: ['active', 'done', 'all'], default: 'all' }),
        type: str('Only this type, e.g. Job, Home, Documents, Travel, Health, Purchase, Other.'),
        query: str('Only journeys whose name contains this text.')
      }, additionalProperties: false },
      annotations: Object.assign({ title: 'List journeys' }, RO),
      async run(a) {
        const d = await current(), t = today(), h = history(d);
        let fs = d.journeys.map((j) => journeyFacts(d, j, h, t));
        const st = a.status || 'all';
        if (st !== 'all') fs = fs.filter((f) => f.status === st);
        if (a.type) fs = fs.filter((f) => f.type.toLowerCase() === String(a.type).toLowerCase());
        if (a.query) fs = fs.filter((f) => f.name.toLowerCase().includes(String(a.query).toLowerCase()));
        fs.sort((p, q) => (p.status === q.status ? (q.current_step_date || '').localeCompare(p.current_step_date || '') : p.status === 'active' ? -1 : 1));
        return { text: fs.length ? `${plural(fs.length, 'journey')} (today is ${t}):\n${fs.map(line).join('\n')}` : 'No journeys match.', data: { today: t, journeys: fs } };
      }
    },
    {
      name: 'get_journey', title: 'Get a journey',
      description: 'Get one journey with every step: date, day number, days since the previous step, notes and step ids. Also says how long the current step has been waiting and what usually comes next.',
      inputSchema: { type: 'object', properties: { journey: JOURNEY }, required: ['journey'], additionalProperties: false },
      annotations: Object.assign({ title: 'Get a journey' }, RO),
      async run(a) { const d = await current(); return journeyDetail(d, findJourney(d, a.journey)); }
    },
    {
      name: 'add_journey', title: 'Start a journey',
      description: 'Start a new journey with its first step.',
      inputSchema: { type: 'object', properties: {
        name: str('What the journey is, e.g. "Acme Corp" or "Passport renewal".'),
        type: str('Kind of journey.', { enum: ['Job', 'Home', 'Documents', 'Travel', 'Health', 'Purchase', 'Other'], default: 'Other' }),
        first_step: str('Name of the first step, e.g. "Applied". Defaults to "Started".'),
        date: DATE,
        notes: str('Optional notes for the first step.')
      }, required: ['name'], additionalProperties: false },
      annotations: Object.assign({ title: 'Start a journey' }, WRITE),
      async run(a) {
        const { d, result } = await change({ action: 'addJourney', name: a.name, type: a.type || 'Other', firstStep: a.first_step || 'Started', date: parseDate(a.date), notes: a.notes || '' });
        const j = d.journeys.find((x) => x.id === result.id);
        const out = journeyDetail(d, j);
        out.text = `Started "${j.name}".\n` + out.text;
        return out;
      }
    },
    {
      name: 'add_step', title: 'Add a step',
      description: 'Add a step to a journey (e.g. "Interview" today). Returns the journey with the days since the previous step. Set final=true if this step finishes the journey.',
      inputSchema: { type: 'object', properties: {
        journey: JOURNEY,
        step: str('What happened, e.g. "Interview".'),
        date: DATE,
        notes: str('Optional notes.'),
        final: { type: 'boolean', description: 'True if this is the last step; marks the journey done.', default: false }
      }, required: ['journey', 'step'], additionalProperties: false },
      annotations: Object.assign({ title: 'Add a step' }, WRITE),
      async run(a) {
        const date = parseDate(a.date);
        const { d, id } = await exclusive(async () => {
          await ensureSetup();
          const dd = await readAll();
          const jj = findJourney(dd, a.journey);
          apply({ action: 'addStep', journeyId: jj.id, step: a.step, date, notes: a.notes || '', final: !!a.final }, dd);
          await writeAll(dd);
          return { d: dd, id: jj.id };
        });
        const j = d.journeys.find((x) => x.id === id);
        const st = stepsOf(d, j.id);
        const idx = st.map((s) => s.step + '|' + s.date).lastIndexOf(`${String(a.step).trim()}|${date}`);
        const prev = idx > 0 ? st[idx - 1] : null;
        const out = journeyDetail(d, j);
        out.text = `Added "${String(a.step).trim()}" to ${j.name} on ${date}` +
          (prev ? `, ${plural(days(prev.date, date), 'day')} after ${prev.step}` : '') + (a.final ? '. Journey marked done.' : '.') + '\n' + out.text;
        return out;
      }
    },
    {
      name: 'update_step', title: 'Edit a step',
      description: 'Change a step\'s name, date or notes. Get the step id from get_journey.',
      inputSchema: { type: 'object', properties: {
        step_id: str('The step id from get_journey.'),
        step: str('New name.'),
        date: str('New date: YYYY-MM-DD, "today" or "yesterday".'),
        notes: str('New notes (replaces the old ones).')
      }, required: ['step_id'], additionalProperties: false },
      annotations: Object.assign({ title: 'Edit a step', idempotentHint: true }, WRITE),
      async run(a) {
        const body = { action: 'updateStep', id: a.step_id };
        if (a.step != null) body.step = a.step;
        if (a.date != null) body.date = parseDate(a.date);
        if (a.notes != null) body.notes = a.notes;
        const { d } = await change(body);
        const s = d.steps.find((x) => x.id === a.step_id);
        const out = journeyDetail(d, d.journeys.find((j) => j.id === s.journeyId));
        out.text = 'Step updated.\n' + out.text;
        return out;
      }
    },
    {
      name: 'delete_step', title: 'Delete a step',
      description: 'Delete one step. This also removes it from the Google Sheet; confirm with the user first.',
      inputSchema: { type: 'object', properties: { step_id: str('The step id from get_journey.') }, required: ['step_id'], additionalProperties: false },
      annotations: Object.assign({ title: 'Delete a step' }, DESTRUCTIVE),
      async run(a) {
        const before = await current();
        const s = before.steps.find((x) => x.id === a.step_id);
        if (!s) throw userError('No step with that id. Use get_journey to see step ids.');
        await change({ action: 'deleteStep', id: a.step_id });
        return { text: `Deleted "${s.step}" (${s.date}).`, data: { deleted: s } };
      }
    },
    {
      name: 'update_journey', title: 'Edit a journey',
      description: 'Rename a journey, change its type, or mark it done / reopen it.',
      inputSchema: { type: 'object', properties: {
        journey: JOURNEY,
        name: str('New name.'),
        type: str('New type.', { enum: ['Job', 'Home', 'Documents', 'Travel', 'Health', 'Purchase', 'Other'] }),
        status: str('done to finish it, active to reopen it.', { enum: ['active', 'done'] })
      }, required: ['journey'], additionalProperties: false },
      annotations: Object.assign({ title: 'Edit a journey', idempotentHint: true }, WRITE),
      async run(a) {
        const { d, id } = await exclusive(async () => {
          await ensureSetup();
          const dd = await readAll();
          const j = findJourney(dd, a.journey);
          const body = { action: 'updateJourney', id: j.id };
          if (a.name != null) body.name = a.name;
          if (a.type != null) body.type = a.type;
          if (a.status != null) body.status = a.status === 'done' ? 'Done' : 'Active';
          apply(body, dd);
          await writeAll(dd);
          return { d: dd, id: j.id };
        });
        const j = d.journeys.find((x) => x.id === id);
        const out = journeyDetail(d, j);
        out.text = 'Journey updated.\n' + out.text;
        return out;
      }
    },
    {
      name: 'delete_journey', title: 'Delete a journey',
      description: 'Delete a journey and all its steps. This also removes them from the Google Sheet; confirm with the user first.',
      inputSchema: { type: 'object', properties: { journey: JOURNEY }, required: ['journey'], additionalProperties: false },
      annotations: Object.assign({ title: 'Delete a journey' }, DESTRUCTIVE),
      async run(a) {
        const before = await current();
        const j = findJourney(before, a.journey);
        const n = before.steps.filter((s) => s.journeyId === j.id).length;
        await change({ action: 'deleteJourney', id: j.id });
        return { text: `Deleted "${j.name}" and its ${plural(n, 'step')}.`, data: { deleted: { id: j.id, name: j.name, steps: n } } };
      }
    },
    {
      name: 'get_insights', title: 'Insights',
      description: 'Patterns across all journeys: what is waiting longer than usual, the longest gaps between steps, average days between steps, and the typical day each step is reached for each journey type.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: Object.assign({ title: 'Insights' }, RO),
      async run() {
        const d = await current(), t = today(), h = history(d);
        const facts = d.journeys.map((j) => journeyFacts(d, j, h, t));
        const gaps = [];
        const reach = {};
        for (const j of d.journeys) {
          const st = stepsOf(d, j.id);
          st.forEach((s, i) => {
            if (i) gaps.push({ journey: j.name, from: st[i - 1].step, to: s.step, days: days(st[i - 1].date, s.date) });
            const k = `${j.type || 'Other'}|${s.step.trim().toLowerCase()}`;
            (reach[k] = reach[k] || { type: j.type || 'Other', step: s.step, days: [] }).days.push(days(st[0].date, s.date));
          });
        }
        const avg = gaps.length ? Math.round((gaps.reduce((p, g) => p + g.days, 0) / gaps.length) * 10) / 10 : null;
        const longest = gaps.slice().sort((p, q) => q.days - p.days).slice(0, 5);
        const typical = Object.values(reach).filter((r) => r.days.length > 1)
          .map((r) => ({ type: r.type, step: r.step, typical_day: Math.round(r.days.reduce((p, q) => p + q, 0) / r.days.length), times: r.days.length }))
          .sort((p, q) => p.type.localeCompare(q.type) || p.typical_day - q.typical_day);
        const waiting = facts.filter((f) => f.waiting_longer_than_usual);
        const data = {
          today: t,
          active: facts.filter((f) => f.status === 'active').length,
          done: facts.filter((f) => f.status === 'done').length,
          average_days_between_steps: avg,
          waiting_longer_than_usual: waiting,
          longest_gaps: longest,
          typical_day_reached: typical
        };
        const text = [
          `${data.active} active, ${data.done} done. Average ${avg == null ? '—' : avg} days between steps.`,
          waiting.length ? 'Waiting longer than usual:\n' + waiting.map(line).join('\n') : 'Nothing is waiting longer than usual.',
          longest.length ? 'Longest gaps:\n' + longest.map((g) => `- ${g.journey}: ${g.from} → ${g.to}, ${plural(g.days, 'day')}`).join('\n') : '',
          typical.length ? 'Typical day each step is reached:\n' + typical.map((r) => `- ${r.type} · ${r.step}: Day ${r.typical_day} (${r.times} times)`).join('\n') : ''
        ].filter(Boolean).join('\n\n');
        return { text, data };
      }
    }
  ];
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  // Light argument check against the schema: required fields, types, enums, no unknown keys.
  function checkArgs(tool, args) {
    if (args == null) args = {};
    if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
    const s = tool.inputSchema;
    for (const r of s.required || []) if (args[r] == null || args[r] === '') return `"${r}" is required`;
    for (const [k, v] of Object.entries(args)) {
      const p = s.properties[k];
      if (!p) return `unknown argument "${k}"`;
      if (v == null) continue;
      if (p.type === 'string' && typeof v !== 'string') return `"${k}" must be a string`;
      if (p.type === 'boolean' && typeof v !== 'boolean') return `"${k}" must be true or false`;
      if (p.enum && !p.enum.includes(v)) return `"${k}" must be one of: ${p.enum.join(', ')}`;
    }
    return null;
  }

  async function callTool(params) {
    const tool = byName[params && params.name];
    if (!tool) { const e = new Error(`Unknown tool: ${params && params.name}`); e.code = RPC.INVALID_PARAMS; throw e; }
    const bad = checkArgs(tool, params.arguments);
    if (bad) return { content: [{ type: 'text', text: `Invalid arguments: ${bad}.` }], isError: true };
    try {
      const { text, data } = await tool.run(params.arguments || {});
      return { content: [{ type: 'text', text }], structuredContent: data };
    } catch (err) {
      // Problems the assistant can act on go back as a tool result, not a protocol error.
      const msg = err instanceof AppError ? err.message : 'Something went wrong on the Journeys server. Check its logs.';
      if (!(err instanceof AppError)) console.error('[mcp]', err);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }

  // ---------- JSON-RPC ----------
  async function handleOne(msg) {
    const isRequest = msg && typeof msg === 'object' && msg.jsonrpc === '2.0' && typeof msg.method === 'string' && 'id' in msg && msg.id !== null;
    const isNotification = msg && typeof msg === 'object' && msg.jsonrpc === '2.0' && typeof msg.method === 'string' && !('id' in msg);
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...
    if (msg && typeof msg === 'object' && !('method' in msg) && ('result' in msg || 'error' in msg)) return null; // a response to us; we never ask
    if (!isRequest) return { jsonrpc: '2.0', id: (msg && msg.id) ?? null, error: { code: RPC.INVALID_REQUEST, message: 'Invalid request' } };
    const { id, method, params } = msg;
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      switch (method) {
        case 'initialize': {
          const asked = params && params.protocolVersion;
          return ok({
            protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'journeys', title: 'Journeys', version: VERSION },
            instructions: INSTRUCTIONS
          });
        }
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools: tools.map(({ run, ...t }) => t) });
        case 'tools/call': return ok(await callTool(params));
        case 'resources/list': return ok({ resources: [] });
        case 'prompts/list': return ok({ prompts: [] });
        default: return fail(RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (err) {
      return fail(err.code || RPC.INTERNAL, err.message || 'Internal error');
    }
  }

  // Handles one HTTP request to /mcp. `authorized` and `readBody` come from the main server.
  async function handleHttp(req, res, { authorized, readBody, allowedOrigins }) {
    const send = (status, obj, headers) => {
      res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, obj !== undefined ? { 'Content-Type': 'application/json' } : {}, headers || {}));
      res.end(obj !== undefined ? JSON.stringify(obj) : undefined);
    };
    // Block other websites from driving this endpoint through a browser (DNS rebinding).
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { /* bad origin */ }
      if (host !== req.headers.host && !allowedOrigins.includes(origin)) {
        return send(403, { jsonrpc: '2.0', id: null, error: { code: RPC.INVALID_REQUEST, message: 'Origin not allowed' } });
      }
    }
    if (!authorized(req)) {
      return send(401, { jsonrpc: '2.0', id: null, error: { code: RPC.INVALID_REQUEST, message: 'This Journeys server needs an access token: send "Authorization: Bearer <APP_TOKEN>".' } });
    }
    if (req.method === 'GET' || req.method === 'DELETE') return send(405, undefined, { Allow: 'POST' }); // no server-initiated stream, no sessions
    if (req.method !== 'POST') return send(405, undefined, { Allow: 'POST' });
    const pv = req.headers['mcp-protocol-version'];
    if (pv && !SUPPORTED_VERSIONS.includes(pv)) {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: RPC.INVALID_REQUEST, message: `Unsupported MCP-Protocol-Version: ${pv}` } });
    }
    let body;
    try { body = JSON.parse(await readBody(req, 256 * 1024)); } catch (e) {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: RPC.PARSE, message: 'Parse error' } });
    }
    if (Array.isArray(body)) { // batches (2025-03-26 clients)
      const out = (await Promise.all(body.map(handleOne))).filter(Boolean);
      return out.length ? send(200, out) : send(202);
    }
    const out = await handleOne(body);
    return out ? send(200, out) : send(202);
  }

  return { handleHttp, tools };
};
