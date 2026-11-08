import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL('workflow-src/' + name + '.js', root), 'utf8');
const common = read('common');
export const workflowIds = ['CLIngest00000001', 'CLDetect00000001', 'CLReview00000001', 'CLContext0000001', 'CLMonitor0000001'];
const dir = new URL('workflows/', root);
const env = "($env.CONTEXTLEDGER_INTERNAL_URL || 'http://127.0.0.1:5679')";
const key = '={{ $env.CONTEXTLEDGER_INTERNAL_KEY }}';
const ref = name => "$('" + name + "').first().json";
const expression = value => '={{ ' + value + ' }}';
const wrap = value => 'return [{ json: ' + value + ' }];';
const authorized = '$json.actor != null && !$json.denied';
const deny = wrap("$json.actor ? { httpCode: 403, payload: { status: 'denied' } } : { httpCode: 401, payload: { status: 'authentication_required' } }");
const authorization = name => ref(name) + '.headers?.authorization ?? null';
const ids = name => createHash('sha256').update(name).digest('hex').slice(0, 32).replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');

function workflow(file, index, title) {
  const id = workflowIds[index];
  const nodes = [];
  const connections = {};
  function node(name, type, typeVersion, position, parameters = {}, options = {}) {
    const namespace = type.includes('.') ? '' : 'n8n-nodes-base.';
    nodes.push({ parameters, id: ids(id + name), name, type: namespace + type, typeVersion, position, ...options });
    return name;
  }
  function link(from, to, output = 0) {
    connections[from] ??= { main: [[]] };
    connections[from].main[output] ??= [];
    connections[from].main[output].push({ node: to, type: 'main', index: 0 });
  }
  function line(...steps) {
    steps.slice(1).forEach((step, index) => link(steps[index], step));
  }
  return {
    node, link, line,
    note: (name, x, y, width, height, color, content) =>
      node(name, 'stickyNote', 1, [x, y], { content, width, height, color }),
    hook: (name, x, y, path, httpMethod = 'POST') =>
      node(name, 'webhook', 2, [x, y], { httpMethod, path: 'contextledger/' + path, responseMode: 'responseNode', options: {} },
        { webhookId: ids(id + path) }),
    code: (name, x, y, jsCode) => node(name, 'code', 2, [x, y], { jsCode }),
    logic: (name, x, y, sources, invocation) => node(name, 'code', 2, [x, y], {
      jsCode: [common, ...[].concat(sources).map(read), invocation].join('\n')
    }),
    check: (name, x, y, test) => node(name, 'if', 2.2, [x, y], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: ids(id + name + 'condition'), leftValue: expression(test), rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }, options: {}
    }),
    request(name, x, y, route, body, retry = false) {
      return node(name, 'httpRequest', 4.2, [x, y], {
        method: body ? 'POST' : 'GET', url: expression(env + " + '" + route + "'"),
        sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Ledger-Key', value: key }] },
        ...(body && { sendBody: true, specifyBody: 'json', jsonBody: expression('JSON.stringify(' + body + ')') }),
        options: { timeout: 3000 }
      }, retry ? { retryOnFail: true, maxTries: 3, waitBetweenTries: 750, onError: 'continueRegularOutput' } : {});
    },
    respond: (name, x, y) => node(name, 'respondToWebhook', 1.4, [x, y], {
      respondWith: 'json', responseBody: expression('JSON.stringify($json.payload)'),
      options: { responseCode: expression('$json.httpCode'),
        responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } }
    }),
    scan: (name, x, y) => node(name, 'executeWorkflow', 1.2, [x, y], {
      source: 'database', workflowId: { __rl: true, value: workflowIds[1], mode: 'id' },
      mode: 'once', options: { waitForSubWorkflow: true }
    }),
    save() {
      const definition = {
        id, name: 'ContextLedger · ' + title, active: false, nodes, connections,
        settings: {
          executionOrder: 'v1', timezone: 'UTC', saveDataErrorExecution: 'none',
          saveDataSuccessExecution: 'none', saveManualExecutions: false, callerPolicy: 'workflowsFromSameOwner'
        },
        pinData: {}, tags: []
      };
      writeFileSync(new URL(file + '.json', dir), JSON.stringify(definition, null, 2) + '\n');
    }
  };
}
const race = "{ httpCode: 409, payload: { status: 'state_changed', message: 'Refresh and retry.' } }";
const commitBody = (snapshot, plan) => '{ revision: ' + ref(snapshot) + '.revision, writes: ' + ref(plan) + '.writes }';
const committedPlan = plan => wrap('$json.committed ? ' + ref(plan) + ' : ' + race);

