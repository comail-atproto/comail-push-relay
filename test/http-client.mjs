export function createHttpClient(base, close) {
  const request = (path, init) => fetch(`${base}${path}`, init);
  const json = async (path, init) => {
    const response = await request(path, init);
    return { status: response.status, body: await response.json() };
  };
  return {
    request,
    json,
    post: (path, body, authorization) => json(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    }),
    close,
  };
}
