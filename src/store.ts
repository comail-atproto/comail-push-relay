import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import type { SubscriptionRecord } from './types.js';

// Aligned with the JMAP PushSubscription expires the mobile client requests
// (90 days). The relay record gets refreshed on every push, so this only
// matters for users who go quiet for ~3 months.
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

export interface SubscriptionStore {
  get(id: string): Promise<SubscriptionRecord | null>;
  put(id: string, record: SubscriptionRecord): Promise<void>;
  delete(id: string): Promise<void>;
  size(): Promise<number>;
  sizeByKind(): Promise<{ fcm: number; web: number }>;
}

export class FileSubscriptionStore implements SubscriptionStore {
  private cache: Record<string, SubscriptionRecord> = {};
  private loaded = false;
  private pendingLoad: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir?: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(subscriptionsPath(this.dataDir), 'utf-8');
      const parsed = JSON.parse(raw) as SubscriptionsFile;
      this.cache = parsed.records ?? {};
      this.migrateLegacyRecords();
      this.evictExpired();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = {};
      } else {
        logger.warn('store: failed to read subscriptions', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        this.cache = {};
      }
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

  private evictExpired(): void {
    for (const [id, record] of Object.entries(this.cache)) {
      if (this.isExpired(record)) delete this.cache[id];
    }
  }

  // Older disk records lack a kind; treat them as FCM records.
  private migrateLegacyRecords(): void {
    for (const [id, record] of Object.entries(this.cache)) {
      const r = record as Partial<SubscriptionRecord> & { fcmToken?: string };
      if (!r.kind && typeof r.fcmToken === 'string') {
        this.cache[id] = { ...(r as object), kind: 'fcm' } as SubscriptionRecord;
      }
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
