const $ = id => document.getElementById(id);
const icons = () => lucide.createIcons();
const canvas = (w = width, h = height) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const loadImage = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Could not read image.')); image.src = src; });
let width = 1024, height = 1024, scale = .5, tool = 'move', selected = null, layers = [], frames = [[]], frameIndex = 0;
let history = [], future = [], busy = false, playing = false, playTimer, drawing = null, hasMask = false;
let provider = 'openai', googleModel = '', openaiTransparent = true;
let fitMode = true, spacePan = false, panning = null;
const keys = { openai: '', google: '' }, configured = { openai: false, google: false };
const stage = new Konva.Stage({ container: 'stage', width: 512, height: 512 });
const scene = new Konva.Layer(), overlay = new Konva.Layer();
stage.add(scene, overlay);
let mask = canvas();
const maskNode = new Konva.Image({ image: mask, opacity: .48, listening: false });
const boxOutline = new Konva.Rect({ stroke: '#ffb2cc', strokeWidth: 1, dash: [6, 4], listening: false, visible: false });
const onionNode = new Konva.Image({ opacity: .2, listening: false });
const transformer = new Konva.Transformer({ borderStroke: '#9cedb4', anchorStroke: '#9cedb4', anchorFill: '#222327', anchorSize: 8, rotateAnchorOffset: 24, flipEnabled: false, boundBoxFunc: (old, next) => Math.abs(next.width) < 4 || Math.abs(next.height) < 4 ? old : next });
overlay.add(maskNode, boxOutline, transformer);
scene.add(onionNode);
const status = message => { $('status').textContent = message; $('status').title = message; };
function serializeLayers() { return layers.map(l => ({ id: l.id, name: l.name, visible: l.node.visible(), opacity: l.node.opacity(), x: l.node.x(), y: l.node.y(), scaleX: l.node.scaleX(), scaleY: l.node.scaleY(), rotation: l.node.rotation(), data: l.canvas.toDataURL() })); }
function syncFrame() { frames[frameIndex] = serializeLayers(); }
function project() { syncFrame(); return { format: 'artmaker', version: 1, width, height, name: $('project-name').value, fps: Number($('fps').value), frames: structuredClone(frames), frameIndex, selected }; }
function remember() { history.push(project()); if (history.length > 20) history.shift(); future = []; updateUndo(); }
function updateUndo() { $('undo').disabled = !history.length || busy || playing; $('redo').disabled = !future.length || busy || playing; }
function active() { return layers.find(l => l.id === selected); }
function setBusy(value, message) { busy = value; document.body.classList.toggle('busy', value); updateUndo(); if (message) status(message); }
async function guarded(fn) { if (busy || playing) return; try { await fn(); } catch (error) { status(error.message); } }
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
function downloadJSON(data, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); download(url, name); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function filename() { return ($('project-name').value || 'asset').replace(/[^a-z0-9_-]/gi, '-'); }
function addLayer(buffer, name = 'Paint layer', attrs = {}) {
  const id = attrs.id || crypto.randomUUID();
  const node = new Konva.Image({ image: buffer, x: attrs.x || 0, y: attrs.y || 0, scaleX: attrs.scaleX ?? 1, scaleY: attrs.scaleY ?? 1, rotation: attrs.rotation || 0, opacity: attrs.opacity ?? 1, visible: attrs.visible ?? true, draggable: tool === 'move', name: id });
  const layer = { id, name, canvas: buffer, node }; layers.push(layer); scene.add(node);
  node.on('click tap', () => { if (tool === 'move' && !playing && !busy) select(id); });
  node.on('dragstart transformstart', () => { if (!busy && !playing) { remember(); select(id); } });
  node.on('dragend transformend', () => { renderLayers(); renderFrames(); });
  selected = id; return layer;
}
function updateTransformer() {
  const node = tool === 'move' && !playing && active()?.node.visible() ? active().node : null;
  const current = transformer.nodes();
  if (current.length !== (node ? 1 : 0) || node && current[0] !== node) transformer.nodes(node ? [node] : []);
}
function select(id) { selected = id; renderLayers(); }
function renderLayers() {
  $('layers').replaceChildren();
  for (const l of [...layers].reverse()) {
    const row = document.createElement('div'); row.className = `layer ${l.id === selected ? 'selected' : ''}`; row.dataset.id = l.id;
    row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `Select ${l.name}`);
    const thumb = document.createElement('img'); thumb.src = l.canvas.toDataURL(); thumb.alt = '';
    const title = document.createElement('span'); title.className = 'layer-title'; title.textContent = l.name;
    const visibility = document.createElement('button'); visibility.title = l.node.visible() ? 'Hide layer' : 'Show layer'; visibility.setAttribute('aria-label', `${visibility.title} ${l.name}`); visibility.innerHTML = `<i data-lucide="${l.node.visible() ? 'eye' : 'eye-off'}"></i>`;
    visibility.onclick = e => { e.stopPropagation(); if (busy || playing) return; remember(); l.node.visible(!l.node.visible()); select(selected); renderFrames(); };
    row.onclick = () => { if (!busy && !playing) select(l.id); }; row.onkeydown = e => { if (e.key === 'Enter') row.click(); };
    row.append(thumb, title, visibility); $('layers').append(row);
  }
  const l = active(); $('layer-properties').hidden = !l;
  if (l) { $('layer-name').value = l.name; $('opacity').value = Math.round(l.node.opacity() * 100); $('opacity-value').textContent = `${$('opacity').value}%`; }
  $('empty').hidden = layers.length > 0;
  updateTransformer();
  $('layer-up').disabled = !l || layers.indexOf(l) === layers.length - 1; $('layer-down').disabled = !l || layers.indexOf(l) === 0;
  icons(); scene.batchDraw(); overlay.batchDraw();
}
function drawLayer(ctx, l) { const n = l.node; ctx.save(); ctx.globalAlpha = n.opacity(); ctx.translate(n.x(), n.y()); ctx.rotate(n.rotation() * Math.PI / 180); ctx.scale(n.scaleX(), n.scaleY()); ctx.drawImage(l.canvas, 0, 0); ctx.restore(); }
function composite() { const result = canvas(); const ctx = result.getContext('2d'); for (const l of layers) if (l.node.visible()) drawLayer(ctx, l); return result; }
function rasterize(l) { const result = canvas(); const ctx = result.getContext('2d'); const opacity = l.node.opacity(); l.node.opacity(1); drawLayer(ctx, l); l.node.opacity(opacity); return result; }
function replaceBuffer(l, buffer) { l.canvas = buffer; l.node.image(buffer); l.node.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }); }
async function renderStored(data) { const result = canvas(); const ctx = result.getContext('2d'); for (const l of data) { if (!l.visible) continue; const image = await loadImage(l.data); ctx.save(); ctx.globalAlpha = l.opacity; ctx.translate(l.x, l.y); ctx.rotate(l.rotation * Math.PI / 180); ctx.scale(l.scaleX, l.scaleY); ctx.drawImage(image, 0, 0); ctx.restore(); } return result; }
let frameRenderVersion = 0;
async function renderFrames() {
  syncFrame(); const version = ++frameRenderVersion;
  const thumbs = await Promise.all(frames.map(frame => renderStored(frame)));
  if (version !== frameRenderVersion) return;
  $('frames').replaceChildren();
  thumbs.forEach((buffer, i) => { const button = document.createElement('button'); button.className = `frame ${i === frameIndex ? 'active' : ''}`; button.setAttribute('aria-label', `Frame ${i + 1}`); const img = document.createElement('img'); img.src = buffer.toDataURL(); img.alt = ''; button.append(img, document.createTextNode(String(i + 1).padStart(2, '0'))); button.onclick = () => guarded(() => switchFrame(i)); $('frames').append(button); });
  $('frame-count').textContent = `${frames.length} frame${frames.length === 1 ? '' : 's'}`;
  $('delete-frame').disabled = frames.length <= 1; $('play').disabled = frames.length <= 1;
  onionNode.image(frameIndex > 0 ? thumbs[frameIndex - 1] : null); onionNode.visible($('onion').checked && frameIndex > 0 && !playing); scene.batchDraw();
}
async function loadLayers(data) {
  const buffers = await Promise.all(data.map(async l => { const img = await loadImage(l.data); const buffer = canvas(img.width, img.height); buffer.getContext('2d').drawImage(img, 0, 0); return buffer; }));
  transformer.nodes([]); layers.forEach(l => l.node.destroy()); layers = [];
  data.forEach((l, i) => addLayer(buffers[i], l.name, l)); selected = layers.at(-1)?.id || null; renderLayers();
}
async function switchFrame(index) { syncFrame(); setBusy(true); try { await loadLayers(frames[index]); frameIndex = index; clearMask(); await renderFrames(); } finally { setBusy(false); } }
function resizeCanvas() { mask = canvas(); maskNode.image(mask); hasMask = false; $('dimensions').textContent = `${width} x ${height}`; if (fitMode) fit(); else zoom(scale); }
function zoom(next, anchor, fitting = false) {
  if (drawing || panning || !Number.isFinite(next)) return;
  fitMode = fitting;
  const viewport = $('viewport'), board = $('artboard');
  const viewRect = viewport.getBoundingClientRect(), oldRect = board.getBoundingClientRect();
  const focus = anchor || { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
  const imagePoint = { x: (viewRect.left + focus.x - oldRect.left) / scale, y: (viewRect.top + focus.y - oldRect.top) / scale };
  scale = Math.max(.1, Math.min(8, next));
  // Magnify source pixels with CSS above 100%, keeping backing canvases bounded at document resolution.
  const renderScale = Math.min(scale, 1), displayScale = scale / renderScale;
  stage.size({ width: width * renderScale, height: height * renderScale });
  stage.scale({ x: renderScale, y: renderScale });
  Object.assign(stage.container().style, { width: `${width * renderScale}px`, height: `${height * renderScale}px`, transform: `scale(${displayScale})`, transformOrigin: 'top left' });
  board.style.width = `${width * scale}px`; board.style.height = `${height * scale}px`;
  board.classList.toggle('magnified', scale > 1);
  transformer.setAttrs({ anchorSize: 8 / displayScale, borderStrokeWidth: 1 / displayScale, anchorStrokeWidth: 1 / displayScale, rotateAnchorOffset: 24 / displayScale });
  transformer.find('._anchor').forEach(anchor => anchor.hitStrokeWidth(Math.max(2, 16 / displayScale)));
  boxOutline.setAttrs({ strokeWidth: 1 / scale, dash: [6 / scale, 4 / scale] });
  $('zoom-value').value = Math.round(scale * 100);
  $('zoom-in').disabled = scale >= 8; $('zoom-out').disabled = scale <= .1;
  if (fitting) { viewport.scrollLeft = 0; viewport.scrollTop = 0; }
  else {
    const newRect = board.getBoundingClientRect();
    viewport.scrollLeft += newRect.left - viewRect.left + imagePoint.x * scale - focus.x;
    viewport.scrollTop += newRect.top - viewRect.top + imagePoint.y * scale - focus.y;
  }
  stage.draw();
}
function fit() {
  const viewport = $('viewport'), style = getComputedStyle(viewport);
  const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  zoom(Math.min(availableWidth / width, availableHeight / height, 1), null, true);
}
function clearMask() { mask.getContext('2d').clearRect(0, 0, width, height); boxOutline.hide(); hasMask = false; $('selection-state').textContent = 'None'; overlay.batchDraw(); }
function setTool(next) { finishStroke(); tool = next; document.querySelectorAll('[data-tool]').forEach(b => { b.classList.toggle('active', b.dataset.tool === tool); b.setAttribute('aria-pressed', String(b.dataset.tool === tool)); }); layers.forEach(l => l.node.draggable(tool === 'move')); updateCursor(); select(selected); }
function updateCursor() { const cursor = panning ? 'grabbing' : tool === 'pan' || spacePan ? 'grab' : tool === 'move' ? 'default' : 'crosshair'; stage.container().style.cursor = cursor; $('viewport').style.cursor = tool === 'pan' || spacePan || panning ? cursor : 'default'; }
function point(event) { const rect = stage.content.getBoundingClientRect(); return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height }; }
function stroke(from, to) {
  const { target, mode, color, size } = drawing, ctx = target.getContext('2d'); ctx.save(); ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'; ctx.strokeStyle = mode === 'select' ? '#ff749c' : color; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.beginPath(); ctx.arc(to.x, to.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  if (mode === 'select') { hasMask = true; $('selection-state').textContent = 'Painted selection'; overlay.batchDraw(); } else scene.batchDraw();
}
function drawBox(to) {
  const clamp = p => ({ x: Math.max(0, Math.min(width, p.x)), y: Math.max(0, Math.min(height, p.y)) });
  const from = clamp(drawing.start), end = clamp(to);
  const x = Math.floor(Math.min(from.x, end.x)), y = Math.floor(Math.min(from.y, end.y));
  const w = Math.ceil(Math.max(from.x, end.x)) - x, h = Math.ceil(Math.max(from.y, end.y)) - y;
  const ctx = mask.getContext('2d'); ctx.clearRect(0, 0, width, height);
  if (drawing.base) ctx.drawImage(drawing.base, 0, 0);
  ctx.fillStyle = '#ff749c'; if (from.x !== end.x && from.y !== end.y) ctx.fillRect(x, y, w, h);
  const nonempty = from.x !== end.x && from.y !== end.y;
  hasMask = nonempty || drawing.hadMask;
  boxOutline.setAttrs({ x, y, width: w, height: h, visible: nonempty, strokeWidth: 1 / scale, dash: [6 / scale, 4 / scale] });
  $('selection-state').textContent = nonempty ? `${w} x ${h} selected` : hasMask ? 'Selection' : 'None';
  overlay.batchDraw();
}
// Capture and listen on the same DOM surface; capturing the parent bypasses Konva's movement listeners.
const drawingSurface = stage.content;
drawingSurface.addEventListener('pointerdown', event => {
  if (busy || playing || drawing || panning || spacePan || ['move', 'pan'].includes(tool) || event.button !== 0 || event.isPrimary === false) return;
  event.preventDefault(); const p = point(event), selecting = tool === 'select' || tool === 'box';
  if (!selecting) { if (!active()?.node.visible()) return status('Select a visible layer first.'); remember(); replaceBuffer(active(), rasterize(active())); }
  const base = tool === 'box' && event.shiftKey ? canvas() : null;
  if (base) base.getContext('2d').drawImage(mask, 0, 0);
  boxOutline.hide();
  drawing = { mode: tool, target: selecting ? mask : active().canvas, start: p, last: p, pointerId: event.pointerId, base, hadMask: Boolean(base && hasMask), color: $('color').value, size: Number($('brush-size').value) };
  drawingSurface.setPointerCapture(event.pointerId);
  if (tool === 'box') drawBox(p); else stroke(p, p);
});
function continueStroke(event) {
  if (!drawing || event.pointerId !== drawing.pointerId) return;
  event.preventDefault();
  const p = point(event);
  if (drawing.mode === 'box') drawBox(p); else stroke(drawing.last, p);
  drawing.last = p;
}
function finishStroke(event) {
  if (!drawing || (event?.pointerId !== undefined && event.pointerId !== drawing.pointerId)) return;
  if (event?.type === 'pointerup') continueStroke(event);
  const completed = drawing; drawing = null;
  if (drawingSurface.hasPointerCapture(completed.pointerId)) drawingSurface.releasePointerCapture(completed.pointerId);
  if (!['select', 'box'].includes(completed.mode)) { renderLayers(); renderFrames(); }
}
drawingSurface.addEventListener('pointermove', continueStroke);
drawingSurface.addEventListener('pointerup', finishStroke);
drawingSurface.addEventListener('pointercancel', finishStroke);
drawingSurface.addEventListener('lostpointercapture', finishStroke);
const viewport = $('viewport');
viewport.addEventListener('pointerdown', event => {
  if (busy || playing || drawing || panning || event.isPrimary === false || !(event.button === 1 || event.button === 0 && (tool === 'pan' || spacePan))) return;
  event.preventDefault(); event.stopImmediatePropagation();
  panning = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId); updateCursor();
}, true);
viewport.addEventListener('pointermove', event => {
  if (!panning || event.pointerId !== panning.pointerId) return;
  event.preventDefault(); event.stopImmediatePropagation();
  viewport.scrollLeft = panning.left + panning.x - event.clientX;
  viewport.scrollTop = panning.top + panning.y - event.clientY;
}, true);
function finishPan(event) {
  if (!panning || event?.pointerId !== undefined && event.pointerId !== panning.pointerId) return;
  const { pointerId } = panning; panning = null;
  if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
  updateCursor();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(type, finishPan);
viewport.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
viewport.addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault(); if (busy || playing || drawing || panning) return;
  const rect = viewport.getBoundingClientRect(), unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
  zoom(scale * Math.exp(-Math.max(-500, Math.min(500, event.deltaY * unit)) * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
}, { passive: false });
window.addEventListener('keydown', event => {
  if (event.code !== 'Space' || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.tagName === 'BUTTON' && !viewport.matches(':hover') || document.querySelector('dialog[open]')) return;
  event.preventDefault(); spacePan = true; updateCursor();
});
window.addEventListener('keyup', event => { if (event.code === 'Space') { spacePan = false; updateCursor(); } });
window.addEventListener('blur', () => { finishStroke(); finishPan(); spacePan = false; updateCursor(); });
function requireSelection() { if (!active()?.node.visible()) throw new Error('Select a visible layer first.'); if (!hasMask) throw new Error('Select the part to edit with the painted or box selection tool first.'); }
function applyMask(source, operation = 'destination-in') { const ctx = source.getContext('2d'); ctx.save(); ctx.globalCompositeOperation = operation; ctx.drawImage(mask, 0, 0); ctx.restore(); return source; }
function cropContent(buffer) { const ctx = buffer.getContext('2d'), data = ctx.getImageData(0, 0, width, height).data; let x0 = width, y0 = height, x1 = -1, y1 = -1; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } if (x1 < 0) throw new Error('The selection contains no pixels on this layer.'); const result = canvas(x1 - x0 + 1, y1 - y0 + 1); result.getContext('2d').drawImage(buffer, x0, y0, result.width, result.height, 0, 0, result.width, result.height); return { buffer: result, x: x0, y: y0 }; }
async function importImage(src, name) { const img = await loadImage(src); if (img.width * img.height > 16000000) throw new Error('Please import an image under 16 megapixels.'); remember(); const buffer = canvas(); const factor = Math.min(width / img.width, height / img.height); buffer.getContext('2d').drawImage(img, (width - img.width * factor) / 2, (height - img.height * factor) / 2, img.width * factor, img.height * factor); addLayer(buffer, name); setTool('move'); renderLayers(); await renderFrames(); status(`Added ${name}`); }
async function restore(data) { width = data.width; height = data.height; frames = structuredClone(data.frames); frameIndex = data.frameIndex || 0; $('project-name').value = data.name; $('fps').value = data.fps; $('size').value = `${width}x${height}`; resizeCanvas(); await loadLayers(frames[frameIndex]); selected = layers.some(l => l.id === data.selected) ? data.selected : layers.at(-1)?.id; clearMask(); renderLayers(); await renderFrames(); }
function validateProject(data) {
  if (data.format !== 'artmaker' || data.version !== 1 || ![[1024,1024],[1536,1024],[1024,1536]].some(([w,h]) => data.width === w && data.height === h)) throw new Error('Unsupported project format or dimensions.');
  if (!Array.isArray(data.frames) || !data.frames.length || data.frames.length > 48 || !Number.isInteger(data.frameIndex) || data.frameIndex < 0 || data.frameIndex >= data.frames.length) throw new Error('Invalid animation frames.');
  if (!Number.isFinite(data.fps) || data.fps < 1 || data.fps > 30) throw new Error('Invalid animation speed.');
  for (const frame of data.frames) { if (!Array.isArray(frame) || frame.length > 40) throw new Error('Invalid layers.'); for (const l of frame) { if (typeof l.name !== 'string' || typeof l.id !== 'string' || typeof l.visible !== 'boolean' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(l.data || '') || ['x','y','scaleX','scaleY','rotation','opacity'].some(k => !Number.isFinite(l[k])) || l.opacity < 0 || l.opacity > 1) throw new Error('Invalid layer data.'); } }
}
async function aiRequest(edit) {
  if (!configured[provider] && !keys[provider]) { openConnection(); return; }
  if (edit) requireSelection();
  const prompt = (edit ? $('edit-prompt') : $('prompt')).value.trim(); if (!prompt) throw new Error('Enter a prompt first.');
  const request = { prompt: edit ? `Edit only the masked region of this game asset. ${prompt}. Preserve the view, lighting, and all unmasked details.` : `${prompt}\nGame asset: ${$('asset-type').value}. Style: ${$('style').value}. No watermark.`, size: `${width}x${height}`, quality: $('quality').value, transparent: $('transparent').checked };
  request.provider = provider;
  if (provider === 'google' && googleModel) request.model = googleModel;
  let original, target, selection;
  if (edit) { target = active(); original = rasterize(target); selection = canvas(); selection.getContext('2d').drawImage(mask, 0, 0); const inverse = canvas(); const ctx = inverse.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mask,0,0); request.image = original.toDataURL(); request.mask = inverse.toDataURL(); }
  if (edit && provider === 'google') {
    const guide = canvas(), ctx = guide.getContext('2d');
    ctx.drawImage(selection, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
    request.selection = guide.toDataURL();
  }
  setBusy(true, edit ? 'AI is editing your selection...' : 'Generating asset...');
  try {
    const response = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(keys[provider] ? { [provider === 'google' ? 'X-Google-Key' : 'X-OpenAI-Key']: keys[provider] } : {}) }, body: JSON.stringify(request) }); const result = await response.json(); if (!response.ok) throw new Error(result.error);
    const img = await loadImage(result.image); const buffer = canvas(); buffer.getContext('2d').drawImage(img,0,0,width,height); remember();
    if (edit) {
      // Composite pixel-by-pixel so all unselected pixels remain byte-for-byte unchanged.
      const ctx = original.getContext('2d'), before = ctx.getImageData(0,0,width,height), after = buffer.getContext('2d').getImageData(0,0,width,height), alpha = selection.getContext('2d').getImageData(0,0,width,height).data;
      for (let i=0;i<before.data.length;i+=4) { const a=alpha[i+3]/255; if (a) for(let c=0;c<4;c++) before.data[i+c]=Math.round(before.data[i+c]*(1-a)+after.data[i+c]*a); }
      ctx.putImageData(before,0,0); target.node.visible(false); const added = addLayer(original, `${target.name} edit`, { opacity: target.node.opacity() }); const at = layers.indexOf(target); layers.splice(layers.indexOf(added),1); layers.splice(at+1,0,added); reorder(); clearMask();
    } else addLayer(buffer, `${$('asset-type').value} ${layers.length + 1}`);
    setTool('move'); renderLayers(); await renderFrames(); status(edit ? 'Selected part updated. Original layer preserved.' : 'Generated asset added as a layer.');
  } finally { setBusy(false); }
}
function reorder() { onionNode.moveToBottom(); layers.forEach((l,i) => l.node.zIndex(i+1)); }
function handle(id, fn) { $(id).onclick = () => guarded(fn); }
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { if (!playing && !busy) setTool(b.dataset.tool); });
handle('generate', () => aiRequest(false)); handle('ai-edit', () => aiRequest(true));
handle('clear-mask', clearMask);
handle('extract', () => { requireSelection(); const l = active(), source = rasterize(l), extracted = cropContent(applyMask(rasterize(l))); remember(); replaceBuffer(l, applyMask(source, 'destination-out')); addLayer(extracted.buffer, `${l.name} part`, { x: extracted.x, y: extracted.y, opacity: l.node.opacity() }); clearMask(); setTool('move'); renderLayers(); renderFrames(); status('Part extracted. Drag its handles to resize.'); });
handle('remove-part', () => { requireSelection(); remember(); replaceBuffer(active(), applyMask(rasterize(active()),'destination-out')); clearMask(); renderLayers(); renderFrames(); status('Selected pixels removed.'); });
handle('recolor-part', () => {
  requireSelection(); remember(); const l=active(), buffer=rasterize(l), ctx=buffer.getContext('2d'), pixels=ctx.getImageData(0,0,width,height), selection=mask.getContext('2d').getImageData(0,0,width,height).data; const color=$('color').value.match(/\w\w/g).map(v=>parseInt(v,16));
  for(let i=0;i<pixels.data.length;i+=4) { const amount=selection[i+3]/255; if(!amount||!pixels.data[i+3]) continue; const light=Math.max(pixels.data[i],pixels.data[i+1],pixels.data[i+2])/255; for(let c=0;c<3;c++) pixels.data[i+c]=Math.round(pixels.data[i+c]*(1-amount)+color[c]*light*amount); }
  ctx.putImageData(pixels,0,0); replaceBuffer(l,buffer); renderLayers(); renderFrames(); status('Selection recolored with the brush color.');
});
handle('add-layer', () => { remember(); addLayer(canvas()); renderLayers(); renderFrames(); });
handle('delete-layer', () => { if (!active()) return; remember(); active().node.destroy(); layers=layers.filter(l=>l.id!==selected); selected=layers.at(-1)?.id; renderLayers(); renderFrames(); });
handle('duplicate-layer', () => { if(!active())return; remember(); const l=active(), buffer=canvas(l.canvas.width,l.canvas.height); buffer.getContext('2d').drawImage(l.canvas,0,0); const data=serializeLayers().find(x=>x.id===l.id); delete data.id; addLayer(buffer,`${l.name} copy`,data); renderLayers(); renderFrames(); });
for(const [id,delta] of [['layer-up',1],['layer-down',-1]]) handle(id,()=>{const index=layers.indexOf(active()),next=index+delta;if(index<0||next<0||next>=layers.length)return;remember();[layers[index],layers[next]]=[layers[next],layers[index]];reorder();renderLayers();renderFrames();});
$('layer-name').onchange=()=>{if(!active()||busy||playing)return;remember();active().name=$('layer-name').value.trim()||'Layer';renderLayers();renderFrames();};
$('opacity').onchange=()=>{if(!active()||busy||playing)return;remember();active().node.opacity(Number($('opacity').value)/100);renderLayers();renderFrames();};
$('brush-size').oninput=()=>{$('brush-value').textContent=$('brush-size').value;};
handle('undo',async()=>{if(!history.length)return;const current=project(),previous=history.pop();setBusy(true);try{future.push(current);await restore(previous);}finally{setBusy(false);}status('Undone');});
handle('redo',async()=>{if(!future.length)return;const current=project(),next=future.pop();setBusy(true);try{history.push(current);await restore(next);}finally{setBusy(false);}status('Redone');});
handle('zoom-in',()=>zoom(scale*1.2));handle('zoom-out',()=>zoom(scale/1.2));handle('fit',fit);
$('zoom-value').onchange = () => { if (!busy && !playing) zoom(Number($('zoom-value').value) / 100); };
$('zoom-value').onkeydown = event => { if (event.key === 'Enter') $('zoom-value').blur(); };
handle('import-image',()=>$('image-file').click());handle('empty-import',()=>$('image-file').click());
$('image-file').onchange=()=>guarded(async()=>{const file=$('image-file').files[0];if(!file)return;if(file.size>20*1024*1024)throw new Error('Images must be smaller than 20 MB.');const url=URL.createObjectURL(file);try{await importImage(url,file.name.replace(/\.[^.]+$/,''));}finally{URL.revokeObjectURL(url);$('image-file').value='';}});
handle('sample',()=>importImage('/assets/sample-car.png','Sample car'));
handle('save-project',()=>{downloadJSON(project(),`${filename()}.artmaker`);status('Layered project saved.');});
handle('open-project',()=>$('project-file').click());
$('project-file').onchange=()=>guarded(async()=>{const file=$('project-file').files[0];if(!file)return;if(file.size>100*1024*1024)throw new Error('Project exceeds 100 MB.');const data=JSON.parse(await file.text());validateProject(data);const images=await Promise.all(data.frames.flat().map(l=>loadImage(l.data)));if(images.some(i=>i.width*i.height>16000000))throw new Error('Project image is too large.');remember();setBusy(true);try{await restore(data);status('Project opened.');}finally{setBusy(false);$('project-file').value='';}});
handle('new-project',async()=>{if(layers.length&&!confirm('Start a new project? Save your current project first to keep a file copy.'))return;remember();await restore({width:1024,height:1024,frames:[[]],frameIndex:0,name:'Untitled asset',fps:8});status('New project');});
$('size').onchange=()=>guarded(()=>{const [w,h]=$('size').value.split('x').map(Number);if(layers.length||frames.length>1){$('size').value=`${width}x${height}`;status('Start a new project to choose a different canvas size.');return;}remember();width=w;height=h;resizeCanvas();renderFrames();});
function connectionFields() {
  const google = $('provider').value === 'google';
  $('api-key').value = '';
  $('key-label').textContent = google ? 'Google AI Studio API key' : 'OpenAI API key';
  $('api-key').placeholder = google ? 'AIza...' : 'sk-...';
  $('google-model-label').hidden = !google; $('google-key-link').hidden = !google;
  $('key-note').textContent = `Keys are kept in memory for this tab only. Provider usage charges may apply.${keys[$('provider').value] || configured[$('provider').value] ? ' A key is already configured; leave blank to keep it.' : ''}`;
}
function openConnection() { $('provider').value = provider; $('google-model').value = googleModel; connectionFields(); $('settings-dialog').showModal(); }
handle('settings', openConnection);
$('provider').onchange = connectionFields;
$('connection-form').onsubmit = event => {
  if (event.submitter?.value !== 'connect') return;
  const next = $('provider').value;
  if (provider === 'openai') openaiTransparent = $('transparent').checked;
  if ($('api-key').value.trim()) keys[next] = $('api-key').value.trim();
  provider = next; googleModel = $('google-model').value; $('api-key').value = ''; updateConnection();
};
$('settings-dialog').addEventListener('close', () => { $('api-key').value = ''; });
function updateConnection() {
  const name = provider === 'google' ? 'Google AI Studio' : 'OpenAI';
  $('connection').textContent = `${name}: ${keys[provider] ? 'session key set' : configured[provider] ? 'server key set' : 'no API key'}`;
  $('connection').classList.toggle('connected', configured[provider] || Boolean(keys[provider]));
  $('transparent').disabled = provider === 'google'; $('transparent').checked = provider === 'google' ? false : openaiTransparent;
  $('quality').disabled = provider === 'google'; $('provider-note').hidden = provider !== 'google';
}
handle('duplicate-frame',async()=>{if(frames.length>=48)throw new Error('This project supports up to 48 frames.');remember();syncFrame();frames.splice(frameIndex+1,0,structuredClone(frames[frameIndex]));await switchFrame(frameIndex+1);status('Frame duplicated.');});
handle('delete-frame',async()=>{if(frames.length<2)return;remember();frames.splice(frameIndex,1);frameIndex=Math.min(frameIndex,frames.length-1);await loadLayers(frames[frameIndex]);clearMask();await renderFrames();});
$('onion').onchange=()=>{onionNode.visible($('onion').checked&&frameIndex>0&&!playing);scene.batchDraw();};
$('fps').onchange=()=>{$('fps').value=Math.min(30,Math.max(1,Number($('fps').value)||8));};
const playbackNode=new Konva.Image({listening:false});overlay.add(playbackNode);playbackNode.hide();
$('play').onclick=async()=>{if(busy)return;if(playing){stopPlayback();return;}if(frames.length<2)return;syncFrame();setBusy(true);let buffers;try{buffers=await Promise.all(frames.map(renderStored));}finally{setBusy(false);}playing=true;scene.hide();maskNode.hide();transformer.hide();playbackNode.show();$('play').innerHTML='<i data-lucide="pause"></i>';$('play').setAttribute('aria-label','Pause animation');icons();let i=0;const tick=()=>{playbackNode.image(buffers[i]);i=(i+1)%buffers.length;overlay.batchDraw();};tick();playTimer=setInterval(tick,1000/Number($('fps').value));updateUndo();status('Playing animation');};
function stopPlayback(){clearInterval(playTimer);playing=false;playbackNode.hide();scene.show();maskNode.show();transformer.show();$('play').innerHTML='<i data-lucide="play"></i>';$('play').setAttribute('aria-label','Play animation');icons();stage.draw();updateUndo();status('Playback stopped');}
handle('export',()=>$('export-dialog').showModal());
$('download-export').onclick=()=>guarded(async()=>{const factor=Number($('export-scale').value),w=Math.round(width*factor),h=Math.round(height*factor);if($('export-type').value==='png'){const output=canvas(w,h);output.getContext('2d').drawImage(composite(),0,0,w,h);download(output.toDataURL(),`${filename()}.png`);}else{syncFrame();const columns=Math.min(8,Math.ceil(Math.sqrt(frames.length))),rows=Math.ceil(frames.length/columns);const output=canvas(w*columns,h*rows),ctx=output.getContext('2d'),metadata={format:'artmaker-spritesheet',image:`${filename()}-sheet.png`,frameWidth:w,frameHeight:h,columns,rows,fps:Number($('fps').value),frames:[]};for(let i=0;i<frames.length;i++){const x=(i%columns)*w,y=Math.floor(i/columns)*h;ctx.drawImage(await renderStored(frames[i]),x,y,w,h);metadata.frames.push({index:i,x,y,width:w,height:h,durationMs:1000/metadata.fps});}download(output.toDataURL(),metadata.image);downloadJSON(metadata,`${filename()}-sheet.json`);}status('Export downloaded.');});
window.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||document.querySelector('dialog[open]'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('save-project').click();}if(e.key==='Escape'){if(playing)stopPlayback();else clearMask();}});
new ResizeObserver(()=>{if(fitMode&&!drawing&&!panning)fit();}).observe($('viewport'));
icons();fit();renderLayers();await renderFrames();updateUndo();
try{const info=await fetch('/api/status').then(r=>r.json());configured.openai=Boolean(info.providers?.openai?.configured ?? info.configured);configured.google=Boolean(info.providers?.google?.configured);if(configured.google&&!configured.openai)provider='google';updateConnection();}catch{status('Local server unavailable.');}
