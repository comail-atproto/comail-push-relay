import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHttpClient } from './http-client.mjs';

const READY_MESSAGE = 'relay: listening';
const READY_TIMEOUT_MS = 10_000;
const CAPTURE_LIMIT = 4 * 1024;
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
  stream.on('data', (chunk) => { text = (text + chunk.toString('utf8')).slice(-CAPTURE_LIMIT); });
  return () => text;
}

function spawnRelay(options) {
  const env = { ...process.env };
  for (const key of SANITIZED_ENV) delete env[key];
  Object.assign(env, {
    HOST: '127.0.0.1',
    PORT: '0',
    ...options.env,
    PUSH_DATA_DIR: options.dataDir,
  });

  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = capture(child.stdout);
  const stderr = capture(child.stderr);
  const lines = createInterface({ input: child.stdout });
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const state = {
    child,
    stdout,
    stderr,
    lines,
    ready,
    closed: new Promise((resolve) => child.once('close', resolve)),
  };

  lines.on('line', (line) => {
    try {
      const { msg, port } = JSON.parse(line);
      if (msg === READY_MESSAGE && Number.isInteger(port) && port > 0) resolveReady(port);
    } catch {
      // Ignore non-JSON log lines.
    }
  });
  child.once('error', rejectReady);
  child.once('close', (code, signal) => {
    rejectReady(new Error(`relay exited before readiness (code=${code}, signal=${signal})`));
  });
  return state;
}

function failure(error, state) {
  const output = [state.stderr(), state.stdout()].filter(Boolean).join('\n');
  return new Error([error.message, output].filter(Boolean).join('\n'));
}

async function waitForReady(state) {
  let timeout;
  try {
    return await Promise.race([
      state.ready,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('relay readiness timed out')), READY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    throw failure(error, state);
  } finally {
    clearTimeout(timeout);
  }
}

async function closeRelay(state, dataDir) {
  const { child, closed } = state;
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.kill('SIGTERM');
    try {
      await closed;
    } finally {
      clearTimeout(forceKill);
    }
  } else {
    await closed;
  }
  state.lines.close();
  await rm(dataDir, { recursive: true, force: true });
}

export async function startRelay(options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-test-'));
  let state;
  try {
    if (options.initialRecords) {
      await writeFile(path.join(dataDir, 'subscriptions.json'), JSON.stringify({ records: options.initialRecords }));
    }
    state = spawnRelay({ ...options, dataDir });
    const port = await waitForReady(state);
    return {
      port,
      ...createHttpClient(`http://127.0.0.1:${port}`, () => closeRelay(state, dataDir)),
    };
  } catch (error) {
    if (state) await closeRelay(state, dataDir);
    else await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}
