import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { dependencyDir, n8nUrl, uiUrl, readKeys } from '../../scripts/config.mjs';
import { ledgerClient } from '../../scripts/client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = join(root, '.capture');
const media = join(root, 'public', 'footage');
const playwright = createRequire(join(dependencyDir, 'package.json'))('playwright');
const executablePath = process.env.CONTEXTLEDGER_BROWSER || (process.platform === 'win32'
  ? join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined);
const browser = await playwright.chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 800 }, deviceScaleFactor: 1 });
const { tokens } = readKeys();
const request = ledgerClient(uiUrl, tokens);
const take = Date.now().toString();
const evidence = {};
mkdirSync(media, { recursive: true });

// Start screencasting only after login. Each JPEG is an actual Chromium paint.
async function record(page, name, seconds, interact = async () => {}) {
  await page.bringToFront();
  const folder = join(scratch, take, name);
  mkdirSync(folder, { recursive: true });
  const frames = [];
  const session = await context.newCDPSession(page);
  const started = performance.now();
  session.on('Page.screencastFrame', event => {
    session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    const name = String(frames.length).padStart(5, '0') + '.jpg';
    frames.push({ name, at: (performance.now() - started) / 1000 });
    writeFileSync(join(folder, name), Buffer.from(event.data, 'base64'));
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 91, maxWidth: 1600, maxHeight: 800, everyNthFrame: 1 });
  await interact();
  await delay(Math.max(0, seconds * 1000 - performance.now() + started + 150));
  await session.send('Page.stopScreencast');
  await session.detach();
  assert.ok(frames.length, 'Chromium returned no frames for ' + name);
  const captured = (performance.now() - started) / 1000;
  const last = frames.at(-1);
  const list = frames.map((frame, index) => {
    const start = index === 0 ? 0 : frame.at;
    const end = frames[index + 1]?.at ?? captured + 0.1;
    return "file '" + frame.name + "'\nduration " + Math.max(0.001, end - start).toFixed(4);
  }).join('\n') + "\nfile '" + last.name + "'\n";
  writeFileSync(join(folder, 'frames.txt'), list);
  const result = spawnSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'frames.txt',
    '-t', String(seconds), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '17', '-preset', 'fast',
    '-movflags', '+faststart', join(media, name + '.mp4')], { cwd: folder, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.ok(captured <= seconds + 1.5, name + ' overran its edit by ' + (captured - seconds).toFixed(1) + ' seconds');
  console.log(name + ' · ' + frames.length + ' captured paints · ' + seconds + 's');
}

