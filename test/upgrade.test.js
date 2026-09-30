const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {createCanvas}=require('canvas');
const {createApp,validateSettings,validateTheme,deviceHeaders}=require('../server');
const {createDataSources,normalizeFeed}=require('../lib/data-sources');
const {themes,defaultSettings}=require('../lib/themes');
const {lunarParts}=require('../lib/calendar');
const {paginate}=require('../lib/widgets');
const {render}=require('../lib/render');

const feedFixture={data:{realtime:Array.from({length:20},(_,i)=>({word:`热搜测试标题 ${i+1}`}))}};
const mockFetch=async url=>{
  const u=String(url);
  if(u.includes('hotSearch'))return Response.json(feedFixture);
  if(u.includes('hot-board'))return Response.json({data:Array.from({length:15},(_,i)=>({Title:`新闻${i+1}：一条比较长的新闻标题，用于验证标题自动换行和分页之后能够完整显示。`}))});
  if(u.includes('/search?'))return Response.json({results:[{id:1,name:'杭州',latitude:30.27,longitude:120.15,timezone:'Asia/Shanghai',admin1:'浙江省',country:'中国'}]});
  return Response.json({current:{temperature_2m:22,relative_humidity_2m:66,weather_code:3},daily:{time:['2026-09-29','2026-09-30'],weather_code:[3,61],temperature_2m_max:[25,24],temperature_2m_min:[18,17]}});
};

test('sound and optional server headers match vendor protocol; invalid hosts rejected',()=>{
  assert.equal(deviceHeaders(defaultSettings).sound,'0');assert.equal(Object.hasOwn(deviceHeaders(defaultSettings),'burl'),false);
  const settings=validateSettings({sound:true,serverOverrideEnabled:true,serverHost:'192.168.1.10',serverPort:4000},defaultSettings);
  assert.deepEqual(deviceHeaders(settings),{wt:'1005',sound:'1',fver:'1.0.0',fmd5:'',burl:'192.168.1.10',bport:'4000'});
  const disabled=deviceHeaders({...settings,serverOverrideEnabled:false});assert.ok(!('burl'in disabled)&&!('bport'in disabled));
  for(const serverHost of ['http://192.168.1.10','x\r\nsound:1','192.168.1.10:4000','999.1.1.1','/generate-image'])assert.throws(()=>validateSettings({serverHost,serverOverrideEnabled:true},defaultSettings));
  assert.throws(()=>validateSettings({serverPort:1.5},defaultSettings));
});
test('reference date computes real lunar date and all templates remain editable',()=>{
  assert.equal(lunarParts(2026,9,29).lunarDate,'八月十九');assert.equal(lunarParts(2026,9,29).lunarYear,'丙午');
  for(const theme of themes){const copy=validateTheme(theme);assert.equal(copy.elements.length,theme.elements.length);assert.equal(copy.builtin,false);}
});
test('pagination keeps complete long titles inside available height without losing short entries',()=>{
  const ctx=createCanvas(400,300).getContext('2d');
  const el=themes.find(t=>t.id==='news').elements.find(e=>e.type==='feed');
  const items=Array.from({length:12},(_,i)=>({title:`新闻${i+1}。这是一个多行标题，用来验证跨页内容不会消失，末尾标记。`}));
  const layout=paginate(ctx,el,items);assert.ok(layout.pages.length>1);
  for(const page of layout.pages)assert.ok(page.length*layout.lineHeight<=el.height);
  const joined=layout.pages.flat().join('');for(let i=0;i<12;i++)assert.ok(joined.includes(`新闻${i+1}。`));
  assert.equal((joined.match(/末尾标记/g)||[]).length,12);
});
test('source cache deduplicates, survives restart, marks stale responses and isolates weather coordinates',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sources-test-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  let calls=0,clock=Date.now(),fail=false;
  const fetchImpl=async(url)=>{calls++;if(fail)throw Error('offline');return mockFetch(url);};
  const sources=createDataSources({dataDir,fetchImpl,now:()=>clock});
  const [a,b]=await Promise.all([sources.feed('trending',defaultSettings),sources.feed('trending',defaultSettings)]);assert.equal(calls,1);assert.equal(a.items.length,20);assert.deepEqual(a,b);
  const restored=createDataSources({dataDir,fetchImpl,now:()=>clock});await restored.feed('trending',defaultSettings);assert.equal(calls,1);
  clock+=601000;fail=true;const stale=await restored.feed('trending',defaultSettings);assert.equal(stale.stale,true);assert.equal(stale.items.length,20);assert.match(stale.status,/旧缓存/);assert.equal(stale.error,'offline');
  await restored.feed('trending',defaultSettings);assert.equal(calls,2);
  fail=false;const weatherSettings={...defaultSettings,weatherLive:true};
  const weather=await sources.weather(weatherSettings);assert.equal(weather.tomorrowCondition,'雨');assert.equal(weather.temperature,22);
  const current=calls;await sources.weather({...weatherSettings,latitude:30});assert.equal(calls,current+1);
  const cities=await sources.cities('杭州');assert.equal(cities[0].longitude,120.15);
  assert.throws(()=>normalizeFeed('weibo',{data:{}}));
});
test('live-device responses send settings, paginate per device, and previews never advance device pages',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-protocol-test-'));
  const server=createApp({dataDir,fetchImpl:mockFetch}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(url,body,headers)=>fetch(base+url,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const settings=async s=>{const r=await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});assert.equal(r.status,200);};
  await settings({sound:true,serverOverrideEnabled:true,serverHost:'192.168.1.10',serverPort:4000});
  await call('/api/activate',{themeId:'trending'});
  let r=await call('/generate-image',null,{'x-devid':'device-A'});assert.equal(r.headers.get('sound'),'1');assert.equal(r.headers.get('burl'),'192.168.1.10');assert.equal(r.headers.get('bport'),'4000');await r.arrayBuffer();
  let state=await (await call('/api/state')).json();assert.deepEqual(state.devices[0].lastResponse.feedPages.trending,{page:1,total:3});
  r=await call('/api/preview',{themeId:'trending',page:1});assert.equal(r.headers.get('X-Ink-Page-Count'),'3');await r.arrayBuffer();
  state=await (await call('/api/state')).json();assert.equal(state.devices[0].contentPages.trending,1);
  r=await call('/generate-image',null,{'x-devid':'device-A'});await r.arrayBuffer();state=await(await call('/api/state')).json();assert.equal(state.devices[0].lastResponse.feedPages.trending.page,2);
  await settings({sound:false,serverOverrideEnabled:false});
  r=await call('/generate-image',null,{'x-devid':'device-B'});assert.equal(r.headers.get('sound'),'0');assert.equal(r.headers.get('burl'),null);assert.equal(r.headers.get('bport'),null);await r.arrayBuffer();
  r=await call('/generate-image?istest=1');assert.equal(r.headers.get('sound'),null);assert.equal(r.headers.get('burl'),null);await r.arrayBuffer();
  const hour=new Date().getUTCHours();await settings({quietEnabled:true,timezone:'UTC',quietStart:hour,quietEnd:(hour+2)%24});
  state=await(await call('/api/state')).json();const before=state.devices[0].contentPages.trending;
  r=await call('/generate-image',null,{'x-devid':'device-A'});await r.arrayBuffer();state=await(await call('/api/state')).json();
  assert.equal(state.devices[0].contentPages.trending,before);assert.equal(state.devices[0].lastResponse.held,true);
  const cities=await(await call('/api/cities?q=Hangzhou')).json();assert.equal(cities.cities[0].name,'杭州');
});
