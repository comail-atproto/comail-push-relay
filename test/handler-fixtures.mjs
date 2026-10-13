import { Readable } from 'node:stream';

export function record(kind, overrides = {}) {
  const common = {
    verificationCode: null,
    createdAt: Date.now(),
    lastPushAt: null,
    ...overrides,
  };
  return kind === 'fcm'
    ? { ...common, kind, fcmToken: 'f'.repeat(64) }
    : {
        ...common,
        kind,
        webPush: {
          endpoint: 'https://push.example.test/subscription/123',
          keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
        },
      };
}

export function request(body, { method = 'POST', url = '/', headers = {} } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

export function response() {
  return {
    statusCode: 200,
    headersSent: false,
    body: '',
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
      this.headersSent = true;
    },
    end(body = '') {
      this.body = body.toString();
      this.headersSent = true;
    },
  };
}

export function memoryStore(records = new Map()) {
  return {
    records,
    async get(id) {
      const record = records.get(id);
      return record ? structuredClone(record) : null;
    },
    async put(id, value) {
      records.set(id, structuredClone(value));
    },
    async delete(id) {
      records.delete(id);
    },
  };
}

export function jsonBody(res) {
  return JSON.parse(res.body);
}
