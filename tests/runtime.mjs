import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { root } from '../scripts/config.mjs';
import { ledgerClient } from '../scripts/client.mjs';

export async function startIsolatedRuntime(t, name, port, prepareWorkflows) {
  const runtimeParent = join(root, '.runtime');
  mkdirSync(runtimeParent, { recursive: true });
  const runDir = mkdtempSync(join(runtimeParent, name + '-'));
  const environment = {
    ...process.env, CONTEXTLEDGER_RUN_DIR: runDir, CONTEXTLEDGER_N8N_PORT: String(port), CONTEXTLEDGER_UI_PORT: String(port + 2)
  };
  if (prepareWorkflows) environment.CONTEXTLEDGER_WORKFLOWS_DIR = prepareWorkflows(runDir);
  const log = join(runDir, 'runtime.log');
  const logfile = createWriteStream(log);
  const start = spawn(process.execPath, ['scripts/run.mjs', 'start'], { cwd: root, env: environment, windowsHide: true });
  start.stdout.pipe(logfile, { end: false });
  start.stderr.pipe(logfile, { end: false });
  let output = '';
  start.stdout.on('data', chunk => { output = (output + chunk).slice(-4096); });
  const exited = new Promise(resolve => start.once('exit', resolve));
  t.after(async () => {
    if (start.exitCode === null) {
      const stop = spawn(process.execPath, ['scripts/run.mjs', 'stop'], { cwd: root, env: environment, windowsHide: true });
      stop.stdout.resume();
      stop.stderr.resume();
      await Promise.race([exited, sleep(5000, null, { ref: false })]);
      if (start.exitCode === null) start.kill();
    }
    logfile.end();
  });
  let ready = false;
  for (let attempt = 0; attempt < 240 && start.exitCode === null; attempt++) {
    ready = output.includes('ContextLedger ready');
    if (ready) break;
    await sleep(1000);
  }
  if (!ready) {
    for await (const chunk of createReadStream(log)) process.stderr.write(chunk);
    assert.fail('Isolated runtime failed to start. See ' + relative(root, log));
  }
  const { tokens } = JSON.parse(readFileSync(join(runDir, 'keys.json'), 'utf8'));
  const url = 'http://127.0.0.1:' + (port + 2);
  return { runDir, tokens, url, request: ledgerClient(url, tokens) };
}
