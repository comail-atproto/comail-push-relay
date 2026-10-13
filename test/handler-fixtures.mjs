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
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
      ));
      this.headersSent = true;
    },
    end(body = '') {
      this.body = body.toString();
      this.headersSent = true;
    },
  };
}

export function fakeStore(records) {
  const calls = { gets: [], puts: [], deletes: [] };
  return {
    calls,
    async get(id) {
      calls.gets.push(id);
      return records.get(id) ?? null;
    },
    async put(id, value) {
      calls.puts.push({ id, record: { ...value } });
    },
    async delete(id) {
      calls.deletes.push(id);
    },
  };
}

export function jsonBody(res) {
  return JSON.parse(res.body);
}
