import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import type { SubscriptionRecord } from './types.js';

// Match the client's 90-day expiry; each push refreshes this record.
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

function getPushDir(dataDir?: string): string {
  return (dataDir ?? process.env.PUSH_DATA_DIR) || path.join(process.cwd(), 'data');
}

function subscriptionsPath(dataDir?: string): string {
  return path.join(getPushDir(dataDir), 'subscriptions.json');
}

interface SubscriptionsFile {
  records: Record<string, SubscriptionRecord>;
}

function createRecords(records: Record<string, SubscriptionRecord> = {}): Record<string, SubscriptionRecord> {
  // Subscription IDs may match inherited object names.
  return Object.assign(Object.create(null), records);
}

export interface SubscriptionStore {
  get(id: string): Promise<SubscriptionRecord | null>;
  put(id: string, record: SubscriptionRecord): Promise<void>;
  delete(id: string): Promise<void>;
  size(): Promise<number>;
  sizeByKind(): Promise<{ fcm: number; web: number }>;
}

export class FileSubscriptionStore implements SubscriptionStore {
  private cache: Record<string, SubscriptionRecord> = createRecords();
  private loaded = false;
  private pendingLoad: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir?: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(subscriptionsPath(this.dataDir), 'utf-8');
      const parsed = JSON.parse(raw) as SubscriptionsFile;
      this.cache = createRecords(parsed.records ?? {});
      this.normalizeRecords();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('store: failed to read subscriptions', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      this.cache = createRecords();
    }
    this.loaded = true;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.pendingLoad) {
      this.pendingLoad = this.load().finally(() => { this.pendingLoad = null; });
    }
    await this.pendingLoad;
  }

  async get(id: string): Promise<SubscriptionRecord | null> {
    await this.ensureLoaded();
    const record = this.cache[id];
    if (!record) return null;
    if (this.isExpired(record)) {
      delete this.cache[id];
      await this.persist();
      return null;
    }
    return record;
  }

  async put(id: string, record: SubscriptionRecord): Promise<void> {
    await this.ensureLoaded();
    this.cache[id] = record;
    await this.persist();
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded();
    if (id in this.cache) {
      delete this.cache[id];
      await this.persist();
    }
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    return Object.keys(this.cache).length;
  }

  async sizeByKind(): Promise<{ fcm: number; web: number }> {
    await this.ensureLoaded();
    let fcm = 0;
    let web = 0;
    for (const record of Object.values(this.cache)) {
      if (record.kind === 'fcm') fcm++;
      else if (record.kind === 'web') web++;
    }
    return { fcm, web };
  }

  private isExpired(record: SubscriptionRecord): boolean {
    const age = Date.now() - (record.lastPushAt ?? record.createdAt);
    return age > TTL_MS;
  }

  private normalizeRecords(): void {
    for (const [id, record] of Object.entries(this.cache)) {
      const legacy = record as Partial<SubscriptionRecord> & { fcmToken?: string };
      // Old disk records lack kind and are FCM subscriptions.
      if (!legacy.kind && typeof legacy.fcmToken === 'string') legacy.kind = 'fcm';
      if (this.isExpired(record)) delete this.cache[id];
    }
  }

  private persist(): Promise<void> {
    const next = this.writeQueue.then(() => this.flush());
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async flush(): Promise<void> {
    const dir = getPushDir(this.dataDir);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const target = subscriptionsPath(this.dataDir);
    const tmp = target + '.tmp';
    const payload: SubscriptionsFile = { records: this.cache };
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    await rename(tmp, target);
  }
}

export const subscriptionStore = new FileSubscriptionStore();
