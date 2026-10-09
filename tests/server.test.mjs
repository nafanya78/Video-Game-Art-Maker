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

test('Google uses only its own key and reports provider configuration without secrets', async () => {
  await running({ apiKey: 'openai-secret', googleApiKey: '', fetchImpl: () => { throw new Error('Unexpected call'); } }, async url => {
    const status = await (await fetch(`${url}/api/status`)).json();
    assert.equal(status.providers.openai.configured, true);
    assert.equal(status.providers.google.configured, false);
    assert.ok(!JSON.stringify(status).includes('openai-secret'));
    const response = await fetch(`${url}/api/image`, { method: 'POST', headers: { 'X-OpenAI-Key': 'wrong-provider-key' }, body: JSON.stringify({ ...body, provider: 'google', transparent: false }) });
    assert.equal(response.status, 401);
  });
});
test('Google generates images and skips thought images in the response', async () => {
  await running({ apiKey: 'unused-openai', googleApiKey: 'server-google', fetchImpl: async (url, options) => {
    assert.match(url, /^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/gemini-3.1-flash-image:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'session-google');
    assert.equal(options.headers.Authorization, undefined);
    const payload = JSON.parse(options.body);
    assert.equal(payload.generationConfig.imageConfig.aspectRatio, '3:2');
    assert.deepEqual(payload.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
    return Response.json({ candidates: [{ content: { parts: [
      { thought: true, inlineData: { mimeType: 'image/png', data: 'dGhvdWdodA==' } },
      { inlineData: { mimeType: 'image/jpeg', data: 'dGVzdA==' } }
    ] } }] });
  } }, async url => {
    const response = await fetch(`${url}/api/image`, { method: 'POST', headers: { 'X-Google-Key': 'session-google' }, body: JSON.stringify({ ...body, provider: 'google', model: 'gemini-3.1-flash-image', size: '1536x1024', transparent: false }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).image, 'data:image/jpeg;base64,dGVzdA==');
  });
});
test('Google edits send the source and selection guide and preserve quota errors', async () => {
  await running({ googleApiKey: 'test-google', fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body), parts = payload.contents[0].parts;
    assert.match(parts[0].text, /white means edit, black means preserve/);
    assert.equal(parts[1].inlineData.data, 'c291cmNl');
    assert.equal(parts[2].inlineData.data, 'c2VsZWN0aW9u');
    return Response.json({ error: { message: 'Google quota exceeded' } }, { status: 429 });
  } }, async url => {
    const response = await fetch(`${url}/api/image`, { method: 'POST', body: JSON.stringify({ ...body, provider: 'google', transparent: false, image: 'data:image/png;base64,c291cmNl', mask: 'data:image/png;base64,bWFzaw==', selection: 'data:image/png;base64,c2VsZWN0aW9u' }) });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, 'Google quota exceeded');
  });
});
test('Google missing image output is an actionable error', async () => {
  await running({ googleApiKey: 'test-google', fetchImpl: async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Please specify the desired object.' }] } }] }) }, async url => {
    const response = await fetch(`${url}/api/image`, { method: 'POST', body: JSON.stringify({ ...body, provider: 'google', transparent: false }) });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Please specify the desired object/);
  });
});
test('invalid provider, model, unsupported transparency, and missing guide fail before billing', async () => {
  await running({ googleApiKey: 'test-google', fetchImpl: () => { throw new Error('Unexpected call'); } }, async url => {
    for (const overrides of [{ provider: 'other' }, { provider: 'google', model: '../invalid' }, { provider: 'google', transparent: true }, { provider: 'google', transparent: false, image: 'data:image/png;base64,c291cmNl', mask: 'data:image/png;base64,bWFzaw==' }]) {
      const response = await fetch(`${url}/api/image`, { method: 'POST', body: JSON.stringify({ ...body, ...overrides }) });
      assert.equal(response.status, 400);
    }
  });
});
