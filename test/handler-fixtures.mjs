import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRelayServer } from '../dist/app.js';
import { FileSubscriptionStore } from '../dist/store.js';
import { createHttpClient } from './http-client.mjs';
export { record } from './record-fixture.mjs';

export async function startTestRelay(t, { records = {}, ...dependencies } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-app-test-'));
  let server;
  try {
    const initialRecords = records instanceof Map ? Object.fromEntries(records) : records;
    if (Object.keys(initialRecords).length) {
      await writeFile(path.join(dataDir, 'subscriptions.json'), JSON.stringify({ records: initialRecords }));
    }
    server = createRelayServer({
      store: new FileSubscriptionStore(dataDir),
      getVapidPublicKey: () => null,
      async deliverStateChange() { throw new Error('not used'); },
      async deliverAccessApproval() { throw new Error('not used'); },
      ...dependencies,
    });
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const { port } = server.address();
    const relay = createHttpClient(`http://127.0.0.1:${port}`, async () => {
      try {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    });
    t.after(() => relay.close());
    return {
      ...relay,
      dataDir,
      async readRecords() {
        try {
          return JSON.parse(await readFile(path.join(dataDir, 'subscriptions.json'), 'utf8')).records;
        } catch (error) {
          if (error.code === 'ENOENT') return {};
          throw error;
        }
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}
