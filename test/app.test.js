const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { loadImage, createCanvas } = require('canvas');
const { createApp } = require('../server');
const { themes, defaultSettings } = require('../lib/themes');
const { encodeBMP, isQuiet, render, processPixels } = require('../lib/render');

test('BMP includes padded rows and bottom-up BGR pixels', () => {
  const pixels = new Uint8ClampedArray([255,0,0,255, 0,255,0,255]);
  const bmp = encodeBMP(pixels, 1, 2);
  assert.equal(bmp.toString('ascii', 0, 2), 'BM');
  assert.equal(bmp.readUInt32LE(2), 62);
  assert.equal(bmp.readUInt32LE(34), 8);
  assert.deepEqual([...bmp.subarray(54)], [0,255,0,0, 0,0,255,0]);
});
test('quiet periods respect timezone, midnight and exclusive end', () => {
  const s = { ...defaultSettings, quietEnabled: true, quietStart: 23, quietEnd: 5 };
  assert.equal(isQuiet(s, new Date('2026-09-29T15:00:00Z')), true);
  assert.equal(isQuiet(s, new Date('2026-09-29T20:59:00Z')), true);
  assert.equal(isQuiet(s, new Date('2026-09-29T21:00:00Z')), false);
  assert.equal(isQuiet(s, new Date('2026-09-29T14:59:00Z')), false);
  assert.equal(isQuiet({ ...s, quietEnabled: false }, new Date('2026-09-29T15:00:00Z')), false);
});
test('dithering preserves red and produces only the black-white-red palette', () => {
  for (const mode of ['threshold','floyd','atkinson']) {
    const pixels = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < 256; i++) { pixels.set([128,128,128,255], i * 4); }
    pixels.set([230,20,10,255], 0);
    processPixels(pixels,16,16,{ ...defaultSettings, mode });
    assert.deepEqual([...pixels.subarray(0,4)], [255,0,0,255]);
    let white = 0;
    for (let i = 0; i < 256; i++) { const rgb = [...pixels.subarray(i*4,i*4+3)].join(','); assert.ok(['0,0,0','255,255,255','255,0,0'].includes(rgb)); if (rgb === '255,255,255') white++; }
    if (mode !== 'threshold') assert.ok(white > 50 && white < 200);
  }
});
test('all builtins render PNG and odd-width BMP', async () => {
  for (const theme of themes) {
    const frame = await render(theme, { ...defaultSettings, width: 401 }, {}, new Date('2026-09-29T04:00:00Z'));
    assert.equal(frame.bmp.length, 54 + 1204 * 300);
    const img = await loadImage(frame.png); assert.equal(img.width, 401); assert.equal(img.height, 300);
  }
});
test('uploaded image composition and 180-degree rotation preserve expected pixels', async () => {
  const image = createCanvas(20, 20), ctx = image.getContext('2d');
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0,0,20,20);
  const theme = { name: '图片测试',width:100,height:100,background:'#ffffff',elements:[{id:'image',type:'image',x:0,y:0,width:20,height:20,color:'#ffffff',src:image.toDataURL()}] };
  const settings = { ...defaultSettings, width:100,height:100 };
  const normal = (await render(theme,settings)).bmp;
  const flipped = (await render(theme,{...settings,rotation:180})).bmp;
  const pixel = (bmp,x,y) => [...bmp.subarray(54+(99-y)*300+x*3,54+(99-y)*300+x*3+3)];
  assert.deepEqual(pixel(normal,5,5),[0,0,255]); assert.deepEqual(pixel(normal,95,95),[255,255,255]);
  assert.deepEqual(pixel(flipped,5,5),[255,255,255]); assert.deepEqual(pixel(flipped,95,95),[0,0,255]);
});
test('API persists configuration, isolates previews, records device protocol, freezes frames and validates edits', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojian-test-'));
  const app = createApp({ dataDir }), server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method = 'GET', data, headers = {}) => fetch(base + url, { method, headers: { ...headers, ...(data ? {'Content-Type':'application/json'} : {}) }, body: data ? JSON.stringify(data) : undefined });
  const getState = async () => (await call('/api/state')).json();
  let response = await call('/generate-image?istest=1'); assert.equal(response.status,200); assert.equal(response.headers.get('wt'),null);
  assert.equal((await getState()).requests.length,0);
  const hdr = { 'x-devid':'real-test-device', 'x-model':'400x300', 'x-bv':'3.87', 'x-battery':'78', 'x-logs':'boot-ok', Authorization:'Bearer PRIVATE', Cookie:'private-cookie' };
  response = await call('/generate-image','GET',null,hdr);
  const first = Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get('wt'),'1005'); assert.equal(response.headers.get('fver'),'1.0.0'); assert.equal(response.headers.get('content-length'),String(first.length));
  let snapshot = await getState(); assert.equal(snapshot.devices[0].battery,'78'); assert.equal(snapshot.requests[0].headers.authorization,'[已隐藏]'); assert.equal(snapshot.requests[0].headers.cookie,'[已隐藏]');
  response = await call('/api/themes/calendar','PUT',themes[0]); assert.equal(response.status,400);
  response = await call('/api/themes','POST',{ ...themes[0], name:'测试副本' }); assert.equal(response.status,201);
  const copy = await response.json(); assert.equal(copy.builtin,false);
  response = await call(`/api/themes/${copy.id}`,'PUT',{ ...copy, description:'可修改的主题描述' }); assert.equal(response.status,200);
  assert.equal((await (await call('/api/state')).json()).customThemes[0].description,'可修改的主题描述');
  response = await call('/api/themes','POST',{ ...themes[0], elements:[{ id:'a', type:'image',x:0,y:0,width:400,height:300,color:'#ffffff',src:'http://localhost/private' }] }); assert.equal(response.status,400);
  response = await call('/api/settings','PUT',{interval:'1061'}); assert.equal(response.status,400);
  response = await call('/api/settings','PUT',{quietEnabled:'false'}); assert.equal(response.status,400);
  response = await call('/api/settings','PUT',{quietEnabled:true,quietStart:5,quietEnd:5}); assert.equal(response.status,400);
  response = await call('/api/settings','PUT',{interval:'0'}, {Origin:'https://unrelated.example'}); assert.equal(response.status,403);
  response = await call('/api/export','POST',{theme:copy}); assert.equal(response.status,200); assert.equal(Buffer.from(await response.arrayBuffer()).toString('ascii',0,2),'BM');
  const frameDir = path.join(dataDir, 'frames');
  const frameFiles = fs.readdirSync(frameDir);
  assert.equal(frameFiles.length, 1); // Previews and exports do not accumulate files.
  const framePath = path.join(frameDir, frameFiles[0]);
  fs.utimesSync(framePath, new Date(0), new Date(0));
  // UTC makes this deterministic for the hour in which the test executes.
  const hour = new Date().getUTCHours();
  response = await call('/api/settings','PUT',{interval:'1',timezone:'UTC',quietEnabled:true,quietStart:hour,quietEnd:(hour+2)%24}); assert.equal(response.status,200);
  await call('/api/activate','POST',{themeId:'clock'});
  response = await call('/generate-image','GET',null,hdr); const held = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(held,first); assert.equal(response.headers.get('wt'),'1');
  assert.ok(fs.statSync(framePath).mtimeMs > Date.now() - 10000);
  app.locals.maintenance();
  assert.deepEqual(fs.readdirSync(frameDir), frameFiles); // Quiet reuse keeps the only frame alive.
  snapshot = await getState(); assert.equal(snapshot.requests[0].held,true); assert.equal(snapshot.devices[0].count,2);
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'))); assert.equal(persisted.activeTheme,'clock'); assert.equal(persisted.settings.interval,'1'); assert.equal(persisted.customThemes[0].name,'测试副本');
  const restart = createApp({dataDir}).listen(0,'127.0.0.1'); await once(restart,'listening');
  try { const restored = await (await fetch(`http://127.0.0.1:${restart.address().port}/api/state`)).json(); assert.equal(restored.devices[0].count,2); assert.equal(restored.activeTheme,'clock'); } finally { await new Promise(resolve => restart.close(resolve)); }
  response = await call(`/api/themes/${copy.id}`,'DELETE'); assert.equal(response.status,200);
  assert.equal((await (await call('/api/state')).json()).customThemes.length,0);
  response = await call('/api/themes/calendar','DELETE'); assert.equal(response.status,400);
  await call('/wrong-device-path?token=PRIVATE','GET',null,hdr); snapshot = await getState(); assert.equal(snapshot.requests[0].status,404); assert.ok(!snapshot.requests[0].url.includes('PRIVATE'));
});

