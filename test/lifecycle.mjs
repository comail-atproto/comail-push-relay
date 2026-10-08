// Relay process fixture. Each call owns a fresh temp store and child process,
// waits for the server to report its bound port, then probes /api/health. A
// child that errors, exits early, or never becomes ready fails with its exit
// code and a bounded stdout/stderr tail.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const READY_MESSAGE = 'relay: listening';
const READY_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 2_000;
const CAPTURE_LIMIT = 16 * 1024;
const DIAGNOSTIC_TAIL = 4 * 1024;

// Inherited credentials would change relay behavior; cases opt in explicitly.
const SANITIZED_ENV = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'FCM_SERVICE_ACCOUNT_JSON',
  'ACCESS_APPROVAL_DISPATCH_TOKEN',
  'COMAIL_RELEASE_IDENTITY',
  'PUSH_DATA_DIR',
];

function boundedCapture() {
  let text = '';
  return {
    append(chunk) {
      text = (text + chunk.toString('utf8')).slice(-CAPTURE_LIMIT);
    },
    text: () => text,
  };
}

function tail(text, limit = DIAGNOSTIC_TAIL) {
  return text.length <= limit ? text : `…${text.slice(-limit)}`;
}

function readyPortFrom(stdout) {
  for (const line of stdout.split('\n')) {
    if (!line.includes(READY_MESSAGE)) continue;
    try {
      const record = JSON.parse(line);
      if (record.msg === READY_MESSAGE && Number.isInteger(record.port) && record.port > 0) {
        return record.port;
      }
    } catch {
      // Not a structured log line.
    }
  }
  return null;
}

function readinessError(reason, context) {
  const { child, dataDir, stdout, stderr, spawnError } = context;
  const lines = [
    reason,
    `  data dir: ${dataDir ?? '<default>'}`,
    `  child exit: code=${child.exitCode ?? 'null'} signal=${child.signalCode ?? 'null'}`,
  ];
  if (spawnError) lines.push(`  spawn error: ${spawnError.message}`);
  lines.push(`  stderr tail: ${tail(stderr.text()) || '<empty>'}`);
  lines.push(`  stdout tail: ${tail(stdout.text()) || '<empty>'}`);
  return new Error(lines.join('\n'));
}

function spawnRelay(options) {
  const env = { ...process.env };
  for (const key of SANITIZED_ENV) delete env[key];
  Object.assign(env, {
    HOST: '127.0.0.1',
    PORT: '0',
    PUSH_DATA_DIR: options.dataDir,
    ...options.env,
  });

  const deleteDataDir = options.deleteDataDir === true;
  const dataDir = options.dataDir ?? null;
  const stdout = boundedCapture();
  const stderr = boundedCapture();
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdout.append(chunk));
  child.stderr.on('data', (chunk) => stderr.append(chunk));

  let spawnError = null;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.on('error', (error) => {
    spawnError = error;
  });

  const session = {
    child,
    dataDir,
    port: null,
    base: null,
    stdout: () => stdout.text(),
    stderr: () => stderr.text(),

    async waitForReady(timeoutMs = READY_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const context = { child, dataDir, stdout, stderr, spawnError };
        if (spawnError) {
          throw readinessError(`relay failed to spawn: ${spawnError.message}`, context);
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          throw readinessError('relay exited before signaling readiness', context);
        }
        const port = readyPortFrom(stdout.text());
        if (port !== null) {
          const base = `http://127.0.0.1:${port}`;
          try {
            const response = await fetch(`${base}/api/health`, {
              signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            });
            if (response.ok) {
              session.port = port;
              session.base = base;
              return session;
            }
          } catch {
            // Listener may not be accepting yet.
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw readinessError(`relay did not become ready within ${timeoutMs}ms`, { child, dataDir, stdout, stderr, spawnError });
    },

    async stop() {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
        try {
          await closed;
        } finally {
          clearTimeout(killer);
        }
      }
      await closed;
      if (deleteDataDir && dataDir) {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  };

  session.request = (route, init) => fetch(session.base + route, init);
  session.json = async (route, init) => {
    const response = await session.request(route, init);
    return { status: response.status, body: await response.json() };
  };
  session.post = (route, body, authorization) =>
    session.json(route, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    });

  return session;
}

// startRelay creates a fresh temp store, spawns the relay and waits for
// readiness. On failure it tears everything down before re-throwing.
export async function startRelay(options = {}) {
  const owned = options.dataDir === undefined;
  const dataDir = options.dataDir
    ?? await mkdtemp(path.join(os.tmpdir(), 'push-relay-test-'));
  const session = spawnRelay({ ...options, dataDir, deleteDataDir: owned });
  try {
    return await session.waitForReady(options.readyTimeoutMs);
  } catch (error) {
    await session.stop();
    throw error;
  }
}
