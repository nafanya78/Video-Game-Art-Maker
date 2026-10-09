import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function save(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save layered project', exact: true }).click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}
async function selectWheel(page) {
  await page.getByRole('button', { name: 'Paint selection', exact: true }).click();
  await page.locator('#brush-size').fill('110');
  const board = await page.locator('#artboard').boundingBox();
  await page.mouse.move(board.x + board.width * .285, board.y + board.height * .20);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width * .285, board.y + board.height * .28, { steps: 8 });
  await page.mouse.up();
}
async function imagePixels(page, data, points) {
  return page.evaluate(async ({data,points}) => {
    const image=new Image();image.src=data;await image.decode();
    const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
    return points.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);
  }, {data,points});
}
async function dragOnBoard(page, from, to) {
  const box=await page.locator('#artboard').boundingBox();
  await page.mouse.move(box.x+box.width*from[0],box.y+box.height*from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*to[0],box.y+box.height*to[1],{steps:12});
  await page.mouse.up();
}
test('brush and eraser drag continuously and undo each complete stroke', async ({page}) => {
  await page.goto('/');await page.getByRole('button',{name:'Add paint layer',exact:true}).click();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await dragOnBoard(page,[.2,.5],[.8,.5]);
  const painted=await save(page);
  const samples=await imagePixels(page,painted.frames[0][0].data,[[205,512],[512,512],[819,512],[512,400]]);
  expect(samples.map(p=>p[3])).toEqual([255,255,255,0]);
  await page.getByRole('button',{name:'Eraser',exact:true}).click();
  await dragOnBoard(page,[.35,.5],[.65,.5]);
  const erased=await save(page);
  expect((await imagePixels(page,erased.frames[0][0].data,[[205,512],[400,512],[512,512],[650,512],[819,512]])).map(p=>p[3])).toEqual([255,0,0,0,255]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('#status')).toHaveText('Undone');
  expect((await save(page)).frames[0][0].data).toBe(painted.frames[0][0].data);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  const blank=await save(page);
  expect((await imagePixels(page,blank.frames[0][0].data,[[205,512],[512,512],[819,512]])).map(p=>p[3])).toEqual([0,0,0]);
});
async function solidLayer(page) {
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1024;const ctx=c.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,1024,1024);return c.toDataURL();});
  await page.locator('#image-file').setInputFiles({name:'solid.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});
  await expect(page.locator('.layer')).toHaveCount(1);
}
test('painted selection includes the entire drag',async({page})=>{
  await page.goto('/');await solidLayer(page);
  await page.getByRole('button',{name:'Paint selection',exact:true}).click();
  await dragOnBoard(page,[.2,.5],[.8,.5]);
  await page.getByRole('button',{name:'Remove part',exact:true}).click();
  const result=await save(page);
  expect((await imagePixels(page,result.frames[0][0].data,[[205,512],[512,512],[819,512],[512,400]])).map(p=>p[3])).toEqual([0,0,0,255]);
});
test('drag continues outside the canvas and stops on release',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Add paint layer',exact:true}).click();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await dragOnBoard(page,[.2,.25],[1.12,.25]);
  const box=await page.locator('#artboard').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.75,{steps:6});
  const result=await save(page);
  expect((await imagePixels(page,result.frames[0][0].data,[[205,256],[512,256],[1023,256],[512,768]])).map(p=>p[3])).toEqual([255,255,255,0]);
});
test('box selection supports reverse drags, replacement, addition, and clipped edges',async({page})=>{
  await page.goto('/');await solidLayer(page);
  await page.getByRole('button',{name:'Box select',exact:true}).click();
  await dragOnBoard(page,[.8,.8],[.6,.6]);
  await dragOnBoard(page,[.4,.4],[.2,.2]);
  await page.keyboard.down('Shift');await dragOnBoard(page,[.7,.7],[.6,.6]);await page.keyboard.up('Shift');
  await page.keyboard.down('Shift');await dragOnBoard(page,[.9,.2],[1.12,.4]);await page.keyboard.up('Shift');
  await page.getByRole('button',{name:'Remove part',exact:true}).click();
  const result=await save(page);
  expect((await imagePixels(page,result.frames[0][0].data,[[300,300],[650,650],[780,780],[1000,300],[512,512]])).map(p=>p[3])).toEqual([0,0,255,0,255]);
});
test('box-selected parts can be extracted, dragged, resized, and undone at zoom',async({page})=>{
  await page.goto('/');await solidLayer(page);await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  await page.getByRole('button',{name:'Box select',exact:true}).click();
  await dragOnBoard(page,[.65,.65],[.35,.35]);
  await page.getByRole('button',{name:'Extract',exact:true}).click();
  const extracted=await save(page), part=extracted.frames[0][1];
  expect(part.x).toBeCloseTo(358,0);expect(part.y).toBeCloseTo(358,0);
  await dragOnBoard(page,[.5,.5],[.6,.55]);
  const moved=await save(page);
  // Browser pointer coordinates round to screen pixels at fractional canvas zoom.
  expect(Math.abs(moved.frames[0][1].x-part.x-102.4)).toBeLessThan(3);
  expect(Math.abs(moved.frames[0][1].y-part.y-51.2)).toBeLessThan(3);
  const anchor=await page.evaluate(()=>{const stage=Konva.stages[0];const p=stage.findOne('Transformer').findOne('.bottom-right').getAbsolutePosition();const r=stage.content.getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};});
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.mouse.move(anchor.x+30,anchor.y+30,{steps:8});await page.mouse.up();
  const resized=await save(page);expect(resized.frames[0][1].scaleX).toBeGreaterThan(1.1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#status')).toHaveText('Undone');
  expect((await save(page)).frames[0][1].scaleX).toBe(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect((await save(page)).frames[0][1].x).toBe(part.x);
});
test('touch dragging paints continuously',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'Add paint layer',exact:true}).click();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.locator('#artboard').scrollIntoViewIfNeeded();
  const box=await page.locator('#artboard').boundingBox(),cdp=await page.context().newCDPSession(page);
  const touch=x=>[{x:box.x+box.width*x,y:box.y+box.height*.5,id:1}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touch(.2)});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touch(.2+.6*i/8)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const result=await save(page);
  expect((await imagePixels(page,result.frames[0][0].data,[[205,512],[512,512],[819,512]])).map(p=>p[3])).toEqual([255,255,255]);
  await cdp.detach();
});
test('parts, undo, frames, project round-trip, and exports', async ({ page }) => {
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open sample car' }).click();
  await expect(page.locator('.layer')).toHaveCount(1);
  const before=await save(page);
  await selectWheel(page);
  await page.getByRole('button', { name: 'Remove part', exact:true }).click();
  const removed=await save(page);
  expect(removed.frames[0][0].data).not.toBe(before.frames[0][0].data);
  await page.getByRole('button', { name:'Undo',exact:true }).click();
  await expect(page.locator('#status')).toHaveText('Undone');
  expect((await save(page)).frames[0][0].data).toBe(before.frames[0][0].data);
  await selectWheel(page);
  await page.getByRole('button',{name:'Extract',exact:true}).click();
  await expect(page.locator('.layer')).toHaveCount(2);
  const extracted=await save(page);
  expect(extracted.frames[0][1].x).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Duplicate frame',exact:true}).click();
  await expect(page.locator('.frame')).toHaveCount(2);
  await page.getByRole('button',{name:'Play animation',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause animation',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pause animation',exact:true}).click();
  const project=await save(page);
  await page.locator('#project-file').setInputFiles({name:'saved.artmaker',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#status')).toHaveText('Project opened.');
  expect((await save(page)).frames).toEqual(project.frames);
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await page.locator('#export-type').selectOption('sheet');
  const downloads=[]; page.on('download',d=>downloads.push(d));
  await page.getByRole('button',{name:'Download',exact:true}).click();
  await expect.poll(()=>downloads.length).toBe(2);
  const metadata=JSON.parse(await readFile(await downloads.find(d=>d.suggestedFilename().endsWith('.json')).path(),'utf8'));
  expect(metadata.frames).toHaveLength(2);expect(metadata.fps).toBe(8);
  await page.screenshot({path:'test-results/editor-desktop.png',fullPage:true});
  expect(errors).toEqual([]);
});
for (const provider of ['openai', 'google']) test(`${provider} AI edits preserve every pixel outside the selection`, async ({ page }) => {
  await page.route('**/api/status',route=>route.fulfill({json:{providers:{openai:{configured:provider==='openai'},google:{configured:provider==='google'}}}}));
  await page.goto('/'); await page.getByRole('button',{name:'Open sample car'}).click();
  await expect(page.locator('.layer')).toHaveCount(1);
  const before=await save(page); let sent;
  const solid=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1024;const x=c.getContext('2d');x.fillStyle='#00ff00';x.fillRect(0,0,1024,1024);return c.toDataURL();});
  await page.route('**/api/image',async route=>{sent=route.request().postDataJSON();await route.fulfill({json:{image:solid}});});
  await selectWheel(page); await page.locator('#edit-prompt').fill('Replace with larger off-road wheels');
  await page.getByRole('button',{name:'Apply AI edit'}).click();
  await expect(page.locator('.layer')).toHaveCount(2);
  const after=await save(page);
  expect(sent.provider).toBe(provider);
  if (provider === 'google') { expect(sent.selection).toMatch(/^data:image\/png;base64,/); expect(sent.transparent).toBe(false); }
  expect(after.frames[0][0].visible).toBe(false);
  const {changed,outsideChanged}=await page.evaluate(async sources=>{
    const pixels=await Promise.all(sources.map(async src=>{const image=new Image();image.src=src;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);return x.getImageData(0,0,c.width,c.height).data;}));
    const [original,edited,mask]=pixels;let changed=0,outsideChanged=0;
    for(let i=0;i<original.length;i+=4){const different=[0,1,2,3].some(c=>original[i+c]!==edited[i+c]);if(different)changed++;if(mask[i+3]===255&&different)outsideChanged++;}
    return {changed,outsideChanged};
  },[before.frames[0][0].data,after.frames[0][1].data,sent.mask]);
  expect(changed).toBeGreaterThan(0);expect(outsideChanged).toBe(0);
});
test('Google connection routes the session key, restores OpenAI settings, and keeps keys out of saved projects', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button',{name:'AI connection',exact:true}).click();
  await page.locator('#api-key').fill('openai-unsaved-key');
  await page.locator('#provider').selectOption('google');
  await expect(page.locator('#api-key')).toHaveValue('');
  await page.locator('#api-key').fill('google-test-key');
  await page.locator('#google-model').selectOption('gemini-2.5-flash-image');
  await page.getByRole('button',{name:'Apply connection'}).click();
  await expect(page.locator('#connection')).toHaveText('Google AI Studio: session key set');
  await expect(page.locator('#transparent')).toBeDisabled();
  await expect(page.locator('#transparent')).not.toBeChecked();
  await expect(page.locator('#quality')).toBeDisabled();
  let request;
  await page.route('**/api/image',async route=>{request=route.request();await route.fulfill({status:429,json:{error:'Google quota exceeded'}});});
  await page.getByRole('button',{name:'Generate layer'}).click();
  await expect(page.locator('#status')).toHaveText('Google quota exceeded');
  expect(request.headers()['x-google-key']).toBe('google-test-key');
  expect(request.headers()['x-openai-key']).toBeUndefined();
  expect(request.postDataJSON().model).toBe('gemini-2.5-flash-image');
  expect(JSON.stringify(await save(page))).not.toContain('google-test-key');
  expect(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]))).not.toContain('google-test-key');
  await page.getByRole('button',{name:'AI connection',exact:true}).click();
  await page.screenshot({path:'test-results/google-connection.png',fullPage:true});
  await page.locator('#provider').selectOption('openai');
  await page.getByRole('button',{name:'Apply connection'}).click();
  await expect(page.locator('#transparent')).toBeEnabled();await expect(page.locator('#transparent')).toBeChecked();
  await expect(page.locator('#connection')).toHaveText('OpenAI: no API key');
});
test('mobile editor has no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Open sample car'}).click();await expect(page.locator('.layer')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/editor-mobile.png',fullPage:true});
});