function ingestion() {
  const w = workflow('A-ingest', 0, 'A / Ingest source evidence');
  w.note('01 Access', 0, 0, 560, 330, 7, '## 01 · Operator gate\nResolve the bearer token server-side. Only the platform steward can fetch synthetic sources.');
  w.note('02 Adapters', 560, 0, 605, 330, 5, '## 02 · Read the three feeds\nEach request retries independently. A failed feed leaves its previous observations intact.');
  w.note('03 Commit', 1165, 0, 570, 330, 4, '## 03 · Normalize and commit\nValidate taxonomy, extract claims, deduplicate revisions and attest the seed baseline.');
  w.note('04 Scan', 1735, 0, 545, 330, 6, '## 04 · Detect drift\nCall B after durable ingestion. Review candidates never become authoritative here.');
  const input = w.hook('Run ingestion', 45, 160, 'ingest');
  const snapshot = w.request('Resolve admin and read ledger', 230, 160, '/snapshot', '{ authorization: ' + authorization(input) + ', adminOnly: true }');
  const gate = w.check('Admin verified?', 405, 160, authorized);
  const scenario = "' + encodeURIComponent(['revision','malformed','outage-slack','outage-notion','outage-operations'].includes(" +
    ref(input) + ".body?.scenario) ? " + ref(input) + ".body.scenario : '') + '";
  const feeds = ['slack', 'notion', 'operations'].map((system, index) => w.request(
    ['Fetch Slack messages', 'Fetch Notion pages', 'Fetch operations records'][index], 610 + index * 185, 160,
    '/feed/' + system + '?scenario=' + scenario, null, true));
  const adapterInputs = '{ slack: ' + ref(feeds[0]) + ', notion: ' + ref(feeds[1]) + ', operations: ' + ref(feeds[2]) + ' }';
  const plan = w.logic('Normalize, hash and validate', 1210, 160, 'ingest', wrap('ingest(' + ref(snapshot) + ', ' + adapterInputs + ')'));
  const commit = w.request('Commit source revisions', 1395, 160, '/commit', commitBody(snapshot, plan));
  const saved = w.check('Batch committed?', 1575, 160, '$json.committed === true');
  const scan = w.scan('Call B · detect drift', 1785, 140);
  const summary = w.code('Combine ingestion and scan', 1965, 140,
    'const result = ' + ref(plan) + '; return [{ json: { httpCode: $json.httpCode === 200 ? result.httpCode : 207, payload: { ...result.payload, scan: $json.payload } } }];');
  const conflict = w.code('Request safe retry', 1775, 370, wrap(race));
  const invalid = w.code('Deny source access', 625, 370, deny);
  const output = w.respond('Return ingestion summary', 2165, 160);
  w.line(input, snapshot, gate, ...feeds, plan, commit, saved, scan, summary, output);
  w.link(saved, conflict, 1);
  w.link(gate, invalid, 1);
  w.link(conflict, output);
  w.link(invalid, output);
  w.save();
}
function detection() {
  const w = workflow('B-detect', 1, 'B / Detect contradiction and drift');
  w.note('01 Compare', 0, 0, 650, 330, 5, '## 01 · Compare evidence with approved versions\nTreat recency and source authority as review context. Compare exact values and bind each request to an immutable evidence set.');
  w.note('02 Queue', 650, 0, 420, 330, 4, '## 02 · Open idempotent reviews\nReuse a case for the same evidence. Persist the queue entry and audit event in one transaction.');
  const trigger = w.node('Called by A or E', 'executeWorkflowTrigger', 1.1, [45, 165], { inputSource: 'passthrough' });
  const snapshot = w.request('Read current knowledge state', 245, 165, '/snapshot', '{ system: true }');
  const plan = w.logic('Compare claims and propose reviews', 455, 165, 'detect', wrap('detect($json)'));
  const commit = w.request('Commit reviews and audit', 700, 165, '/commit', commitBody(snapshot, plan));
  const output = w.code('Return scan results', 900, 165, committedPlan(plan));
  w.line(trigger, snapshot, plan, commit, output);
  w.save();
}
function governance() {
  const w = workflow('C-review', 2, 'C / Contributions and owner decisions');
  w.note('01 Requests', 0, 0, 550, 530, 7, '## 01 · Review Desk entry points\nList scoped cases, submit knowledge, or record a decision. Identity comes from a server-side token directory.');
  w.note('02 Policy', 550, 0, 400, 530, 5, '## 02 · Validate taxonomy and authority\nBind proposals to the current version and owner. A steward decides owner submissions.');
  w.note('03 Audit', 950, 0, 560, 530, 4, '## 03 · Commit evidence and audit\nSave proposals pending review. Approval alone appends a published version.');
  const list = w.hook('List review cases', 45, 155, 'reviews', 'GET');
  const contribution = w.hook('Submit a contribution', 45, 280, 'contribute');
  const action = w.hook('Submit reviewer decision', 45, 405, 'decision');
  const request = w.code('Read Review Desk request', 225, 280,
    wrap("{ ...$json, route: $json.webhookUrl.split('/').at(-1) }"));
  const snapshot = w.request('Resolve actor and state', 400, 280, '/snapshot', '{ authorization: ' + authorization(request) + ' }');
  const plan = w.logic('Validate contribution or decision', 595, 280, ['contribute', 'review'],
    wrap('viewReview($json, ' + ref(request) + '.body, ' + ref(request) + '.route)'));
  const hasWrites = w.check('Ledger write needed?', 770, 280, '$json.writes.length > 0');
  const commit = w.request('Commit proposal or decision', 995, 245, '/commit', commitBody(snapshot, plan));
  const result = w.code('Confirm committed outcome', 1160, 245, committedPlan(plan));
  const output = w.respond('Return Review Desk outcome', 1340, 300);
  w.line(list, request, snapshot, plan, hasWrites, commit, result, output);
  w.link(action, request);
  w.link(contribution, request);
  w.link(hasWrites, output, 1);
  w.save();
}
function retrieval() {
  const w = workflow('D-context', 3, 'D / Retrieve trusted context');
  w.note('01 Resolve identity', 0, 0, 450, 335, 7, '## 01 · Authenticate\nThe same endpoint serves the Review Desk, CLI and MCP tool.');
  w.note('02 Authorize and answer', 450, 0, 540, 335, 6, '## 02 · Filter before matching\nCheck source and version groups first. Match a taxonomy alias, verify freshness, then return cited context or abstain.');
  const input = w.hook('Ask a knowledge question', 50, 165, 'context');
  const snapshot = w.request('Resolve actor and read ledger', 245, 165, '/snapshot', '{ authorization: ' + authorization(input) + ' }');
  const result = w.logic('Authorize, match and cite', 495, 165, 'retrieve', wrap('retrieve($json, ' + ref(input) + '.body)'));
  const output = w.respond('Return trusted context', 755, 165);
  w.line(input, snapshot, result, output);
  w.save();
}
function monitoring() {
  const w = workflow('E-monitor', 4, 'E / Monitor knowledge quality');
  w.note('01 Trigger and gate', 0, 0, 735, 410, 7, '## 01 · Daily at 09:00 UTC or on demand\nA scheduled run acts as the steward. On-demand reports require admin access.');
  w.note('02 Refresh', 735, 0, 440, 410, 5, '## 02 · Check time-driven drift\nRe-scan for overdue approvals and refresh the snapshot after B commits its findings.');
  w.note('03 Report', 1175, 0, 885, 410, 4, '## 03 · Group actionable issues\nWrite a daily owner-grouped report and a deduplicated mock Slack outbox. Manual requests return the report.');
  const input = w.hook('Request report', 40, 150, 'monitor');
  const cron = w.node('Daily 09:00 UTC', 'scheduleTrigger', 1.2, [40, 290], { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * *' }] } });
  const manual = w.code('Read operator identity', 220, 150, wrap('{ authorization: $json.headers?.authorization ?? null, adminOnly: true }'));
  const schedule = w.code('Use scheduler identity', 220, 290, wrap('{ system: true }'));
  const snapshot = w.request('Verify operator', 405, 180, '/snapshot', '$json');
  const gate = w.check('Operator authorized?', 590, 180, authorized);
  const scan = w.scan('Call B · check revalidation', 780, 175);
  const fresh = w.request('Read post-scan state', 970, 175, '/snapshot', '$(' + "'Read operator identity'" + ').isExecuted ? ' + ref(manual) + ' : { system: true }');
  const plan = w.logic('Group issues and prepare outbox', 1220, 175, 'monitor', wrap('monitor($json)'));
  const commit = w.request('Persist report and reminders', 1405, 175, '/commit', commitBody(fresh, plan));
  const result = w.code('Return committed report', 1580, 175, committedPlan(plan));
  const manualCheck = w.check('Manual request?', 1760, 175, "$('Read operator identity').isExecuted");
  const output = w.respond('Return admin quality report', 1930, 155);
  const invalid = w.code('Deny report access', 800, 450, deny);
  w.line(input, manual, snapshot, gate, scan, fresh, plan, commit, result, manualCheck, output);
  w.line(cron, schedule, snapshot);
  w.link(gate, invalid, 1);
  w.link(invalid, output);
  w.save();
}

mkdirSync(dir, { recursive: true });
ingestion();
detection();
governance();
retrieval();
monitoring();
