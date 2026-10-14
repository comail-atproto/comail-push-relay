import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHttpClient } from './http-client.mjs';

// Child credentials are absent unless a case supplies them in `env`.
const SANITIZED_ENV = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'FCM_SERVICE_ACCOUNT_JSON',
  'ACCESS_APPROVAL_DISPATCH_TOKEN',
  'COMAIL_RELEASE_IDENTITY',
  'PUSH_DATA_DIR',
];

function capture(stream) {
  let text = '';
  stream.on('data', (chunk) => { text = (text + chunk.toString('utf8')).slice(-4096); });
  return () => text;
}

async function waitForPort(child) {
  const stdout = capture(child.stdout);
  const stderr = capture(child.stderr);
  const lines = createInterface({ input: child.stdout });
  let timeout;
  const ready = new Promise((resolve, reject) => {
    lines.on('line', (line) => {
      try {
        const { msg, port } = JSON.parse(line);
        if (msg === 'relay: listening' && Number.isInteger(port) && port > 0) resolve(port);
      } catch {
        // Ignore non-JSON log lines.
      }
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      reject(new Error(`relay exited before readiness (code=${code}, signal=${signal})`));
    });
    timeout = setTimeout(() => reject(new Error('relay readiness timed out')), 10_000);
  });
  try {
    return await ready;
  } catch (error) {
    throw new Error([error.message, stderr(), stdout()].filter(Boolean).join('\n'));
  } finally {
    clearTimeout(timeout);
    lines.close();
  }
}

async function closeRelay(child, closed, dataDir) {
  let forceKill;
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.kill('SIGTERM');
  }
  try {
    await closed;
  } finally {
    clearTimeout(forceKill);
    await rm(dataDir, { recursive: true, force: true });
  }
}

export async function startRelay(options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-test-'));
  const env = { ...process.env };
  for (const key of SANITIZED_ENV) delete env[key];
  Object.assign(env, { HOST: '127.0.0.1', PORT: '0', ...options.env, PUSH_DATA_DIR: dataDir });
  let child;
  let closed;
  try {
    if (options.initialRecords) {
      await writeFile(path.join(dataDir, 'subscriptions.json'), JSON.stringify({ records: options.initialRecords }));
    }
    child = spawn(process.execPath, ['dist/server.js'], {
      cwd: options.cwd ?? process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    closed = new Promise((resolve) => child.once('close', resolve));
    const port = await waitForPort(child);
    return createHttpClient(`http://127.0.0.1:${port}`, () => closeRelay(child, closed, dataDir));
  } catch (error) {
    if (child) await closeRelay(child, closed, dataDir);
    else await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}
