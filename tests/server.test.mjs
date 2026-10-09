import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

async function running(options, fn) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}
const body = { prompt: 'a car', size: '1024x1024', quality: 'low', transparent: true };
test('missing keys and foreign origins do not reach the provider', async () => {
  await running({ apiKey: '', fetchImpl: () => { throw new Error('Unexpected provider request'); } }, async url => {
    const missing = await fetch(`${url}/api/image`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(missing.status, 401);
    const foreign = await fetch(`${url}/api/image`, { method: 'POST', headers: { Origin: 'https://example.com' }, body: JSON.stringify(body) });
    assert.equal(foreign.status, 403);
    assert.equal((await fetch(`${url}/.env`)).status, 404);
  });
});
test('generation forwards a PNG request and returns provider image', async () => {
  await running({ apiKey: 'test-only', fetchImpl: async (url, options) => {
    assert.match(url, /images\/generations$/);
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    assert.equal(JSON.parse(options.body).background, 'transparent');
    return Response.json({ data: [{ b64_json: 'dGVzdA==' }] });
  } }, async url => {
    const response = await fetch(`${url}/api/image`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).image, 'data:image/png;base64,dGVzdA==');
  });
});
test('masked editing sends multipart image and mask, and surfaces provider errors', async () => {
  await running({ apiKey: 'test-only', fetchImpl: async (url, options) => {
    assert.match(url, /images\/edits$/);
    assert.equal(options.body.get('image').type, 'image/png');
    assert.equal(options.body.get('mask').type, 'image/png');
    return Response.json({ error: { message: 'Quota reached' } }, { status: 429 });
  } }, async url => {
    const response = await fetch(`${url}/api/image`, { method: 'POST', body: JSON.stringify({ ...body, image: 'data:image/png;base64,dGVzdA==', mask: 'data:image/png;base64,dGVzdA==' }) });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, 'Quota reached');
  });
});
