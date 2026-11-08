import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, uiUrl, readKeys } from './config.mjs';
import { ledgerClient } from './client.mjs';

const request = ledgerClient(uiUrl, readKeys().tokens);
const question = 'What is the current escalation policy?';
const run = async (path, identity, data, http = 200) => {
  const response = await request(path, identity, data);
  assert.equal(response.http, http, JSON.stringify(response.body));
  return response.body;
};
const seed = await run('ingest', 'admin', {});
console.log('1. Ingested', Object.fromEntries(Object.entries(seed.sources).map(([name, stats]) => [name, stats.inserted])));
const evidence = join(root, 'evidence');
function capture(name, data) {
  mkdirSync(evidence, { recursive: true });
  const file = join(evidence, name + '.json');
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('Captured live API responses in ' + file);
}
if (process.argv.includes('seed')) {
  if (process.argv.includes('--evidence')) capture('initial-ingestion', seed);
  process.exit(0);
}
const baseline = await run('context', 'employee', { question });
const review = (await run('reviews', 'support')).reviews.find(row => row.topic === 'customer-escalation');
assert.ok(review, 'Escalation review expected');
console.log('2. Detected', review.kind, 'with source values', review.evidence.map(source => source.claim?.value));
const proposed = { review_id: review.id, decision: 'approve', note: 'Support approved the P2 escalation window of 48 hours. Update the old policy and dispatch checklist.' };
let unauthorized, approved;
if (['pending', 'clarification_requested'].includes(review.status)) {
  unauthorized = await run('decision', 'employee', { ...proposed, reviewer: 'support-owner', role: 'admin' }, 403);
  approved = await run('decision', 'support', proposed);
} else {
  assert.equal(review.status, 'approved', 'Reset if the escalation was rejected in a prior session.');
  console.log('3. Escalation was already approved in this ledger. Reset for the full walkthrough.');
}
console.log('3. Reviewed', review.id, '· Support owner decision', approved?.status || review.status);
const trusted = await run('context', 'employee', { question });
assert.equal(trusted.authoritative_version, 2);
assert.match(trusted.answer, /48 hours/);
console.log('4. Retrieved v' + trusted.authoritative_version, trusted.answer);
const denied = await run('context', 'employee', { question: 'Can I access the internal security runbook?' });
assert.equal(denied.status, 'abstained');
assert.deepEqual(denied.citations, []);
console.log('5. Restricted context', denied.answer);
const report = await run('monitor', 'admin', {});
assert.ok(report.resolved_reviews.some(row => row.topic === 'customer-escalation' && row.status === 'approved'));
console.log('6. Quality report', report.counts);
if (process.argv.includes('--evidence')) {
  capture('demo-execution', { seed, baseline, review, unauthorized, approved, trusted, denied, report });
}