const button = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const scroll = (page, y, behavior = 'instant') => page.evaluate(([top, behavior]) => window.scrollTo({ top, behavior }), [y, behavior]);
async function desk(role, identity) {
  const page = await context.newPage();
  await page.goto(uiUrl);
  await page.getByLabel('Demo identity token').fill(tokens[role]);
  await button(page, 'Connect').click();
  await page.getByText(identity, { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Demo identity token').inputValue(), '');
  return page;
}
async function expectPost(page, path, action) {
  const [response] = await Promise.all([page.waitForResponse(res => res.url().endsWith('/api/' + path)), action()]);
  assert.ok(response.ok(), path + ' HTTP ' + response.status());
  return response.json();
}
async function workflow(page, id, node) {
  await page.goto(n8nUrl + '/workflow/' + id);
  await page.getByText(node, { exact: true }).first().waitFor({ timeout: 40000 });
  const close = page.locator('[data-test-id="suggested-actions-close"]');
  if (await close.first().isVisible()) await close.first().click();
  await button(page, 'Zoom to Fit').click();
  await page.mouse.move(1480, 725);
  await page.getByText('Production Checklist', { exact: true }).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll('.vue-flow__node')];
    return nodes.length > 3 && nodes.every(node => {
      const r = node.getBoundingClientRect();
      return r.left >= 42 && r.top >= 60 && r.right <= innerWidth && r.bottom <= innerHeight;
    });
  });
}
try {
  const seed = await request('ingest', 'admin', {});
  assert.equal(seed.http, 200);
  assert.equal(Object.values(seed.body.sources).reduce((sum, feed) => sum + feed.inserted, 0), 37,
    'Use a fresh video demo ledger');
  const support = await desk('support', 'support-owner');
  await support.getByRole('heading', { name: 'Customer escalation', exact: true }).waitFor();
  await scroll(support, 180);
  await record(support, 'problem', 12);

  const editor = await context.newPage();
  const setup = await editor.request.post(n8nUrl + '/rest/owner/setup', { data: {
    email: 'video-editor@northstar.example', firstName: 'Northstar', lastName: 'Editor',
    password: 'ContextLedger-' + randomBytes(20).toString('hex') + '-1'
  } });
  assert.ok(setup.ok(), 'Use a fresh n8n editor profile for recording');
  await workflow(editor, 'CLIngest00000001', 'Normalize, hash and validate');
  await record(editor, 'ingestion', 5);
  await workflow(editor, 'CLReview00000001', 'Validate contribution or decision');
  await record(editor, 'governance', 8);

  await scroll(support, 180);
  await record(support, 'escalation-review', 20, async () => {
    await delay(7800);
    await scroll(support, 330, 'smooth');
    await delay(1600);
    await support.getByLabel('Decision note').fill('Support confirmed the 48-hour window. Update the policy and dispatch checklist.');
    await delay(3300);
    evidence.escalation = await expectPost(support, 'decision', () => button(support, 'Approve').click());
    assert.equal(evidence.escalation.authoritative_version, 2);
    await support.getByRole('heading', { name: 'Decision history' }).waitFor();
    await scroll(support, 360, 'smooth');
  });

  await button(support, /Contribute/).click();
  await scroll(support, 210);
  await record(support, 'contribution', 16, async () => {
    await delay(1300);
    await support.getByLabel('Topic').selectOption('weekend-coverage');
    await delay(2000);
    await support.getByLabel('Title', { exact: true }).fill('Weekend coverage procedure');
    await delay(2500);
    await support.getByLabel('Knowledge text').fill('The Support duty lead checks urgent cases at 09:00 and 16:00 UTC on weekends.');
    await delay(3300);
    await support.getByLabel('Reason for the change').fill('Give weekend responders a predictable queue handoff.');
    await delay(2300);
    evidence.submission = await expectPost(support, 'contribute', () => button(support, 'Submit for review').click());
    await support.getByText('Submitted for steward review. Published knowledge is unchanged.').waitFor();
  });

  const employee = await desk('employee', 'general-employee');
  await button(employee, /Trusted context/).click();
  const question = 'What is the weekend coverage procedure?';
  await employee.getByLabel('Ask a knowledge question').fill(question);
  await record(employee, 'pending-retrieval', 5, async () => {
    await delay(450);
    evidence.before = await expectPost(employee, 'context', () => button(employee, 'Retrieve').click());
    assert.equal(evidence.before.status, 'abstained');
  });
  const admin = await desk('admin', 'knowledge-admin');
  await button(admin, /weekend coverage/i).click();
  await admin.getByLabel('Decision note').fill('Support confirmed the check times and employee audience. Publish this procedure.');
  await scroll(admin, 170);
  await record(admin, 'steward-approval', 5, async () => {
    await delay(1150);
    evidence.approval = await expectPost(admin, 'decision', () => button(admin, 'Approve').click());
    assert.equal(evidence.approval.authoritative_version, 1);
    await admin.getByRole('heading', { name: 'Decision history' }).waitFor();
  });
  await record(employee, 'approved-retrieval', 5, async () => {
    await delay(250);
    evidence.after = await expectPost(employee, 'context', () => button(employee, 'Retrieve').click());
    assert.equal(evidence.after.status, 'verified');
    assert.equal(evidence.after.citations[0].provenance.review_id, evidence.submission.review_id);
  });
  await record(employee, 'restricted-retrieval', 4, async () => {
    await employee.getByLabel('Ask a knowledge question').fill('Can I access the internal security runbook?');
    await delay(650);
    evidence.restricted = await expectPost(employee, 'context', () => button(employee, 'Retrieve').click());
    assert.deepEqual(evidence.restricted, evidence.before);
  });
  await button(admin, /Quality report/).click();
  await record(admin, 'quality-report', 10, async () => {
    await delay(200);
    const report = await expectPost(admin, 'monitor', () => button(admin, 'Generate report').click());
    assert.ok(report.resolved_reviews.some(item => item.topic === 'weekend-coverage' && item.status === 'approved'));
    await admin.getByText('Resolved cases', { exact: true }).waitFor();
    await delay(1250);
    await scroll(admin, 300, 'smooth');
  });
  writeFileSync(join(root, 'CAPTURE-EVIDENCE.json'), JSON.stringify(evidence, null, 2) + '\n');
} finally {
  await browser.close();
}
