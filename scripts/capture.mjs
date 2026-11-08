import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { dependencyDir, root, runDir, n8nUrl, uiUrl, readKeys } from './config.mjs';

const require = createRequire(join(dependencyDir, 'package.json'));
const { chromium } = require('playwright');
const edge = process.platform === 'win32' && process.env['ProgramFiles(x86)'] &&
  join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const executablePath = process.env.CONTEXTLEDGER_BROWSER || (edge && existsSync(edge) ? edge : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const evidence = join(root, 'evidence');
mkdirSync(evidence, { recursive: true });
const { tokens } = readKeys();
const stage = process.argv[2];
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const shot = (name, target = page) => target.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' });
async function connect(target, identity, role) {
  await target.getByLabel('Demo identity token').fill(tokens[role]);
  await target.getByRole('button', { name: 'Connect' }).click();
  await target.getByText(identity, { exact: true }).waitFor();
}
const tab = name => page.getByRole('button', { name, exact: typeof name === 'string' });
async function ask(question, answer) {
  await tab(/Trusted context/).click();
  await page.getByLabel('Ask a knowledge question').fill(question);
  const [response] = await Promise.all([
    page.waitForResponse(result => result.url().endsWith('/api/context')),
    tab('Retrieve').click()
  ]);
  const result = await response.json();
  await page.getByText(answer, { exact: true }).waitFor();
  return result;
}
try {
  if (stage === 'before' || stage === 'after') {
    await page.goto(uiUrl);
    await connect(page, 'support-owner', 'support');
    await page.getByRole('heading', { name: 'Customer escalation', exact: true }).waitFor();
  }
  if (stage === 'before') {
    await page.getByText('pending', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Approve', exact: true }).waitFor();
    await shot('pending-conflict');
    if (process.argv.includes('--approve')) {
      await page.getByLabel('Decision note').fill('Support confirmed 48 hours from P2 confirmation. Update the policy and dispatch checklist.');
      const approval = page.waitForResponse(response => response.url().endsWith('/api/decision'));
      await page.getByRole('button', { name: 'Approve', exact: true }).click();
      const response = await approval;
      const result = await response.json();
      assert.equal(result.authoritative_version, 2);
      await page.getByRole('heading', { name: 'Decision history' }).waitFor();
      writeFileSync(join(evidence, 'browser-approval.json'), JSON.stringify(result, null, 2) + '\n');
      await shot('approved-decision');
    }
  }
  if (stage === 'after') {
    await page.getByRole('heading', { name: 'Decision history' }).waitFor();
    await shot('approved-decision');
    await page.getByRole('button', { name: /Trusted context/ }).click();
    await page.getByRole('button', { name: 'Retrieve' }).click();
    await page.getByText('Escalate qualifying P2 customer cases within 48 hours of confirmation.', { exact: true }).waitFor();
    await shot('trusted-retrieval');
    await connect(page, 'general-employee', 'employee');
    await page.getByLabel('Ask a knowledge question').fill('Can I access the internal security runbook?');
    await page.getByRole('button', { name: 'Retrieve' }).click();
    await page.getByText('No verified context is available for this request.', { exact: true }).waitFor();
    await shot('restricted-retrieval');
    await connect(page, 'knowledge-admin', 'admin');
    await page.getByRole('button', { name: /Quality report/ }).click();
    await page.getByRole('button', { name: 'Generate report' }).click();
    await page.getByRole('heading', { name: 'Resolved cases' }).waitFor();
    await shot('quality-report');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1, hasTouch: true });
    await mobile.goto(uiUrl);
    await connect(mobile, 'support-owner', 'support');
    await mobile.getByRole('heading', { name: 'Customer escalation', exact: true }).waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Review Desk must fit a narrow viewport');
    await mobile.close();
  }
  if (stage === 'journey') {
    await page.goto(uiUrl);
    await connect(page, 'support-owner', 'support');
    await tab(/Contribute/).click();
    await page.getByLabel('Topic').selectOption('weekend-coverage');
    const question = 'What is the weekend coverage procedure?';
    const content = 'The Support duty lead checks urgent cases at 09:00 and 16:00 UTC on weekends.';
    await page.getByLabel('Title', { exact: true }).fill('Weekend coverage procedure');
    await page.getByLabel('Knowledge text').fill(content);
    await page.getByLabel('Reason for the change').fill('Give weekend responders a predictable queue handoff.');
    const submission = page.waitForResponse(response => response.url().endsWith('/api/contribute'));
    await tab('Submit for review').click();
    const accepted = await submission;
    assert.equal(accepted.status(), 201);
    const submitted = await accepted.json();
    await page.getByText('Submitted for steward review. Published knowledge is unchanged.').waitFor();
    await shot('contributor-submission');
    await connect(page, 'general-employee', 'employee');
    const pending = await ask(question, 'No verified context is available for this request.');
    assert.equal(pending.status, 'abstained');
    await shot('contributor-pending-retrieval');
    await connect(page, 'knowledge-admin', 'admin');
    await tab(/Review queue/).click();
    await tab(/weekend coverage/i).click();
    await page.getByLabel('Decision note').fill('Support confirmed the schedule and employee audience. Publish this procedure.');
    await shot('contributor-steward-review');
    const [approval] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/decision')),
      tab('Approve').click()
    ]);
    const approved = await approval.json();
    assert.equal(approved.authoritative_version, 1);
    await page.getByRole('heading', { name: 'Decision history' }).waitFor();
    await connect(page, 'general-employee', 'employee');
    const verified = await ask(question, content);
    assert.equal(verified.citations[0].provenance.review_id, submitted.review_id);
    await shot('contributor-retrieval');
    await connect(page, 'knowledge-admin', 'admin');
    await tab(/Quality report/).click();
    await tab('Generate report').click();
    await page.getByText('weekend coverage · approved · v1', { exact: true }).waitFor();
    await shot('quality-report');
    writeFileSync(join(evidence, 'contributor-journey.json'), JSON.stringify({ submitted, pending, approved, verified }, null, 2) + '\n');
  }
  if (stage === 'canvas') {
    const account = join(runDir, 'capture-owner.json');
    const editor = await browser.newPage({ viewport: { width: 1780, height: 940 } });
    await editor.goto(n8nUrl);
    if (!existsSync(account)) {
      const user = {
        email: 'demo-editor@northstar.example', firstName: 'Northstar', lastName: 'Editor',
        password: 'ContextLedger-' + randomBytes(16).toString('hex') + '-1'
      };
      const setup = await editor.request.post(n8nUrl + '/rest/owner/setup', { data: user });
      assert.ok(setup.ok(), 'Editor setup failed with HTTP ' + setup.status() + '. Run capture on a fresh editor profile.');
      writeFileSync(account, JSON.stringify(user), { mode: 0o600 });
    } else {
      const { email, password } = JSON.parse(readFileSync(account, 'utf8'));
      const login = await editor.request.post(n8nUrl + '/rest/login', { data: { emailOrLdapLoginId: email, password } });
      assert.ok(login.ok(), 'Editor login failed with HTTP ' + login.status());
    }
    const canvases = [
      ['CLIngest00000001', 'Normalize, hash and validate', 'ingestion'],
      ['CLDetect00000001', 'Compare claims and propose reviews', 'detection'],
      ['CLReview00000001', 'Validate contribution or decision', 'governance'],
      ['CLContext0000001', 'Authorize, match and cite', 'retrieval'],
      ['CLMonitor0000001', 'Persist report and reminders', 'monitoring']
    ];
    for (const [id, node, name] of canvases) {
      await editor.goto(n8nUrl + '/workflow/' + id);
      await editor.getByText(node, { exact: true }).first().waitFor({ timeout: 40000 });
      const checklist = editor.getByText('Production Checklist', { exact: true }).first();
      const close = editor.locator('[data-test-id="suggested-actions-close"]');
      if (await checklist.isVisible()) await close.first().click();
      await editor.getByRole('button', { name: 'Zoom to Fit', exact: true }).click();
      await editor.mouse.move(1740, 875);
      await checklist.waitFor({ state: 'hidden', timeout: 4000 });
      await editor.waitForFunction(() => {
        const nodes = [...document.querySelectorAll('.vue-flow__node')];
        return nodes.length > 3 && nodes.every(node => {
          const { left, top, right, bottom } = node.getBoundingClientRect();
          return left >= 43 && top >= 61 && right <= innerWidth && bottom <= innerHeight;
        });
      });
      await shot('n8n-' + name + '-canvas', editor);
    }
  }
} finally {
  await browser.close();
}
