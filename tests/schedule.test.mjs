import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { root } from '../scripts/config.mjs';
import { startIsolatedRuntime } from './runtime.mjs';

const testInterval = '*/10 * * * * *';
function acceleratedWorkflows(runDir) {
  const workflows = join(runDir, 'workflows');
  cpSync(join(root, 'workflows'), workflows, { recursive: true });
  const monitor = join(workflows, 'E-monitor.json');
  const definition = JSON.parse(readFileSync(monitor, 'utf8'));
  const trigger = definition.nodes.find(node => node.type === 'n8n-nodes-base.scheduleTrigger');
  assert.equal(trigger.parameters.rule.interval[0].expression, '0 9 * * *');
  assert.equal(definition.settings.timezone, 'UTC');
  trigger.parameters.rule.interval[0].expression = testInterval;
  writeFileSync(monitor, JSON.stringify(definition));
  return workflows;
}

test('published Schedule Trigger writes the quality report and mock Slack reminders', { timeout: 360000 }, async t => {
  const { runDir, request } = await startIsolatedRuntime(t, 'schedule', 5700, acceleratedWorkflows);
  const started = new Date().toISOString();
  let ingestion;
  for (let attempt = 0; attempt < 4; attempt++) {
    ingestion = await request('ingest', 'admin', {});
    if (ingestion.http === 200) break;
    assert.ok([207, 409].includes(ingestion.http), JSON.stringify(ingestion.body));
    await sleep(1000);
  }
  assert.equal(ingestion.http, 200, JSON.stringify(ingestion.body));
  const db = new DatabaseSync(join(runDir, 'knowledge.sqlite'), { readOnly: true, timeout: 5000 });
  t.after(() => db.close());
  const read = db.prepare('SELECT payload FROM ledger_rows WHERE collection = ?');
  const entries = collection => read.all(collection).map(row => JSON.parse(row.payload));
  let report;
  for (let attempt = 0; attempt < 30; attempt++) {
    // Only ingestion was invoked. An independent SQLite read checks the scheduler's durable output.
    report = entries('reports').find(row => row.generated_at >= started && row.counts.latest_records === 37);
    if (report) break;
    await sleep(1000);
  }
  assert.ok(report, 'Expected a scheduled report for the ingested dataset');
  const security = report.grouped.find(group => group.owner === 'security-owner');
  assert.ok(security?.issues.some(issue => issue.kind === 'overdue'));
  const notice = entries('notifications').find(row => row.recipient === 'security-owner' && row.report_date === report.id);
  assert.equal(notice?.status, 'queued_mock');
  if (process.env.CONTEXTLEDGER_WRITE_EVIDENCE === '1') {
    writeFileSync(join(root, 'evidence', 'scheduled-report.json'), JSON.stringify({
      test_cron: testInterval, default_cron: '0 9 * * *', timezone: 'UTC',
      monitor_webhook_calls: 0, report, sample_mock_notification: notice
    }, null, 2) + '\n');
  }
});
