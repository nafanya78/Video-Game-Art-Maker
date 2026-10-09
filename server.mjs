import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
export function validateRequest(body) {
  if (!body || typeof body !== 'object') throw new Error('Invalid image request.');
  if (body.provider !== undefined && !['openai', 'google'].includes(body.provider)) throw new Error('Unsupported AI provider.');
  if (body.provider === 'google' && body.model && !['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3-pro-image'].includes(body.model)) throw new Error('Unsupported Google image model.');
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 30000) throw new Error('Enter a prompt of 1 to 30,000 characters.');
  if (!['1024x1024', '1536x1024', '1024x1536'].includes(body.size)) throw new Error('Unsupported image size.');
  if (!['low', 'medium', 'high'].includes(body.quality)) throw new Error('Unsupported quality.');
  if (body.image && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(body.image) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(body.mask || ''))) throw new Error('Image and mask must be PNG data.');
  if (body.provider === 'google' && body.image && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(body.selection || '')) throw new Error('Google edits require a PNG selection guide.');
}
async function googleImage(body, key, fetchImpl) {
  const model = body.model || process.env.GOOGLE_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const parts = [{ text: body.image
    ? `${body.prompt}\nImage 1 is the original artwork. Image 2 is a black-and-white selection guide, not artwork: white means edit, black means preserve. Return the complete edited version of image 1, with exactly the same framing and composition. Do not render the selection guide in the output.`
    : `${body.prompt}\nReturn a single game asset image.` }];
  if (body.image) for (const image of [body.image, body.selection]) parts.push({ inlineData: { mimeType: 'image/png', data: image.split(',')[1] } });
  const aspectRatio = { '1024x1024': '1:1', '1536x1024': '3:2', '1024x1536': '2:3' }[body.size];
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } } }),
    signal: AbortSignal.timeout(240000)
  });
  const data = await response.json();
  if (!response.ok) return { status: response.status, data: { error: data.error?.message || 'Google rejected the image request.' } };
  const candidate = data.candidates?.[0];
  const image = candidate?.content?.parts?.find(part => !part.thought && /^image\/(png|jpeg|webp)$/.test(part.inlineData?.mimeType) && part.inlineData?.data)?.inlineData;
  if (!image) {
    const explanation = candidate?.content?.parts?.filter(part => !part.thought && part.text).map(part => part.text).join(' ');
    const reason = data.promptFeedback?.blockReason || candidate?.finishReason;
    return { status: 502, data: { error: `Google returned no image.${reason ? ` (${reason})` : ''}${explanation ? ` ${explanation.slice(0, 1500)}` : ' Try a different prompt or image model.'}` } };
  }
  return { status: 200, data: { image: `data:${image.mimeType};base64,${image.data}` } };
}
export function createServer({ fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, googleApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY } = {}) {
  return http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/status' && req.method === 'GET') return json(200, {
        configured: Boolean(apiKey), model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5',
        providers: { openai: { configured: Boolean(apiKey), model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5' }, google: { configured: Boolean(googleApiKey), model: process.env.GOOGLE_IMAGE_MODEL || 'gemini-3.1-flash-image' } }
      });
      if (url.pathname === '/api/image' && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Cross-origin requests are not allowed.' });
        let raw = '', bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) return json(413, { error: 'Image request is too large.' }); raw += chunk; }
        let body;
        try { body = JSON.parse(raw); validateRequest(body); } catch (error) { return json(400, { error: error.message }); }
        if (body.provider === 'google') {
          const key = req.headers['x-google-key'] || googleApiKey;
          if (!key) return json(401, { error: 'Add a Google AI Studio API key in AI Connection to generate or edit images.' });
          if (body.transparent) return json(400, { error: 'Google image generation does not support transparent backgrounds. Turn off Transparent background.' });
          const result = await googleImage(body, key, fetchImpl);
          return json(result.status, result.data);
        }
        const key = req.headers['x-openai-key'] || apiKey;
        if (!key) return json(401, { error: 'Connect an OpenAI API key in Settings to generate or edit images.' });
        const params = { model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5', prompt: body.prompt, size: body.size, quality: body.quality, background: body.transparent ? 'transparent' : 'opaque', output_format: 'png', n: 1 };
        let payload, headers = { Authorization: `Bearer ${key}` };
        if (body.image) {
          payload = new FormData();
          for (const [key, value] of Object.entries(params)) payload.append(key, String(value));
          payload.append('image', new Blob([Buffer.from(body.image.split(',')[1], 'base64')], { type: 'image/png' }), 'image.png');
          payload.append('mask', new Blob([Buffer.from(body.mask.split(',')[1], 'base64')], { type: 'image/png' }), 'mask.png');
        } else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(params); }
        const response = await fetchImpl(`https://api.openai.com/v1/images/${body.image ? 'edits' : 'generations'}`, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(240000) });
        const data = await response.json();
        if (!response.ok) return json(response.status, { error: data.error?.message || 'Image provider rejected the request.' });
        if (!data.data?.[0]?.b64_json) return json(502, { error: 'Image provider returned no image.' });
        return json(200, { image: `data:image/png;base64,${data.data[0].b64_json}` });
      }
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
      const routes = { '/vendor/konva.js': 'node_modules/konva/konva.min.js', '/vendor/lucide.js': 'node_modules/lucide/dist/umd/lucide.js' };
      const relative = routes[url.pathname] || `public/${url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1)}`;
      const file = path.resolve(root, relative);
      if (!file.startsWith(path.join(root, routes[url.pathname] ? 'node_modules' : 'public') + path.sep)) return json(403, { error: 'Forbidden' });
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(data);
    } catch (error) { json(error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found' : error.name === 'TimeoutError' ? 'Generation timed out. Try again.' : 'Request failed. Please try again.' }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  let port = Number(process.env.PORT || 4317);
  server.on('error', error => { if (error.code === 'EADDRINUSE') server.listen(++port, '127.0.0.1'); else throw error; });
  server.listen(port, '127.0.0.1', () => console.log(`Art Maker running at http://127.0.0.1:${port}`));
}
