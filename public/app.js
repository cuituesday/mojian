const $ = s => document.querySelector(s);
// getRandomValues also works on a LAN HTTP origin, where randomUUID may be absent.
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join('');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let state, view = 'themes', draft = null, selected = null, dirty = false, previewURL, previewTimer, previewVersion = 0;
let editorPage=0,editorPageCount=1,cityResults=[];
let textEditor=null, replaceImageId=null;
const elementLabels={text:'文字',rect:'色块',image:'图片',calendar:'日历',landscape:'山野背景','month-grid':'农历月历','weather-icon':'天气图标',feed:'动态列表'};
const titles = { themes: '主题画廊', editor: '画布编辑器', devices: '我的设备', requests: '请求记录', settings: '设置' };
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 4200); }
async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { const e = await response.json().catch(() => ({})); throw Error(e.error || `请求失败 ${response.status}`); }
  return response.json();
}
async function refresh() { state = await api('/api/state'); $('#device-count').textContent = state.devices.length; }
function head(title, subtitle, actions = '') { return `<div class="heading"><div><div class="eyebrow">YOUR PERSONAL INK SPACE</div><h1>${title}</h1><p class="subtext">${subtitle}</p></div>${actions}</div>`; }
function navigate(next) {
  if (dirty && next === view) return;
  if (dirty && next !== view && !confirm('有尚未保存的更改，确定离开？')) return;
  dirty = false; view = next;
  textEditor?.destroy(); textEditor=null;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#breadcrumb').innerHTML = `工作空间 <span>/</span> ${titles[view]}`;
  ({ themes: renderThemes, editor: renderEditor, devices: renderDevices, requests: renderRequests, settings: renderSettings })[view]();
}
function renderThemes() {
  const active = state.themes.find(t => t.id === state.activeTheme);
  $('#content').innerHTML = head('让屏幕，成为生活的一角。', '选择一张喜欢的画面，把天气、日程和灵感留在眼前。', '<button class="primary" data-action="blank">＋ 新建主题</button>') +
    `<div class="status-banner"><div class="symbol">▣</div><div><h3>${state.devices.length ? `已接入 ${state.devices.length} 台墨水屏` : '你的第一台墨水屏，等待连接'}</h3><p>默认画面：${esc(active?.name)} · ${state.settings.width} × ${state.settings.height} · ${state.quietNow ? '当前处于静默时段' : '设备下次请求时获取最新画面'}</p></div><button data-action="connect" class="small">${state.devices.length ? '管理设备' : '查看接入地址'} ↗</button></div>` +
    `<div class="section-head"><h2>精选主题 <small> / 只读模板</small></h2><small>复制一份，开始你的创作</small></div><div class="theme-grid">${state.themes.filter(t => t.builtin).map(themeCard).join('')}</div>` +
    `<div class="section-head"><h2>我的主题 <small> / 自由编辑</small></h2><small>${state.customThemes.length} 个自定义主题</small></div><div class="theme-grid">${state.themes.filter(t => !t.builtin).map(themeCard).join('')}<button class="blank-card" data-action="blank"><span class="plus">＋</span><h3>从一张白纸开始</h3><p>文字、图片、日历，自由组合</p></button></div>`;
}
function themeCard(t) {
  return `<article class="theme-card"><div class="theme-preview"><span class="badge ${t.id === state.activeTheme ? 'active' : ''}">${t.id === state.activeTheme ? '默认画面' : t.builtin ? '内置主题' : '自定义'}</span><img loading="lazy" src="/api/themes/${encodeURIComponent(t.id)}/preview?v=${Date.now()}" alt="${esc(t.name)}预览"></div><div class="card-content"><div class="card-title"><h3>${esc(t.name)}</h3><small>${t.width} × ${t.height}</small></div><p>${esc(t.description)}</p><div class="card-actions"><button class="small soft" data-action="activate" data-id="${t.id}">设为默认</button><button class="small" data-action="${t.builtin ? 'copy' : 'edit'}" data-id="${t.id}">${t.builtin ? '复制并编辑' : '编辑主题'} ↗</button></div></div></article>`;
}
function blank() { return { name: '未命名主题', description: '我的自定义画面', width: state.settings.width, height: state.settings.height, background: '#ffffff', elements: [] }; }
function renderEditor() {
  textEditor?.destroy(); textEditor=null;
  if (!draft) draft = blank();
  const el = draft.elements.find(e => e.id === selected);
  $('#content').innerHTML = head('一张画布，无限可能。', '拖动元素移动，拖动边框控制点缩放；按住 Shift 保持比例。', '<div class="row"><button data-action="save">保存主题</button><button class="primary" data-action="save-activate">保存并设为默认</button></div>') +
    `<div class="section-head"><div class="editor-top"><input id="theme-name" aria-label="主题名称" value="${esc(draft.name)}"><span class="tag">${draft.width} × ${draft.height}</span><span class="hint" id="save-status">${dirty ? '有未保存更改' : '编辑你的画面'}</span></div><button class="small" data-action="download">下载 BMP ↧</button></div>` +
    `<div class="editor-layout"><section class="panel editor-panel"><h3>添加元素</h3><div class="tool-buttons"><button data-action="add-text">T 文字</button><button data-action="add-image">▧ 图片</button><button data-action="add-rect">□ 色块</button><button data-action="add-calendar">▦ 日历</button><button data-action="add-weather-icon">☁ 气象</button><button data-action="add-month-grid">▦ 农历</button><button data-action="add-trending-feed">热搜列表</button><button data-action="add-news-feed">新闻列表</button></div><div class="layer-list">${draft.elements.map(e => `<button class="layer ${e.id === selected ? 'selected' : ''}" data-action="select" data-id="${esc(e.id)}">${esc(e.text || elementLabels[e.type] || e.type)}</button>`).join('') || '<p class="hint">添加第一个元素<br>开始创作</p>'}</div></section>` +
    `<section class="stage-wrap"><div class="stage" id="stage" style="aspect-ratio:${state.settings.width}/${state.settings.height}"><img id="canvas-preview" alt="画布预览" style="aspect-ratio:${state.settings.width}/${state.settings.height}"><div class="selection" id="selection" hidden></div></div><span class="stage-caption" id="preview-status">正在生成预览…</span><div class="page-controls"><button class="small" data-action="prev-page">← 上一页</button><span id="page-label">预览页 ${editorPage+1}</span><button class="small" data-action="next-page">下一页 →</button></div></section><section class="panel editor-panel properties"><h3>${el ? '元素属性' : '画布属性'}</h3>${el ? properties(el) : `<div class="field"><label>背景颜色</label><input type="color" id="bg-color" value="${draft.background}"></div><p class="hint">预览尺寸由全局设置决定。<br>模板会按比例适配设备画布。</p>`}</section></div>` +
    '<p class="editor-footer">动态文字：{{date}} 日期 · {{time}} 时间 · {{weekday}} 星期 · {{lunarDate}} 农历 · {{city}} 城市 · {{temperature}} 温度 · {{memo}} 备忘录<br>天气城市与信息源在「设置」中配置。列表组件自动分页，网页翻页不会改变设备页码。</p>';
  $('#theme-name').addEventListener('input', e => { draft.name = e.target.value; markDirty(); });
  $('#bg-color')?.addEventListener('input', e => { draft.background = e.target.value; markDirty(); queuePreview(); });
  document.querySelectorAll('[data-prop]').forEach(input => input.addEventListener('input', e => {
    if (e.target.type === 'number' && (e.target.value === '' || !e.target.checkValidity())) return;
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' || e.target.dataset.prop === 'size' ? Number(e.target.value) : e.target.value;
    el[e.target.dataset.prop] = value; markDirty(); updateSelection(); textEditor?.paint(); queuePreview();
  }));
  if (el?.type==='text') textEditor=bindTextEditor(el,()=>{markDirty();updateSelection();queuePreview();});
  bindDrag(); updateSelection(); queuePreview(0);
}
function properties(el) {
  const bounds = {x:[-1600,3200],y:[-1600,3200],width:[1,3200],height:[1,3200],size:[6,el.type==='feed'?100:300],lineHeight:[1,3]};
  const field = (key, name, type = 'number') => `<div class="field"><label>${name}</label><input type="${type}" ${bounds[key]?`min="${bounds[key][0]}" max="${bounds[key][1]}"`:''} ${key === 'lineHeight' ? 'step="0.1"' : ''} data-prop="${key}" value="${esc(el[key] ?? (key === 'lineHeight' ? 1.3 : ''))}" aria-label="${name}"></div>`;
  const text=el.type==='text'?`<div class="text-tools" role="toolbar" aria-label="文字格式"><label>字号<select data-prop="size" aria-label="字号">${[...new Set([8,9,10,11,12,14,16,18,20,22,24,26,28,32,36,40,48,56,64,72,96,120,el.size])].sort((a,b)=>a-b).map(size=>`<option value="${size}" ${size===el.size?'selected':''}>${size}</option>`).join('')}</select></label>${[['bold','B','加粗'],['italic','I','斜体'],['underline','U','下划线'],['strike','S','删除线']].map(([key,label,title])=>`<button type="button" data-text-toggle="${key}" class="format-${key}" aria-label="${title}" title="${title}" aria-pressed="${Boolean(el[key])}">${label}</button>`).join('')}<select data-prop="align" aria-label="文字对齐">${[['left','左对齐'],['center','居中'],['right','右对齐']].map(([v,l])=>`<option value="${v}" ${(el.align||'left')===v?'selected':''}>${l}</option>`).join('')}</select></div><label class="text-editor-label" for="text-input">文字内容 <small>与画布同尺寸、同字号</small></label><div class="text-viewport"><div id="text-editor"><canvas aria-label="文字排版编辑区"></canvas><textarea id="text-input" aria-label="文字内容" maxlength="5000" spellcheck="false"></textarea></div></div><p class="hint" id="text-layout-hint"></p><button class="small" id="fit-text-height">适应文字高度</button><div class="checkline"><input type="checkbox" data-prop="fit" id="fit" ${el.fit?'checked':''}><label for="fit">单行文字过长时缩小字号</label></div>${field('lineHeight','行高')}`:'';
  return text+`${el.type==='image'?'<div class="image-actions"><button data-action="recrop-image">重新裁剪</button><button data-action="replace-image">更换图片</button></div>':''}${el.type==='weather-icon'?'<p class="hint">天气图标随设置中的城市天气更新。</p>':''}${el.type==='feed'?`<div class="field"><label>列表数据</label><select data-prop="source"><option value="trending" ${el.source==='trending'?'selected':''}>微博热搜</option><option value="news" ${el.source==='news'?'selected':''}>新闻头条</option></select><small>数据源在设置中选择，自动分页。</small></div><div class="row">${field('size','字号')}${field('lineHeight','行高')}</div><div class="checkline"><input type="checkbox" data-prop="bold" ${el.bold?'checked':''} id="bold"><label for="bold">加粗</label></div>`:''}<div class="row">${field('x','X 坐标')}${field('y','Y 坐标')}</div><div class="row">${field('width','宽度')}${field('height','高度')}</div>${field('color','颜色','color')}<div class="row"><button class="small" data-action="backward">下移一层</button><button class="small" data-action="forward">上移一层</button></div><button class="small" style="margin-top:12px;width:100%" data-action="remove">移除元素</button>`;
}
function markDirty() { dirty = true; if ($('#save-status')) $('#save-status').textContent = '有未保存更改'; }
function updateSelection() {
  const el = draft.elements.find(e => e.id === selected), box = $('#selection'); if (!box) return;
  box.hidden = !el;
  if(!box.children.length)box.innerHTML=['nw','n','ne','e','se','s','sw','w'].map(h=>`<button class="resize-handle handle-${h}" data-handle="${h}" aria-label="调整元素大小 ${h}" tabindex="-1"></button>`).join('');
  if (el) { const flipped = state.settings.rotation === 180; Object.assign(box.style, { left: `${(flipped ? draft.width - el.x - el.width : el.x) / draft.width * 100}%`, top: `${(flipped ? draft.height - el.y - el.height : el.y) / draft.height * 100}%`, width: `${el.width / draft.width * 100}%`, height: `${el.height / draft.height * 100}%` }); }
}
function queuePreview(delay = 200) { clearTimeout(previewTimer); const version = ++previewVersion; previewTimer = setTimeout(() => preview(version), delay); }
async function preview(version) {
  try {
    const r = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ theme: draft,page:editorPage }) });
    if (!r.ok) throw Error((await r.json()).error);
    const blob = await r.blob(); if (version !== previewVersion || view !== 'editor') return;
    editorPageCount=Number(r.headers.get('X-Ink-Page-Count'))||1;editorPage%=editorPageCount;
    $('#page-label').textContent=`${editorPage+1} / ${editorPageCount}`;
    if (previewURL) URL.revokeObjectURL(previewURL); previewURL = URL.createObjectURL(blob); $('#canvas-preview').src = previewURL; $('#preview-status').textContent = '拖动元素移动 · 拖动控制点缩放 · Shift 保持比例';
  } catch (e) { if (version === previewVersion && $('#preview-status')) $('#preview-status').textContent = e.message; }
}
function bindDrag() {
  const stage = $('#stage'); let drag;
  const position = e => { const b = drag?.bounds || stage.getBoundingClientRect(), flip = state.settings.rotation === 180; let x = (e.clientX - b.left) / b.width * draft.width, y = (e.clientY - b.top) / b.height * draft.height; return { x: flip ? draft.width - x : x, y: flip ? draft.height - y : y }; };
  stage.addEventListener('pointerdown', e => {
    if(e.button!==0)return;
    e.preventDefault(); const p = position(e), bounds=stage.getBoundingClientRect(), active=draft.elements.find(el=>el.id===selected);
    let handle=e.target.closest('[data-handle]')?.dataset.handle;
    if(handle&&state.settings.rotation===180)handle=MojianGeometry.flipHandle(handle);
    if(!handle&&active){
      const points={nw:[0,0],n:[.5,0],ne:[1,0],e:[1,.5],se:[1,1],s:[.5,1],sw:[0,1],w:[0,.5]};
      handle=Object.keys(points).find(h=>{const [x,y]=points[h];return Math.abs(p.x-active.x-x*active.width)*bounds.width/draft.width<9&&Math.abs(p.y-active.y-y*active.height)*bounds.height/draft.height<9;});
    }
    const element = handle?draft.elements.find(el=>el.id===selected):[...draft.elements].reverse().find(el => p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height);
    if (!element) { selected = null; renderEditor(); return; }
    selected = element.id; drag = { element, start:{x:element.x,y:element.y,width:element.width,height:element.height}, p, handle, bounds, moved: false }; stage.setPointerCapture(e.pointerId); updateSelection();
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return; const p=position(e),dx=p.x-drag.p.x,dy=p.y-drag.p.y;
    if(Math.abs(dx)+Math.abs(dy)<1)return;
    const rect=drag.handle?MojianGeometry.resize(drag.start,drag.handle,dx,dy,e.shiftKey):{x:MojianGeometry.clamp(Math.round(drag.start.x+dx),-1600,3200),y:MojianGeometry.clamp(Math.round(drag.start.y+dy),-1600,3200)};
    Object.assign(drag.element,rect);drag.moved=true;updateSelection();
    for(const [key,value] of Object.entries(rect)){const input=document.querySelector(`[data-prop="${key}"]`);if(input)input.value=value;}
    textEditor?.paint();queuePreview(60);
  });
  const end = e => { if (!drag) return; if(e.type==='pointercancel')Object.assign(drag.element,drag.start);else if (drag.moved) markDirty(); drag = null; renderEditor(); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
}
async function saveTheme(activate) {
  const saved = await api(draft.id ? `/api/themes/${draft.id}` : '/api/themes', draft.id ? 'PUT' : 'POST', draft);
  draft = saved; dirty = false;
  if (activate) await api('/api/activate', 'POST', { themeId: saved.id });
  await refresh(); renderEditor(); toast(activate ? '已保存并设为默认，设备下次请求时生效' : '主题已保存');
}
function renderDevices() {
  const addresses = state.addresses.length ? state.addresses : [`${state.local}/generate-image`];
  $('#content').innerHTML = head('连接，每一块小屏幕。', '设备请求时自动登记；页面每 5 秒更新一次设备和请求信息。') +
    `<section class="panel" style="margin-bottom:24px"><h3>设备接入地址</h3><p class="subtext">在设备的自定义服务器设置中填写以下完整地址。设备与电脑需要在同一局域网，电脑保持运行。</p>${addresses.map(a => `<div class="row"><code class="endpoint">${esc(a)}</code><button class="small" style="flex:none" data-action="clipboard" data-value="${esc(a)}">复制</button></div>`).join('')}<p class="hint">有多个地址时，选择与设备 Wi-Fi 同网段的地址。localhost 只能在这台电脑上使用。</p></section>` +
    (state.devices.length ? `<div class="device-cards">${state.devices.map(d => `<section class="panel"><div class="card-title"><h3>${esc(d.name)}</h3><span class="badge"><span class="dot ${Date.now() - new Date(d.lastSeen) > 10 * 60e3 ? 'gray' : ''}"></span>${Date.now() - new Date(d.lastSeen) < 10 * 60e3 ? '近期有请求' : '等待下次请求'}</span></div><small class="hint">${esc(d.id)}</small><div class="device-meta"><div><small>设备型号</small>${esc(d.model || '未上报')}</div><div><small>剩余电量</small>${esc(d.battery === '' ? '未上报' : d.battery + '%')}</div><div><small>电压（原始值）</small>${esc(d.voltage || '未上报')}</div><div><small>累计请求</small>${d.count}</div></div><div class="field"><label>设备名称</label><input data-device-name="${esc(d.id)}" value="${esc(d.name)}"></div><div class="field"><label>显示主题</label><select data-device-theme="${esc(d.id)}"><option value="">跟随默认主题</option>${state.themes.map(t => `<option value="${t.id}" ${d.themeId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div><p class="hint">最近请求：${time(d.lastSeen)}<br>地址：${esc(d.ip)}<br>${d.lastResponse?.held ? '静默时段：返回上一张画面' : '设备是否实际显示成功，仍需观察屏幕确认'}</p><button class="small" data-action="device-detail" data-id="${esc(d.id)}">查看上报详情</button></section>`).join('')}</div>` : '<div class="empty"><h3>等待第一台设备发来请求</h3><p>保存设备服务地址后，触发设备刷新。<br>收到 x-devid 后，它会自动出现在这里。<br>没有设备编号的请求也可以在「请求记录」中查看。</p></div>');
  document.querySelectorAll('[data-device-theme],[data-device-name]').forEach(input => input.addEventListener('change', async e => { try { const theme = e.target.dataset.deviceTheme; await api(`/api/devices/${encodeURIComponent(theme || e.target.dataset.deviceName)}`, 'PUT', theme ? { themeId: e.target.value } : { name: e.target.value }); await refresh(); toast('设备设置已保存'); } catch (e) { toast(e.message); } }));
}
function renderRequests() {
  $('#content').innerHTML = head('听见设备的每一次连接。', '保存最近 200 次请求，本页展示最近 100 次。浏览器图片预览不会登记为设备。', '<button data-action="reload">↻ 刷新记录</button>') +
    `<div class="notice">这里能确认设备发来了什么，以及服务返回了什么；HTTP 200 不代表设备已经成功显示。Authorization、Cookie 和常见密钥字段会隐藏。</div>` +
    (state.requests.length ? `<div class="table-wrap"><table><thead><tr><th>请求时间</th><th>设备 / 来源</th><th>路径</th><th>状态</th><th>响应</th><th></th></tr></thead><tbody>${state.requests.map(r => `<tr><td>${time(r.at)}</td><td>${esc(r.deviceId || '无设备编号')}<small>${esc(r.ip)}</small></td><td>${esc(r.method)} ${esc(r.url)}</td><td><span class="${r.status !== 200 ? 'error' : ''}">${r.status}</span></td><td>${r.held ? '静默画面' : r.status === 200 ? 'BMP 图片' : '未成功'}</td><td><button class="small" data-action="request-detail" data-id="${r.id}">详情 ↗</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>还没有设备请求</h3><p>真实设备或 curl 请求 /generate-image 后，完整诊断信息会显示在这里。</p></div>');
}
function renderSettings() {
  const s = state.settings;
  const field = (key, label, type = 'number', hint = '') => `<div class="field"><label for="s-${key}">${label}</label><input id="s-${key}" name="${key}" type="${type}" value="${esc(s[key])}" ${type === 'number' ? 'step="any"' : ''}>${hint ? `<small>${hint}</small>` : ''}</div>`;
  const select = (key, label, options) => `<div class="field"><label for="s-${key}">${label}</label><select id="s-${key}" name="${key}">${options.map(([v,l]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  $('#content').innerHTML = head('按你的节奏，显示。', '设置应用于全部设备。画面处理在服务器完成，设备下次请求时获取结果。', '<button class="primary" data-action="save-settings">保存设置</button>') +
    `<form id="settings-form" class="settings-grid"><section class="panel"><h3>刷新与静默</h3>${select('interval','刷新间隔',[['1005','每 5 分钟'],['0','每 1 小时'],['1','每 2 小时']])}${field('timezone','时区','text')}<div class="checkline"><input id="quiet" name="quietEnabled" type="checkbox" ${s.quietEnabled ? 'checked' : ''}><label for="quiet">开启深夜保持画面</label></div><div class="row">${field('quietStart','开始整点（0–23）')}${field('quietEnd','结束整点（0–23）')}</div><p class="notice">静默期间返回该设备上次生成的图片。设备仍可能唤醒和重刷；彻底停止刷新需厂商协议支持。首次接入没有历史图片时，会生成一次画面。</p></section>` +
    `<section class="panel"><h3>画面处理</h3><div class="row">${field('width','输出宽度（px）')}${field('height','输出高度（px）')}</div>${select('mode','图像处理模式',[['threshold','阈值 · 黑白红'],['floyd','弗洛伊德 Floyd–Steinberg'],['atkinson','艾特金 Atkinson'],['original','原始彩色（不量化）']])}<div class="row">${field('brightness','亮度阈值（1–254）')}${field('redThreshold','红色阈值（1–255）')}</div>${select('rotation','屏幕方向',[[0,'正常显示'],[180,'翻转 180°']])}<p class="hint">亮度阈值控制图像明暗，不是屏幕背光。红色阈值越大，越少颜色被识别为红色。请按设备实际分辨率设置。</p></section>` +
    `<section class="panel"><h3>天气城市</h3><div class="field"><label for="city-search">搜索城市或区县</label><div class="row"><input id="city-search" placeholder="例如：北京、杭州、Haidian"><button type="button" data-action="search-city" class="small" style="flex:none">搜索城市</button></div><div id="city-results" class="city-results"></div></div>${field('city','城市显示名称','text')}${field('cityLocation','所属地区','text')}<div class="row">${field('latitude','纬度')}${field('longitude','经度')}</div><div class="checkline"><input id="live-weather" name="weatherLive" type="checkbox" ${s.weatherLive ? 'checked' : ''}><label for="live-weather">启用真实天气（Open-Meteo）</label></div><p class="hint">选中搜索结果会自动填入坐标和时区，并启用真实天气；点击「保存设置」后生效。查不到中文地名时可试拼音，或手动填写坐标。天气缓存 10 分钟。</p></section>` +
    `<section class="panel"><h3>设备与服务</h3><div class="checkline"><input id="sound" name="sound" type="checkbox" ${s.sound ? 'checked' : ''}><label for="sound">刷新提示音</label></div><p class="hint">设备下次请求时下发：${s.sound?'sound=1（开启）':'sound=0（关闭）'}。</p><div class="checkline"><input id="server-override" name="serverOverrideEnabled" type="checkbox" ${s.serverOverrideEnabled?'checked':''}><label for="server-override">下发自定义服务器地址</label></div>${field('serverHost','服务器 IP / 域名','text','例如 192.168.1.10，只填主机，不带 http:// 或路径。')}${field('serverPort','服务器端口')}<div class="notice">启用后设备可能切换到目标服务器，请先确认目标可访问。关闭后不发送 burl / bport；不会自动撤销设备已经保存的新地址。</div><p class="hint">所有设备共用此设置。响应头可在请求详情核对，是否已应用需观察真实设备。厂商 OTA 查询仍关闭。</p></section>` +
    `<section class="panel"><h3>热搜与新闻数据源</h3>${select('trendingSource','微博热搜',[['weibo','微博实时热搜（站点公开接口）'],['manual','手动填写']])}${select('newsSource','新闻头条',[['toutiao','今日头条热榜（站点公开接口）'],['manual','手动填写']])}<div class="checkline"><input id="feed-rotate" name="feedRotate" type="checkbox" ${s.feedRotate?'checked':''}><label for="feed-rotate">设备每次正常刷新自动翻到下一页</label></div><p class="hint">缓存 10 分钟；接口失败时显示上次成功数据及时间。列表在静默时段不翻页。站点接口可能变化，并非有稳定承诺的开放平台 API。</p><button type="button" class="small" data-action="test-sources">测试当前数据源</button><div id="source-test" class="hint" style="margin-top:12px" role="status"></div></section>` +
    `<section class="panel"><h3>日程与倒计时</h3>${field('schedule','日程摘要','text')}${field('countdownName','倒计时名称','text')}${field('countdownDate','目标日期','date','留空时按当年 10 月 1 日计算。')}<p class="hint">用于「日历气象台」「农历月历」；农历按所选时区自动计算。</p></section>` +
    `<section class="panel full"><h3>手动内容</h3><p class="hint">列表选择「手动填写」时使用以下内容，每行一条；真实接口失败时使用旧缓存，不会混入手动示例。</p><div class="row">${['memo','trending','news'].map((k,i) => `<div class="field"><label>${['备忘录','微博热搜 / 手动列表','新闻头条 / 手动列表'][i]}</label><textarea name="${k}" rows="7">${esc(s[k])}</textarea></div>`).join('')}</div></section></form>`;
  $('#settings-form').addEventListener('input', e => { if(e.target.name)dirty = true; });
  $('#settings-form').addEventListener('submit', e => e.preventDefault());
}
function readSettingsForm() {
  const form = $('#settings-form'), s = { ...state.settings };
  for (const element of form.elements) if (element.name) s[element.name] = element.type === 'checkbox' ? element.checked : element.type === 'number' || element.name === 'rotation' ? Number(element.value) : element.value;
  return s;
}
async function saveSettings() {
  const s=readSettingsForm();
  await api('/api/settings', 'PUT', s); dirty = false; await refresh(); renderSettings(); toast('设置已保存，设备下次请求时使用');
}
function showDetail(value) { $('#detail-body').textContent = JSON.stringify(value, null, 2); $('#detail').showModal(); }
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]'); if (nav) return navigate(nav.dataset.view);
  const button = event.target.closest('[data-action]'); if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (['blank','copy','edit'].includes(action)) {
      if (dirty && !confirm('当前更改尚未保存，确定打开另一个主题？')) return;
      const t = state.themes.find(t => t.id === id);
      draft = action === 'blank' ? blank() : structuredClone(t);
      if (action === 'copy') { delete draft.id; draft.builtin = false; draft.name += ' · 副本'; }
      selected = null; dirty = false; editorPage=0;editorPageCount=1;navigate('editor'); return;
    }
    if (action === 'connect') navigate('devices');
    if (action === 'activate') { await api('/api/activate','POST',{ themeId: id }); await refresh(); renderThemes(); toast('默认主题已更新，设备下次请求时获取'); }
    if (action === 'save' || action === 'save-activate') { button.disabled = true; await saveTheme(action === 'save-activate'); }
    if (action === 'save-settings') { button.disabled = true; await saveSettings(); }
    if(action==='search-city') {
      button.disabled=true;const query=$('#city-search').value.trim();$('#city-results').textContent='正在查找城市…';
      try {
        const result=await api(`/api/cities?q=${encodeURIComponent(query)}`);if(view!=='settings')return;
        cityResults=result.cities;$('#city-results').innerHTML=cityResults.map((c,i)=>`<button type="button" data-action="choose-city" data-index="${i}"><strong>${esc(c.name)}</strong><small>${esc(c.location)} · ${c.latitude}, ${c.longitude}</small></button>`).join('')||'<p class="hint">未找到，请试城市拼音或手动填写坐标。</p>';
      }catch(e){if($('#city-results'))$('#city-results').textContent=e.message;}
    }
    if(action==='choose-city') {
      const c=cityResults[Number(button.dataset.index)];if(!c)return;
      for(const [key,value] of Object.entries({city:c.name,cityLocation:c.location,latitude:c.latitude,longitude:c.longitude,timezone:c.timezone}))$(`#s-${key}`).value=value;
      $('#live-weather').checked=true;dirty=true;$('#city-results').textContent=`已选择 ${c.name} · ${c.location}，保存后生效。`;
    }
    if(action==='test-sources') {
      button.disabled=true;$('#source-test').textContent='正在请求天气、微博和头条…';
      try{const r=await api('/api/data/test','POST',{settings:readSettingsForm()});if(view!=='settings')return;
        $('#source-test').textContent=[`天气：${r.weather.weatherSource||'示例模式'}${r.weather.error?'（'+r.weather.error+'）':''}`,...[['trending','微博'],['news','新闻']].map(([k,label])=>`${label}：${r[k].status}，${r[k].at||r[k].source==='manual'?r[k].items.length:0} 条${r[k].error?'（'+r[k].error+'）':''}`)].join('\n');
      }catch(e){if($('#source-test'))$('#source-test').textContent=e.message;}
    }
    if(action==='prev-page'||action==='next-page'){editorPage=(editorPage+(action==='next-page'?1:-1)+editorPageCount)%editorPageCount;queuePreview(0);}
    if (action === 'select') { selected = id; renderEditor(); }
    if (action === 'replace-image') { replaceImageId=selected; $('#image-file').click(); return; }
    if (action === 'recrop-image') {
      const el=draft.elements.find(e=>e.id===selected), cropped=await cropImage(el.src,el);
      if(cropped){el.crop=cropped.crop;el.height=Math.max(1,Math.min(3200,Math.round(el.width/cropped.ratio)));markDirty();renderEditor();}
    }
    if (action.startsWith('add-')) {
      const requested = action.slice(4); if (requested === 'image') { replaceImageId=null; $('#image-file').click(); return; }
      const type=requested.endsWith('-feed')?'feed':requested;
      const element = { id: uid(), type, x: 24, y: 24, width: ['text','feed'].includes(type) ? 330 : 150, height: type === 'text' ? 50 : type==='feed'?170:100, color: '#111111', ...(type === 'text' ? { text: '写下你的灵感', size: 24, lineHeight: 1.3, bold: false } : {}),...(type==='feed'?{source:requested.startsWith('news')?'news':'trending',size:18,lineHeight:1.1,bold:true}:{}) };
      draft.elements.push(element); selected = element.id; markDirty(); renderEditor();
    }
    if (['remove','backward','forward'].includes(action)) {
      const index = draft.elements.findIndex(e => e.id === selected); if (index < 0) return;
      if (action === 'remove') { draft.elements.splice(index,1); selected = null; }
      else { const next = index + (action === 'forward' ? 1 : -1); if (next >= 0 && next < draft.elements.length) [draft.elements[index],draft.elements[next]] = [draft.elements[next],draft.elements[index]]; }
      markDirty(); renderEditor();
    }
    if (action === 'reload') { await refresh(); renderRequests(); }
    if (action === 'request-detail') showDetail(state.requests.find(r => r.id === id));
    if (action === 'device-detail') showDetail(state.devices.find(d => d.id === id));
    if (action === 'clipboard') { try { await navigator.clipboard.writeText(button.dataset.value); toast('地址已复制'); } catch { showDetail({ '请复制此地址': button.dataset.value }); } }
    if (action === 'download') {
      // Download the current draft, without changing the device's active theme.
      const r = await fetch('/api/export', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:draft,page:editorPage}) });
      if (!r.ok) throw Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = `${draft.name}.bmp`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    }
  } catch (e) { toast(e.message); } finally { button.disabled = false; }
});
$('#image-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) return toast('请选择小于 2 MB 的 PNG / JPEG / WebP');
  try {
    const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file);});
    const target=draft.elements.find(el=>el.id===replaceImageId), cropped=await cropImage(src,target?{...target,crop:undefined}:null);
    if(!cropped)return;
    if(target){Object.assign(target,{src:cropped.src,crop:cropped.crop,height:Math.max(1,Math.min(3200,Math.round(target.width/cropped.ratio)))});selected=target.id;}
    else{const width=Math.max(1,Math.round(Math.min(draft.width*.8,draft.height*.8*cropped.ratio))),height=Math.max(1,Math.round(width/cropped.ratio));
      const el={id:uid(),type:'image',x:Math.round((draft.width-width)/2),y:Math.round((draft.height-height)/2),width,height,color:'#ffffff',src:cropped.src,crop:cropped.crop};draft.elements.push(el);selected=el.id;}
    markDirty();renderEditor();
  } catch(error){toast(`无法添加图片：${error.message}`);} finally{replaceImageId=null;}
});
$('#close-detail').addEventListener('click', () => $('#detail').close());
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
setInterval(async () => { if (!['devices','requests'].includes(view) || document.activeElement?.matches('input,select,textarea') || $('#detail').open) return; try { await refresh(); if (view === 'devices') renderDevices(); else renderRequests(); } catch {} }, 5000);
$('#clock').textContent = new Date().toLocaleDateString('zh-CN', { month:'long',day:'numeric',weekday:'short' });
Promise.all([refresh(),document.fonts.load('24px "Mojian Text"'),document.fonts.load('bold 24px "Mojian Text"')]).then(() => navigate('themes')).catch(e => { $('#content').innerHTML = `<div class="empty"><h3>暂时无法连接服务</h3><p>${esc(e.message)}</p></div>`; });
