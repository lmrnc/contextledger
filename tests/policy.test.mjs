import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { openLedger } from '../service/ledger.mjs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const workflow = JSON.parse(read('../workflows/D-context.json'));
const code = workflow.nodes.find(node => node.name === 'Authorize, match and cite').parameters.jsCode;
const taxonomy = JSON.parse(read('../data/taxonomy.json'));
const execute = new Function('require', '$json', '$', code);
const ask = (actor, data) => execute(require, { actor, data, taxonomy },
  () => ({ first: () => ({ json: { body: { question: 'What is the escalation policy?' } } }) }))[0].json.payload;
const runNode = (file, name, data) => {
  const definition = JSON.parse(read('../workflows/' + file));
  const source = definition.nodes.find(node => node.name === name).parameters.jsCode;
  return new Function('require', '$json', source)(require, { actor: { id: 'test' }, data, taxonomy })[0].json;
};

function stream(id, hours, group) {
  const locator = 'notion:' + id;
  const content = 'Escalate within ' + hours + ' hours.';
  const fields = {
    topic: 'customer-escalation', department: 'Support', owner: 'support-owner',
    knowledge_id: 'k-' + id, classification: group === 'employees' ? 'internal' : 'restricted',
    allowed_groups: [group], claim: { key: 'window_hours', value: hours, quote: 'within ' + hours + ' hours', offset: 9 }
  };
  const observation = { ...fields, id: 'rev-' + id, title: id, content, source_system: 'notion', content_hash: id,
    last_modified_at: '2024-01-01T00:00:00.000Z', provenance: { locator } };
  const authority = { ...fields, id: id + ':v1', stream: id, version: 1, observation_id: observation.id,
    review_due_at: '2099-01-01T00:00:00.000Z' };
  return { observation, authority };
}
function state(...entries) {
  return { observations: entries.map(row => row.observation), authority: entries.map(row => row.authority), reviews: [], quarantine: [] };
}

test('retrieval Code node abstains when two visible approved streams disagree', () => {
  const data = state(stream('approved-a', 24, 'employees'), stream('approved-b', 48, 'employees'));
  const response = ask({ groups: ['employees'] }, data);
  assert.equal(response.status, 'conflict');
  assert.deepEqual(response.citations.map(row => row.claim.value), [24, 48]);
  assert.doesNotMatch(response.answer, /24|48/);
});
test('a hidden approved stream cannot change a less privileged response', () => {
  const publicStream = stream('approved-a', 24, 'employees');
  const hiddenStream = stream('restricted-b', 48, 'security');
  const employee = { groups: ['employees'] };
  assert.deepEqual(ask(employee, state(publicStream, hiddenStream)), ask(employee, state(publicStream)));
  assert.equal(ask({ groups: ['employees', 'security'] }, state(publicStream, hiddenStream)).status, 'conflict');
});
test('renewing an unchanged evidence revision preserves the resolved conflict and its source cleanup', () => {
  const original = stream('approved-a', 24, 'employees');
  const replacement = stream('observed-b', 48, 'employees');
  const { authority: base, observation: old } = original;
  const latest = replacement.observation;
  const promoted = { ...base, ...replacement.authority, stream: base.stream, id: 'approved-a:v2',
    supersedes: base.id, version: 2 };
  const renewed = { ...promoted, id: 'approved-a:v3', supersedes: promoted.id, version: 3 };
  const data = {
    observations: [old, latest], authority: [base, promoted, renewed], quarantine: [], feeds: [], audit: [], notifications: [],
    reviews: [{ id: 'resolved', kind: 'conflict', status: 'approved', topic: base.topic,
      resulting_version: promoted.id, evidence_ids: [old.id, latest.id], version: 2 }]
  };
  const scan = runNode('B-detect.json', 'Compare claims and propose reviews', data);
  assert.deepEqual(scan.payload.findings, []);
  const report = runNode('E-monitor.json', 'Group issues and prepare outbox', data).payload;
  assert.deepEqual(report.grouped.flatMap(group => group.issues)
    .filter(issue => issue.kind === 'source_alignment').map(issue => issue.subject), [old.provenance.locator]);
});
test('SQLite rolls back an entire batch on an immutable history violation', () => {
  const ledger = openLedger(':memory:');
  assert.equal(ledger.commit(0, [{ collection: 'audit', row: { id: 'event-1', event: 'first' } }]), true);
  assert.equal(ledger.commit(0, [{ collection: 'audit', row: { id: 'event-2' } }]), false);
  assert.throws(() => ledger.commit(1, [
    { collection: 'reviews', row: { id: 'uncommitted-review' } },
    { collection: 'audit', row: { id: 'event-1', event: 'replace' } }
  ]));
  assert.deepEqual(ledger.snapshot().data.reviews, []);
  assert.deepEqual(ledger.snapshot().data.audit, [{ id: 'event-1', event: 'first' }]);
  assert.equal(ledger.snapshot().revision, 1);
});