test('删除自定义主题后修复默认主题和设备引用，并持久化保留其他主题', async t => {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mojian-delete-'));
  const original={...themes[0],id:'custom-original',builtin:false,name:'我的桌面日历',description:'原始描述'};
  const copy={...structuredClone(original),id:'custom-copy',name:'我的桌面日历 · 副本'};
  fs.writeFileSync(path.join(dataDir,'state.json'),JSON.stringify({settings:defaultSettings,customThemes:[original,copy],activeTheme:original.id,requests:[],devices:[{id:'device-a',themeId:original.id,contentPages:{[original.id]:2,[copy.id]:3}},{id:'device-b',themeId:copy.id}]}));
  const server=createApp({dataDir}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(`${base}/api/themes/${original.id}`,{method:'DELETE'});assert.equal(response.status,200);
  const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'state.json')));
  assert.equal(saved.activeTheme,themes[0].id);assert.deepEqual(saved.customThemes,[copy]);
  assert.equal(saved.devices[0].themeId,null);assert.deepEqual(saved.devices[0].contentPages,{[copy.id]:3});
  assert.equal(saved.devices[1].themeId,copy.id);
  assert.equal((await fetch(`${base}/api/themes/calendar`,{method:'DELETE'})).status,400);
  assert.equal((await fetch(`${base}/api/themes/missing`,{method:'DELETE'})).status,400);
  const blocked=await fetch(`${base}/api/themes/${copy.id}`,{method:'DELETE',headers:{Origin:'https://unrelated.example'}});assert.equal(blocked.status,403);
  const update=await fetch(`${base}/api/themes/${copy.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...copy,description:''})});assert.equal(update.status,200);
  assert.equal((await update.json()).description,'');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'))).customThemes[0].description,'');
});
