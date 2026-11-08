import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (existsSync(join(root, '.env'))) loadEnvFile(join(root, '.env'));
export const dependencyDir = resolve(root, process.env.CONTEXTLEDGER_DEPENDENCIES || '.runtime');
export const runDir = resolve(root, process.env.CONTEXTLEDGER_RUN_DIR || '.runtime/demo');
export const n8nPort = Number(process.env.CONTEXTLEDGER_N8N_PORT || 5678);
export const internalPort = n8nPort + 1;
export const uiPort = Number(process.env.CONTEXTLEDGER_UI_PORT || n8nPort + 2);
export const controlPort = n8nPort + 4;
export const n8nUrl = 'http://127.0.0.1:' + n8nPort;
export const uiUrl = 'http://127.0.0.1:' + uiPort;
export const controlUrl = 'http://127.0.0.1:' + controlPort;
export const keyFile = join(runDir, 'keys.json');
export const readKeys = () => JSON.parse(readFileSync(keyFile, 'utf8'));
const random = () => randomBytes(32).toString('hex');

export function configure() {
  mkdirSync(runDir, { recursive: true });
  if (!existsSync(keyFile)) {
    const keys = {
      privateKey: random(), encryptionKey: random(),
      tokens: Object.fromEntries(['employee', 'support', 'security', 'admin'].map(role => [role, random()]))
    };
    writeFileSync(keyFile, JSON.stringify(keys, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return readKeys();
}
