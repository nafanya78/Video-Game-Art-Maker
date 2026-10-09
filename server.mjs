import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
export function validateRequest(body) {
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 30000) throw new Error('Enter a prompt of 1 to 30,000 characters.');
  if (!['1024x1024', '1536x1024', '1024x1536'].includes(body.size)) throw new Error('Unsupported image size.');
  if (!['low', 'medium', 'high'].includes(body.quality)) throw new Error('Unsupported quality.');
  if (body.image && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(body.image) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(body.mask || ''))) throw new Error('Image and mask must be PNG data.');
}
export function createServer({ fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY } = {}) {
  return http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/status' && req.method === 'GET') return json(200, { configured: Boolean(apiKey), model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5' });
      if (url.pathname === '/api/image' && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Cross-origin requests are not allowed.' });
        let raw = '', bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) return json(413, { error: 'Image request is too large.' }); raw += chunk; }
        let body;
        try { body = JSON.parse(raw); validateRequest(body); } catch (error) { return json(400, { error: error.message }); }
        const key = apiKey || req.headers['x-openai-key'];
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
