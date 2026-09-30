const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const net = require('node:net');
const { themes, defaultSettings } = require('./lib/themes');
const { render, isQuiet } = require('./lib/render');
const { createDataSources } = require('./lib/data-sources');
const { loadConfig, pruneRequests, cleanFiles } = require('./lib/maintenance');

function fail(message) { const error = new Error(message); error.status = 400; throw error; }
function number(value, min, max, label) { if (!Number.isFinite(value) || value < min || value > max) fail(`${label}应在 ${min}–${max} 之间`); return value; }
function validateTheme(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60) fail('请填写 1–60 字的主题名称');
  const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (!color(input.background)) fail('背景颜色无效');
  number(input.width, 100, 1600, '画布宽度'); number(input.height, 100, 1600, '画布高度');
  if (!Array.isArray(input.elements) || input.elements.length > 80) fail('最多支持 80 个元素');
  const ids = new Set();
  const elements = input.elements.map(el => {
    if (!el || !['text','rect','image','calendar','landscape','weather-icon','month-grid','feed'].includes(el.type)) fail('元素类型无效');
    if (typeof el.id !== 'string' || ids.has(el.id)) fail('元素编号重复或缺失'); ids.add(el.id);
    for (const k of ['x','y']) number(el[k], -1600, 3200, k);
    for (const k of ['width','height']) number(el[k], 1, 3200, k);
    if (!color(el.color)) fail('元素颜色无效');
    const result = { id: el.id, type: el.type, x: el.x, y: el.y, width: el.width, height: el.height, color: el.color };
    if (el.type === 'text') {
      number(el.size, 6, 300, '字号');
      if (typeof el.text !== 'string' || el.text.length > 5000) fail('文字最多 5000 字');
      Object.assign(result, { text: el.text, size: el.size, bold: Boolean(el.bold), lineHeight: number(el.lineHeight || 1.3, 1, 3, '行高') });
      if(el.align && !['left','center','right'].includes(el.align))fail('文字对齐方式无效');
      result.align=el.align||'left'; result.fit=Boolean(el.fit);
    }
    if(el.type==='feed') {
      if(!['trending','news'].includes(el.source))fail('列表来源无效');
      Object.assign(result,{source:el.source,size:number(el.size||18,6,100,'列表字号'),lineHeight:number(el.lineHeight||1.1,1,3,'列表行高'),bold:el.bold!==false});
    }
    if (el.type === 'image') {
      if (typeof el.src !== 'string' || el.src.length > 3e6 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(el.src)) fail('图片仅支持小于 2 MB 的 PNG / JPEG / WebP');
      result.src = el.src;
    }
    return result;
  });
  return { name: input.name.trim(), description: String(input.description || '我的自定义画面').slice(0, 100), width: Math.round(input.width), height: Math.round(input.height), background: input.background, elements, builtin: false };
}
function validateSettings(input, current) {
  const s = { ...current };
  for (const key of Object.keys(defaultSettings)) if (Object.hasOwn(input, key)) s[key] = input[key];
  if (!['1005','0','1'].includes(s.interval)) fail('刷新间隔必须使用 Demo 已知编码');
  if (!['threshold','floyd','atkinson','original'].includes(s.mode)) fail('图像处理模式无效');
  if (![0,180].includes(s.rotation)) fail('仅支持 0° / 180°');
  for (const key of ['quietEnabled','sound','weatherLive','serverOverrideEnabled','feedRotate']) if (typeof s[key] !== 'boolean') fail(`${key} 必须为开关值`);
  if(!['manual','weibo'].includes(s.trendingSource)||!['manual','toutiao'].includes(s.newsSource))fail('信息源无效');
  number(s.serverPort,1,65535,'自定义服务器端口');if(!Number.isInteger(s.serverPort))fail('服务器端口必须为整数');
  if(typeof s.serverHost!=='string'||s.serverHost.length>253)fail('服务器地址无效');
  if(s.serverOverrideEnabled && !s.serverHost)fail('启用下发时请填写服务器地址');
  if(s.serverHost && !(net.isIP(s.serverHost)===4 || (!/^[\d.]+$/.test(s.serverHost) && s.serverHost.split('.').every(label=>/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)))))fail('服务器地址只填写 IPv4 或域名，不包含协议、端口或路径');
  for (const key of ['width','height']) { number(s[key], 100, 1600, key); s[key] = Math.round(s[key]); }
  for (const key of ['quietStart','quietEnd']) { number(s[key], 0, 23, key); if (!Number.isInteger(s[key])) fail('静默时段请填写整点'); }
  if (s.quietEnabled && s.quietStart === s.quietEnd) fail('静默时段的开始与结束不能相同');
  number(s.brightness, 1, 254, '亮度阈值'); number(s.redThreshold, 1, 255, '红色阈值');
  number(s.latitude, -90, 90, '纬度'); number(s.longitude, -180, 180, '经度');
  for (const key of ['city','cityLocation','timezone','serviceAddress','memo','trending','news','schedule','countdownName','countdownDate']) if (typeof s[key] !== 'string' || s[key].length > 5000) fail(`${key} 文本无效或过长`);
  if(s.city.length>60||s.countdownName.length>30)fail('城市名最多 60 字，倒计时名称最多 30 字');
  if(s.countdownDate && (!/^\d{4}-\d{2}-\d{2}$/.test(s.countdownDate)||!Number.isFinite(Date.parse(s.countdownDate))||new Date(s.countdownDate).toISOString().slice(0,10)!==s.countdownDate))fail('倒计时日期无效');
  try { new Intl.DateTimeFormat('en', { timeZone: s.timezone }).format(); } catch { fail('时区无效'); }
  if (s.serviceAddress) { try { const u = new URL(s.serviceAddress); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw Error(); } catch { fail('服务地址需为不包含密码的 http(s) URL'); } }
  return s;
}
function deviceHeaders(settings) {
  const headers={wt:settings.interval,sound:settings.sound?'1':'0',fver:'1.0.0',fmd5:''};
  if(settings.serverOverrideEnabled)Object.assign(headers,{burl:settings.serverHost,bport:String(settings.serverPort)});
  return headers;
}
function pageIndex(value) {const n=Number(value??0);if(!Number.isInteger(n)||n<0||n>999999)fail('页码无效');return n;}
function createApp({ dataDir = path.join(__dirname, 'data'), port = 4000, fetchImpl = fetch, config = loadConfig() } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'frames'), { recursive: true });
  const statePath = path.join(dataDir, 'state.json');
  const initial = { settings: { ...defaultSettings }, customThemes: [], activeTheme: 'calendar', devices: [], requests: [] };
  // A damaged state file must not be silently replaced.
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : initial;
  state.settings = { ...defaultSettings, ...state.settings };
  const save = () => { state.requests = pruneRequests(state.requests, config); const tmp = `${statePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, statePath); };
  const allThemes = () => [...themes, ...state.customThemes];
  const findTheme = id => allThemes().find(t => t.id === id);
  const app = express(); app.disable('x-powered-by');
  app.locals.maintenance = () => {
    const requests = pruneRequests(state.requests, config);
    if (requests.length !== state.requests.length) { state.requests = requests; save(); }
    return cleanFiles(dataDir, config);
  };
  app.locals.maintenance();
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Browser writes must come from this local application, never another site.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '不接受跨站写入请求' });
      if (req.headers.origin) { try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: '来源不匹配' }); } catch { return res.status(403).end(); } }
    }
    next();
  });
  app.use(express.json({ limit: '12mb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  const sources=createDataSources({dataDir,fetchImpl});
  async function makeFrame(theme, settings = state.settings, context = {}) {
    const needsWeather=theme.elements.some(e=>e.type==='weather-icon'||e.type==='month-grid'||/\{\{(temperature|condition|weatherSource|humidity|high|low|tomorrow\w+)\}\}/.test(e.text||''));
    const kinds=[...new Set(theme.elements.filter(e=>e.type==='feed').map(e=>e.source))], feeds={};
    const [weather]=await Promise.all([needsWeather?sources.weather(settings):{},...kinds.map(async kind=>{feeds[kind]=await sources.feed(kind,settings);})]);
    // Text variables keep older custom themes compatible with live sources too.
    for(const kind of ['trending','news'])if(theme.elements.some(e=>e.text?.includes(`{{${kind}}}`))&&!feeds[kind])feeds[kind]=await sources.feed(kind,settings);
    const feedVars=Object.fromEntries(Object.entries(feeds).map(([kind,data])=>[kind,data.items.map((v,i)=>`${i+1}. ${v.title}`).join('\n')]));
    return render(theme,settings,weather,new Date(),{...context,feeds,vars:{...feedVars,...context.vars}});
  }
  function urls() {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => `http://${x.address}:${port}/generate-image`);
    return { local: `http://localhost:${port}`, addresses };
  }
  app.get('/api/health', (req, res) => res.json({ service: 'ink-studio', ok: true, pid: process.pid }));
  app.get('/api/state', (req, res) => res.json({ ...state, requests: state.requests.slice(0, 100), themes: allThemes(), ...urls(), quietNow: isQuiet(state.settings), sourceStatus:sources.status() }));
  app.get('/api/cities', async(req,res)=>{
    const q=String(req.query.q||'').trim();if(q.length<2||q.length>80)fail('请输入 2–80 字的城市名称');
    try{res.json({cities:await sources.cities(q)});}catch(e){res.status(502).json({error:`城市搜索失败：${e.message}。可手动填写经纬度。`});}
  });
  app.post('/api/data/test', async(req,res)=>{
    const settings=validateSettings(req.body.settings||{},state.settings);
    const [weather,trending,news]=await Promise.all([sources.weather(settings),sources.feed('trending',settings),sources.feed('news',settings)]);
    res.json({weather,trending,news});
  });
  app.put('/api/settings', (req, res) => { state.settings = validateSettings(req.body, state.settings); save(); res.json(state.settings); });
  app.post('/api/themes', (req, res) => {
    if (state.customThemes.length >= 100) fail('自定义主题最多 100 个');
    const theme = { ...validateTheme(req.body), id: crypto.randomUUID() }; state.customThemes.push(theme); save(); res.status(201).json(theme);
  });
  app.put('/api/themes/:id', (req, res) => {
    const index = state.customThemes.findIndex(t => t.id === req.params.id); if (index < 0) fail('内置主题只读，请先复制');
    state.customThemes[index] = { ...validateTheme(req.body), id: req.params.id }; save(); res.json(state.customThemes[index]);
  });
  app.post('/api/activate', (req, res) => {
    if (!findTheme(req.body.themeId)) fail('主题不存在');
    if (req.body.deviceId) { const d = state.devices.find(d => d.id === req.body.deviceId); if (!d) fail('设备不存在'); d.themeId = req.body.themeId; }
    else state.activeTheme = req.body.themeId;
    save(); res.json({ ok: true });
  });
  app.put('/api/devices/:id', (req, res) => {
    const d = state.devices.find(d => d.id === req.params.id); if (!d) fail('设备不存在');
    if (typeof req.body.name === 'string') d.name = req.body.name.slice(0, 60);
    if (req.body.themeId !== undefined) { if (req.body.themeId && !findTheme(req.body.themeId)) fail('主题不存在'); d.themeId = req.body.themeId || null; }
    save(); res.json(d);
  });
  app.post('/api/preview', async (req, res) => {
    const theme = req.body.theme ? validateTheme(req.body.theme) : findTheme(req.body.themeId || state.activeTheme);
    if (!theme) fail('主题不存在');
    const settings = req.body.settings ? validateSettings(req.body.settings, state.settings) : state.settings;
    const frame = await makeFrame(theme, settings,{pageIndex:pageIndex(req.body.page)});
    res.set('X-Ink-Page-Count',String(Math.max(1,...Object.values(frame.feedPages).map(p=>p.total)))).type('png').send(frame.png);
  });
  app.post('/api/export', async (req, res) => {
    const theme = validateTheme(req.body.theme);
    const frame = await makeFrame(theme,state.settings,{pageIndex:pageIndex(req.body.page)});
    res.set('Content-Disposition', 'attachment; filename="custom-theme.bmp"').type('bmp').send(frame.bmp);
  });
  app.get('/api/themes/:id/preview', async (req, res) => {
    const theme = findTheme(req.params.id); if (!theme) return res.status(404).end();
    const frame = await makeFrame(theme,state.settings,{pageIndex:pageIndex(req.query.page)}); res.type('png').send(frame.png);
  });
  function record(req, result) {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k,v]) => [k, /authorization|cookie|token|secret|api.?key/i.test(k) ? '[已隐藏]' : String(v).slice(0, 8192)]));
    const url = new URL(req.originalUrl, 'http://local');
    for (const key of url.searchParams.keys()) if (/token|secret|password|key/i.test(key)) url.searchParams.set(key, '[已隐藏]');
    const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), method: req.method, url: url.pathname + url.search, ip: req.socket.remoteAddress, deviceId: req.headers['x-devid'] || null, headers, ...result };
    state.requests.unshift(entry); state.requests = state.requests.slice(0, 200); save(); return entry;
  }
  // Keep the vendor endpoint and the BMP / response-header contract.
  const inFlight = new Map();
  async function deviceResponse(req, res) {
    const test = Boolean(req.query.istest), deviceId = String(req.headers['x-devid'] || '').slice(0, 128), now = new Date().toISOString();
    let device = state.devices.find(d => d.id === deviceId);
    if (!test && deviceId) {
      if (!device && state.devices.length < 200) { device = { id: deviceId, name: `墨水屏 ${deviceId.slice(-6)}`, firstSeen: now, count: 0, themeId: null }; state.devices.push(device); }
      if (device) { Object.assign(device, { lastSeen: now, model: req.headers['x-model'] || '', battery: req.headers['x-battery'] || '', voltage: req.headers['x-bv'] || '', logs: req.headers['x-logs'] || '', ip: req.socket.remoteAddress }); device.count++; }
    }
    const theme = findTheme(device?.themeId || state.activeTheme) || themes[0];
    const framePath = deviceId ? path.join(dataDir, 'frames', `${crypto.createHash('sha256').update(deviceId).digest('hex')}.bmp`) : null;
    let bmp, held = false, feedPages;
    try {
      if (!test && framePath && isQuiet(state.settings) && fs.existsSync(framePath)) {
        bmp = fs.readFileSync(framePath); held = true;feedPages=device?.lastResponse?.feedPages;
        const usedAt = new Date(); fs.utimesSync(framePath, usedAt, usedAt);
      }
      else {
        const index=test?pageIndex(req.query.page):state.settings.feedRotate?(device?.contentPages?.[theme.id]||0):0;
        const battery=/^\d+(\.\d+)?$/.test(device?.battery||'')?`${Math.min(100,Number(device.battery))}%`:'--';
        const frame=await makeFrame(theme,state.settings,{pageIndex:index,vars:{battery}});bmp=frame.bmp;feedPages=frame.feedPages;
        if (!test && framePath && device) { fs.writeFileSync(`${framePath}.tmp`, bmp); fs.renameSync(`${framePath}.tmp`, framePath); device.lastRenderedTheme = theme.id; }
        if(!test&&device&&Object.keys(feedPages).length){device.contentPages??={};device.contentPages[theme.id]=index+1;}
      }
      const headers = { 'Content-Type': 'image/bmp', 'Content-Length': String(bmp.length) };
      if (!test) Object.assign(headers, { 'Content-Disposition': 'attachment; filename="time-info.bmp"', Connection: 'close', ...deviceHeaders(state.settings) });
      if (!test) {
        if (device) { device.lastResponse = { at: now, held, themeId: held ? device.lastRenderedTheme : theme.id, bytes: bmp.length,feedPages }; }
        record(req, { status: 200, held, themeId: held ? device?.lastRenderedTheme : theme.id, responseHeaders: headers,feedPages });
      }
      res.set(headers).status(200).end(bmp);
    } catch (e) { if (!test) record(req, { status: 500, error: e.message }); throw e; }
  }
  app.get('/generate-image', async (req, res) => {
    // Serialize a device's frame writes while allowing different devices to connect.
    const key = req.headers['x-devid'] || '__preview';
    const task = (inFlight.get(key) || Promise.resolve()).catch(() => {}).then(() => deviceResponse(req, res));
    inFlight.set(key, task);
    try { await task; } finally { if (inFlight.get(key) === task) inFlight.delete(key); }
  });
  app.use((req, res) => {
    if (!req.path.startsWith('/api/') && req.path !== '/favicon.ico') record(req, { status: 404, note: '未匹配设备接口，请配置完整 /generate-image 地址' });
    res.status(404).json({ error: '地址不存在，设备接口为 /generate-image' });
  });
  app.use((error, req, res, next) => { console.error(error.message); if (res.headersSent) return next(error); res.status(error.status || 500).json({ error: error.status ? error.message : '服务处理失败，请检查终端日志' }); });
  return app;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4000);
  const dataDir = path.resolve(process.env.INK_DATA_DIR || path.join(__dirname, 'data'));
  require('./lib/logging').installLogging(dataDir);
  try {
    const config = loadConfig();
    const app = createApp({ port, dataDir, config });
    const timer = setInterval(() => {
      try { app.locals.maintenance(); } catch (error) { console.error(`自动清理失败：${error.message}`); }
    }, config.cleanupIntervalMinutes * 60000);
    timer.unref();
    const server = app.listen(port, '0.0.0.0', () => console.log(`墨间 · 管理页面 http://localhost:${port}\n设备接口 http://电脑局域网IP:${port}/generate-image`));
    server.on('error', e => { clearInterval(timer); console.error(`启动失败：${e.message}`); process.exitCode = 1; });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
      clearInterval(timer);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    });
  } catch (error) { console.error(`启动失败：${error.message}`); process.exitCode = 1; }
}
module.exports = { createApp, validateSettings, validateTheme,deviceHeaders };
