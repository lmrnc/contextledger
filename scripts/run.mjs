import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  root, runDir, dependencyDir, n8nPort, internalPort, uiPort, controlPort, n8nUrl, uiUrl,
  controlUrl, keyFile, configure, readKeys
} from './config.mjs';

const command = process.argv[2] || 'start';
const workflows = resolve(root, process.env.CONTEXTLEDGER_WORKFLOWS_DIR || 'workflows');
const n8n = join(dependencyDir, 'node_modules', 'n8n', 'bin', 'n8n');
const control = (action, key) => fetch(controlUrl + '/' + action, {
  method: 'POST', headers: { 'x-ledger-key': key }, signal: AbortSignal.timeout(2000)
});
const child = (file, args, env) => spawn(process.execPath, [file, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true });
function completed(processHandle) {
  return new Promise((resolveExit, reject) => {
    processHandle.once('error', reject);
    processHandle.once('exit', code => code === 0 ? resolveExit() : reject(new Error('Child exit code ' + code)));
  });
}
async function waitFor(url, options, expected = 200) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(url, { ...options, signal: AbortSignal.timeout(2000) })).status === expected) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error('Timed out waiting for ' + url);
}

async function start() {
  if (!existsSync(n8n)) throw new Error('Install the pinned runtime first. See README.md.');
  const keys = configure();
  if (await control('status', keys.privateKey).catch(() => null)) throw new Error('A supervisor is already listening on the control port.');
  const instance = join(runDir, 'n8n-user');
  mkdirSync(instance, { recursive: true });
  const env = {
    ...process.env, N8N_USER_FOLDER: instance, N8N_ENCRYPTION_KEY: keys.encryptionKey,
    N8N_HOST: '127.0.0.1', N8N_LISTEN_ADDRESS: '127.0.0.1', N8N_PORT: String(n8nPort),
    N8N_PROTOCOL: 'http', N8N_SECURE_COOKIE: 'false', N8N_WEBHOOK_URL: n8nUrl + '/',
    GENERIC_TIMEZONE: 'UTC', TZ: 'UTC', N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_COMMUNITY_PACKAGES_ENABLED: 'false', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false',
    N8N_RUNNERS_MODE: 'internal',
    N8N_RUNNERS_BROKER_PORT: String(n8nPort + 3), NODE_FUNCTION_ALLOW_BUILTIN: 'crypto',
    EXECUTIONS_DATA_SAVE_ON_ERROR: 'none', EXECUTIONS_DATA_SAVE_ON_SUCCESS: 'none',
    EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS: 'false',
    CONTEXTLEDGER_INTERNAL_URL: 'http://127.0.0.1:' + internalPort, CONTEXTLEDGER_INTERNAL_KEY: keys.privateKey,
    CONTEXTLEDGER_RUNTIME: runDir, CONTEXTLEDGER_DEPS_DIR: dependencyDir, CONTEXTLEDGER_INTERNAL_PORT: String(internalPort),
    CONTEXTLEDGER_N8N_URL: n8nUrl, CONTEXTLEDGER_UI_PORT: String(uiPort)
  };
  const definitions = readdirSync(workflows).filter(file => file.endsWith('.json')).sort();
  const manifest = definitions.map(file => readFileSync(join(workflows, file), 'utf8')).join('\n');
  const marker = join(runDir, 'imported.json');
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== manifest) {
    await completed(child(n8n, ['import:workflow', '--separate', '--input=' + workflows], env));
    for (const file of definitions) {
      const id = JSON.parse(readFileSync(join(workflows, file), 'utf8')).id;
      await completed(child(n8n, ['publish:workflow', '--id=' + id], env));
    }
    writeFileSync(marker, manifest);
  }
  const adapter = child(join(root, 'service', 'server.mjs'), [], env);
  const editor = child(n8n, ['start'], env);
  let stopping = false;
  const supervisor = createServer((request, response) => {
    if (request.method !== 'POST' || request.headers['x-ledger-key'] !== keys.privateKey) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(204).end();
    if (request.url === '/stop') stop(0);
  });
  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    supervisor.close();
    for (const handle of [editor, adapter]) if (handle.exitCode === null && !handle.killed) handle.kill();
  }
  adapter.once('exit', () => stop(1));
  editor.once('exit', () => stop(1));
  process.once('SIGINT', () => stop(0));
  process.once('SIGTERM', () => stop(0));
  supervisor.listen(controlPort, '127.0.0.1');
  try {
    await Promise.all([
      waitFor(uiUrl + '/'),
      waitFor(n8nUrl + '/webhook/contextledger/context', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      }, 401)
    ]);
    if (!stopping) console.log('ContextLedger ready · Review Desk ' + uiUrl + ' · n8n editor ' + n8nUrl);
  } catch (error) {
    stop(1);
    throw error;
  }
}

switch (command) {
  case 'configure': {
    const keys = configure();
    if (process.argv.includes('--compose')) {
      writeFileSync(join(runDir, 'compose.env'), 'CONTEXTLEDGER_INTERNAL_KEY=' + keys.privateKey +
        '\nN8N_ENCRYPTION_KEY=' + keys.encryptionKey + '\n', { mode: 0o600 });
    }
    console.log('Local demo secrets configured in ' + runDir);
    break;
  }
  case 'start':
    await start();
    break;
  case 'stop':
    if (!existsSync(keyFile)) throw new Error('No local runtime configured.');
    await control('stop', readKeys().privateKey);
    break;
  case 'reset': {
    const safeRoot = resolve(root, '.runtime') + sep;
    if (!runDir.startsWith(safeRoot)) throw new Error('Reset is limited to the project runtime directory.');
    if (existsSync(keyFile) && await control('status', readKeys().privateKey).catch(() => null)) {
      throw new Error('Stop the demo before resetting knowledge.');
    }
    for (const name of ['knowledge.sqlite', 'knowledge.sqlite-wal', 'knowledge.sqlite-shm']) {
      rmSync(join(runDir, name), { force: true });
    }
    console.log('Demo ledger cleared. Workflows and local tokens are retained.');
    break;
  }
  case 'tokens':
    console.log(JSON.stringify(readKeys().tokens, null, 2));
    break;
  default:
    throw new Error('Use start, stop, reset, configure or tokens.');
}
