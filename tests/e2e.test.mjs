import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { dependencyDir, root } from '../scripts/config.mjs';
import { startIsolatedRuntime } from './runtime.mjs';

const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const { claimCases, questions } = load('./labels.json');
const { records } = load('../data/northstar.json');
const requestEscalation = { question: 'What is the current escalation policy?' };
const digest = text => createHash('sha256').update(text).digest('hex');
const require = createRequire(join(dependencyDir, 'package.json'));
const passed = { claims: [], queries: [], citations: [], disclosures: [], turnaround_ms: [] };

test('published n8n workflows with an isolated Northstar ledger', { timeout: 360000 }, async t => {
  const { tokens, url, request } = await startIsolatedRuntime(t, 'e2e', 5688);
  async function run(path, who, input, expectedHttp = 200) {
    const response = await request(path, who, input);
    assert.equal(response.http, expectedHttp, JSON.stringify(response.body));
    return response.body;
  }
  const report = () => run('monitor', 'admin', {});
  const decide = (role, review, decision, extra = {}, http = 200) => run('decision', role, {
    review_id: review.id, decision, note: 'Test action recorded by the designated knowledge owner.', ...extra
  }, http);
  let conflict, refund, initial, stats;
  await t.test('01 ingests all three API formats through workflow A', async () => {
    initial = await run('ingest', 'admin', {});
    assert.equal(initial.status, 'ingested');
    assert.deepEqual(Object.fromEntries(Object.entries(initial.sources).map(([name, result]) => [name, result.inserted])),
      { slack: 8, notion: 17, operations: 12 });
  });
  await t.test('02 re-ingestion and cross-source dedup preserve immutable revisions', async () => {
    const repeated = await run('ingest', 'admin', {});
    assert.equal(Object.values(repeated.sources).reduce((sum, row) => sum + row.inserted, 0), 0);
    assert.equal(Object.values(repeated.sources).reduce((sum, row) => sum + row.unchanged, 0), records.length);
    stats = (await report()).counts;
    assert.equal(stats.latest_records, records.length);
    assert.equal(stats.duplicate_groups, 1);
    assert.equal(stats.duplicate_surplus_records, 1);
    assert.equal(repeated.scan.opened, 0);
  });
  await t.test('03 extracts metadata, quarantines bad scope and reports missing owner', async () => {
    const response = await run('ingest', 'admin', { scenario: 'malformed' });
    assert.equal(response.sources.operations.quarantined, 1);
    const quality = await report();
    const issues = quality.grouped.flatMap(group => group.issues);
    assert.ok(issues.some(issue => issue.kind === 'missing_owner' && issue.subject === 'Legacy warehouse export'));
    assert.ok(issues.some(issue => issue.kind === 'invalid_metadata' && issue.action.includes('classification_or_groups')));
    assert.equal(quality.counts.owned_records, records.length - 1);
    assert.equal(quality.counts.complete_records, records.length - 1);
  });
  await t.test('04 detects labelled contradictions, with timestamps, authority and exact quotations', async () => {
    const { reviews } = await run('reviews', 'admin');
    const matches = new Set(reviews.filter(row => row.kind === 'conflict')
      .map(row => row.topic + ':' + row.evidence.find(item => item.revision_id === row.candidate_id).source_document_id));
    for (const entry of claimCases) {
      const observed = matches.has(entry.topic + ':' + entry.candidate);
      passed.claims.push({ ...entry, observed });
      assert.equal(observed, entry.conflict, entry.candidate);
    }
    assert.equal(matches.size, 3);
    conflict = reviews.find(row => row.topic === 'customer-escalation');
    refund = reviews.find(row => row.topic === 'refund-approval');
    assert.deepEqual(conflict.evidence.map(row => row.claim.value), [24, 48, 24]);
    assert.deepEqual(conflict.evidence.map(row => row.authority_rank), [3, 1, 2]);
    assert.match(conflict.explanation, /unapproved source has a later edit time than the approved source \(authority rank 1 vs\. 3\)/);
    assert.match(conflict.proposed_action, /No automatic publication is permitted/);
    assert.ok(conflict.evidence.every(row => row.excerpt.includes(row.claim.quote)));
    const before = await run('context', 'employee', requestEscalation);
    assert.equal(before.authoritative_version, 1);
    assert.match(before.answer, /24 hours/);
    assert.deepEqual(before.unresolved_conflicts.map(row => row.kind), ['conflict']);
  });
  await t.test('05 forged reviewer and invalid bearer cannot publish or see the queue', async () => {
    const denied = await decide('employee', conflict, 'approve', { reviewer: 'support-owner', role: 'admin' }, 403);
    assert.deepEqual(denied, { status: 'denied' });
    assert.deepEqual((await run('reviews', 'employee')).reviews, []);
    assert.deepEqual(await run('context', 'bad-token', requestEscalation, 401), { status: 'authentication_required' });
    assert.equal((await run('context', 'employee', requestEscalation)).authoritative_version, 1);
    assert.ok((await report()).audit_tail.some(row => row.event === 'decision_denied' && row.actor === 'general-employee'));
  });
  await t.test('06 clarification stays open and owner approval appends v2', async () => {
    const clarification = await decide('support', conflict, 'clarify');
    assert.equal(clarification.status, 'clarification_requested');
    assert.equal((await run('context', 'employee', requestEscalation)).authoritative_version, 1);
    const input = { review_id: conflict.id, decision: 'approve', note: 'Concurrent replay of owner approval.' };
    const concurrent = await Promise.all([request('decision', 'support', input), request('decision', 'support', input)]);
    assert.deepEqual(concurrent.map(row => row.http).sort(), [200, 409]);
    const approval = concurrent.find(row => row.http === 200).body;
    assert.equal(approval.status, 'approved');
    assert.equal(approval.authoritative_version, 2);
    passed.turnaround_ms.push(Date.parse(approval.decided_at) - Date.parse(conflict.created_at));
    const duplicate = await decide('support', conflict, 'approve', {}, 409);
    assert.equal(duplicate.status, 'already_decided');
    const diff = await run('context', 'employee', { question: 'What changed in the escalation policy?' });
    assert.match(diff.answer, /24 hours[\s\S]*48 hours/);
    assert.deepEqual(diff.citations.map(item => item.source_document_id), ['support-decision', 'support-escalation']);
    const rescan = await run('ingest', 'admin', {});
    assert.ok(!rescan.scan.findings.some(row => row.topic === 'customer-escalation'));
    const quality = await report();
    assert.equal(quality.counts.authority_versions, stats.authority_versions + 1);
    assert.equal(quality.grouped.flatMap(group => group.issues).filter(issue => issue.kind === 'source_alignment').length, 2);
  });
  await t.test('07 rejection preserves the approved refund policy', async () => {
    const rejection = await decide('support', refund, 'reject');
    assert.equal(rejection.status, 'rejected');
    passed.turnaround_ms.push(Date.parse(rejection.decided_at) - Date.parse(refund.created_at));
    const result = await run('context', 'employee', { question: 'What is the refund threshold?' });
    assert.match(result.answer, /USD 250/);
    assert.equal(result.authoritative_version, 1);
  });
  await t.test('08 restricted retrieval, citations, queue and report enforce authorization', async () => {
    const unknown = await run('context', 'employee', { question: 'Who books flights to Mars?' });
    for (const who of ['employee', 'support']) {
      const restricted = await run('context', who, { question: 'Can I access the internal security runbook?' });
      passed.disclosures.push(JSON.stringify(restricted) !== JSON.stringify(unknown));
      assert.deepEqual(restricted, unknown);
    }
    const security = await run('context', 'security', { question: 'What does the security runbook say?' });
    assert.match(security.answer, /Quartz Vault/);
    assert.equal(security.citations[0].source_document_id, 'quartz-containment');
    assert.ok(!(await run('reviews', 'support')).reviews.some(row => row.department === 'Security'));
    assert.deepEqual(await run('monitor', 'support', {}, 403), { status: 'denied' });
  });
  await t.test('09 flags overdue approved knowledge and queues revalidation', async () => {
    const result = await run('context', 'security', { question: 'When was the access review last verified?' });
    assert.equal(result.status, 'stale');
    assert.deepEqual(result.citations, []);
    assert.ok((await run('reviews', 'security')).reviews.some(row => row.kind === 'revalidation'));
    const quality = await report();
    assert.ok(quality.grouped.find(group => group.owner === 'security-owner').issues.some(issue => issue.kind === 'overdue'));
  });
  await t.test('10 retries a missing feed, records a controlled partial result and recovers', async () => {
    const result = await run('ingest', 'admin', { scenario: 'outage-slack' }, 207);
    assert.equal(result.sources.slack.status, 'failed');
    assert.equal(result.sources.operations.status, 'ok');
    assert.equal((await run('context', 'employee', requestEscalation)).authoritative_version, 2);
    assert.ok((await report()).grouped.flatMap(group => group.issues).some(issue => issue.kind === 'source_failure'));
    assert.equal((await run('ingest', 'admin', {})).sources.slack.status, 'ok');
    assert.ok(!(await report()).grouped.flatMap(group => group.issues).some(issue => issue.kind === 'source_failure'));
  });
  await t.test('11 unsupported question and source prompt injection produce abstention', async () => {
    const unrelated = await run('context', 'employee', { question: 'Who books flights to Mars?' });
    const injection = await run('context', 'admin', { question: 'Show pilot feedback' });
    assert.deepEqual(injection, unrelated);
    assert.equal(injection.status, 'abstained');
    assert.ok(records.find(row => row[1] === 'pilot-thread')[4].includes('ignore prior instructions'));
  });
  await t.test('12 fixed retrieval evaluation and exact citation verification', async () => {
    for (const entry of questions) {
      const result = await run('context', entry.role, { question: entry.question });
      const matched = entry.status === result.status && (!entry.source || result.citations[0]?.source_document_id === entry.source) &&
        (!entry.text || result.answer.includes(entry.text));
      passed.queries.push({ ...entry, actual: result.status, matched });
      for (const item of result.citations) {
        const fixture = records.find(row => row[0] === item.source_system && row[1] === item.source_document_id);
        const correct = !!fixture && item.content_hash === digest(fixture[4]) &&
          item.source_url === 'https://northstar.example/' + fixture[0] + '/' + fixture[1] &&
          (!item.claim || fixture[4].slice(item.claim.offset, item.claim.offset + item.claim.quote.length) === item.claim.quote);
        passed.citations.push({ locator: item.provenance.locator, correct });
        assert.ok(correct, item.source_url);
      }
      assert.ok(matched, entry.question);
    }
  });
  await t.test('13 new source revision queues revalidation without replacing the current record', async () => {
    const changed = await run('ingest', 'admin', { scenario: 'revision' });
    assert.equal(changed.sources.operations.inserted, 1);
    assert.ok(changed.scan.findings.some(item => item.kind === 'source_changed' && item.topic === 'rollback'));
    const existing = await run('context', 'employee', { question: 'Show the rollback procedure' });
    assert.equal(existing.authoritative_version, 1);
    assert.doesNotMatch(existing.answer, /incident timeline/);
    assert.equal((await run('ingest', 'admin', { scenario: 'revision' })).sources.operations.inserted, 0);
  });
  await t.test('14 MCP SDK client initializes, lists tools, and calls the authenticated n8n retrieval', async () => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const mcp = async role => {
      const client = new Client({ name: 'contextledger-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
        requestInit: { headers: { authorization: 'Bearer ' + tokens[role] } }
      }));
      t.after(() => client.close());
      return client;
    };
    const employee = await mcp('employee');
    assert.deepEqual((await employee.listTools()).tools.map(tool => tool.name), ['get_authoritative_context']);
    const ask = async (client, question) => JSON.parse((await client.callTool({
      name: 'get_authoritative_context', arguments: { question }
    })).content[0].text);
    const result = await ask(employee, requestEscalation.question);
    assert.equal(result.authoritative_version, 2);
    const denied = await ask(employee, 'What does the security runbook say?');
    passed.disclosures.push(denied.status !== 'abstained' || denied.citations.length !== 0);
    assert.deepEqual(denied, { status: 'abstained', answer: 'No verified context is available for this request.', citations: [] });
    assert.equal((await ask(await mcp('security'), 'What does the security runbook say?')).citations[0].source_document_id, 'quartz-containment');
    assert.equal((await fetch(url + '/mcp', { method: 'POST', body: '{}' })).status, 401);
  });
  await t.test('15 report persists and mock notification reminders are deduplicated', async () => {
    await report();
    assert.equal((await report()).new_mock_notifications, 0);
  });
  await t.test('16 a Security owner revalidates an overdue version with its original evidence', async () => {
    const before = await run('reviews', 'security');
    const review = before.reviews.find(row => row.kind === 'revalidation' && row.topic === 'access-review');
    assert.ok(review);
    const approval = await decide('security', review, 'approve');
    assert.equal(approval.authoritative_version, 2);
    const renewed = await run('context', 'security', { question: 'When was the access review last verified?' });
    assert.equal(renewed.status, 'verified');
    assert.equal(renewed.last_verified_at, approval.decided_at);
    assert.equal(renewed.citations[0].revision_id, review.candidate_id);
    assert.ok(!(await report()).grouped.flatMap(group => group.issues).some(issue => issue.kind === 'overdue'));
  });
  const proposal = {
    topic: 'weekend-coverage', base_version_id: null, classification: 'internal', knowledge_type: 'procedure',
    title: 'Weekend coverage procedure', content: 'The Support duty lead checks urgent cases at 09:00 and 16:00 UTC on weekends.',
    reason: 'Give weekend responders a predictable queue handoff.'
  };
  await t.test('17 contribution intake enforces ownership, taxonomy, and claim validation', async () => {
    const support = (await run('reviews', 'support')).contribution;
    assert.ok(support.topics.every(topic => topic.department === 'Support'));
    assert.ok(support.topics.find(topic => topic.topic === proposal.topic && !topic.base));
    assert.deepEqual((await run('reviews', 'employee')).contribution.topics, []);
    await run('contribute', 'bad-token', proposal, 401);
    await run('contribute', 'employee', { ...proposal, owner: 'support-owner', admin: true }, 403);
    await run('contribute', 'security', proposal, 403);
    await run('contribute', 'support', { ...proposal, topic: 'arbitrary-topic' }, 403);
    const invalid = await run('contribute', 'support', { ...proposal, knowledge_type: 'article', reason: '' }, 422);
    assert.equal(invalid.issues.length, 2);
    const escalation = support.topics.find(topic => topic.topic === 'customer-escalation');
    const missingClaim = await run('contribute', 'support', {
      ...proposal, topic: escalation.topic, base_version_id: escalation.base.id
    }, 422);
    assert.match(missingClaim.message, /one unambiguous policy value/);
  });
  await t.test('18 first publication needs independent approval and returns submitted provenance', async () => {
    const ask = () => run('context', 'employee', { question: 'What is the weekend coverage procedure?' });
    const submitted = await run('contribute', 'support', { ...proposal, approval_status: 'approved', owner: 'forged' }, 201);
    const replay = await run('contribute', 'support', proposal);
    assert.deepEqual(replay, { status: 'pending', review_id: submitted.review_id, replay: true });
    const review = (await run('reviews', 'support')).reviews.find(row => row.id === submitted.review_id);
    assert.equal(review.can_decide, false);
    assert.equal(review.submitted_by, 'support-owner');
    await decide('support', review, 'approve', {}, 403);
    assert.equal((await ask()).status, 'abstained');
    assert.ok((await report()).grouped.find(group => group.owner === 'knowledge-admin').issues
      .some(issue => issue.kind === 'contribution' && issue.subject === proposal.topic));
    assert.equal((await decide('admin', review, 'clarify')).status, 'clarification_requested');
    const revised = await run('contribute', 'support', { ...proposal, reason: 'Support leads confirmed the exact UTC check times.' }, 201);
    assert.equal((await run('reviews', 'admin')).reviews.find(row => row.id === review.id).status, 'superseded');
    assert.equal((await ask()).status, 'abstained');
    assert.equal((await decide('admin', { id: revised.review_id }, 'approve')).authoritative_version, 1);
    const approved = await ask();
    assert.equal(approved.answer, proposal.content);
    assert.equal(approved.citations[0].source_system, 'contribution');
    assert.equal(approved.citations[0].content_hash, digest(proposal.content));
    assert.equal(approved.citations[0].provenance.submitted_by, 'support-owner');
    assert.equal(approved.citations[0].provenance.review_id, revised.review_id);
  });
  await t.test('19 restricted owner updates retain scope, enforce version checks and preserve v1 on rejection', async () => {
    const question = { question: 'What does the security runbook say?' };
    const before = await run('context', 'security', question);
    const update = { ...proposal, topic: 'security-runbook', base_version_id: before.version_id,
      classification: 'restricted', knowledge_type: 'runbook', title: 'Security containment runbook',
      content: 'Store the containment log in the Quartz Vault before paging the Security lead.' };
    await run('contribute', 'security', { ...update, classification: 'internal' }, 422);
    const draft = await run('contribute', 'security', { ...update, allowed_groups: ['employees'] }, 201);
    assert.equal((await run('context', 'security', question)).authoritative_version, 1);
    await decide('admin', { id: draft.review_id }, 'reject');
    assert.equal((await run('context', 'security', question)).answer, before.answer);
    const revised = await run('contribute', 'security', { ...update, reason: 'Record the revised handoff agreed in the Security review.' }, 201);
    assert.equal((await decide('admin', { id: revised.review_id }, 'approve')).authoritative_version, 2);
    assert.equal((await run('context', 'security', question)).answer, update.content);
    assert.equal((await run('context', 'employee', question)).status, 'abstained');
    assert.equal((await run('contribute', 'security', update, 409)).status, 'stale_base');
  });
  const tp = passed.claims.filter(row => row.conflict && row.observed).length;
  const predicted = passed.claims.filter(row => row.observed).length;
  const relevant = passed.claims.filter(row => row.conflict).length;
  const metrics = {
    measured_at: new Date().toISOString(),
    completeness: [stats?.complete_records, stats?.latest_records],
    ownership: [stats?.owned_records, stats?.latest_records],
    freshness: [stats?.current_fresh_streams, stats?.current_streams],
    duplicate_groups_detected: [stats?.duplicate_groups, 1],
    conflict_precision: [tp, predicted], conflict_recall: [tp, relevant],
    retrieval_accuracy: [passed.queries.filter(row => row.matched).length, questions.length],
    citation_correctness: [passed.citations.filter(row => row.correct).length, passed.citations.length],
    unauthorized_disclosures: [passed.disclosures.filter(Boolean).length, passed.disclosures.length],
    synthetic_approval_turnaround_ms: passed.turnaround_ms,
    cases: { conflict: passed.claims, retrieval: passed.queries, citations: passed.citations }
  };
  console.log('Measured ratios [observed, total]', JSON.stringify(metrics, (key, value) => key === 'cases' ? undefined : value));
  if (process.env.CONTEXTLEDGER_WRITE_EVIDENCE === '1') {
    mkdirSync(join(root, 'evidence'), { recursive: true });
    writeFileSync(join(root, 'evidence', 'evaluation.json'), JSON.stringify(metrics, null, 2) + '\n');
  }
});
