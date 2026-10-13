const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {defaultSettings}=require('../lib/themes');
const {validateSettings,deviceHeaders,createApp}=require('../server');
const settings={...defaultSettings,interval:'0',quietEnabled:true,quietStart:22,quietEnd:6};

test('厂商小时和分钟编码范围完整支持，拒绝范围外或格式错误的值',()=>{
  for(const code of [...Array.from({length:24},(_,i)=>String(i)),...Array.from({length:60},(_,i)=>String(1001+i))]){
    const saved=validateSettings({interval:code},defaultSettings);
    assert.equal(deviceHeaders(saved).wt,code);
  }
  for(const interval of ['-1','24','1000','1061','1.5','01','',' 0','0\n',0,null])assert.throws(()=>validateSettings({interval},defaultSettings));
});

test('停止刷新时段按请求时间向上取整，时段外恢复正常间隔',()=>{
  for(const [local,expected] of [
    ['2026-10-13T21:55:00','0'],['2026-10-13T22:00:00','7'],
    ['2026-10-13T22:55:00','7'],['2026-10-13T23:00:00','6'],
    ['2026-10-14T00:00:00','5'],['2026-10-14T05:00:00','0'],
    ['2026-10-14T05:59:59.999','0'],['2026-10-14T06:00:00','0'],['2026-10-14T06:55:00','0']
  ])assert.equal(deviceHeaders(settings,new Date(local+'+08:00')).wt,expected,local);
  const minute={...settings,interval:'1001'};
  assert.equal(deviceHeaders(minute,new Date('2026-10-14T05:59:59+08:00')).wt,'0');
  assert.equal(deviceHeaders(minute,new Date('2026-10-14T06:00:00+08:00')).wt,'1001');
  assert.equal(deviceHeaders({...settings,quietEnabled:false},new Date('2026-10-13T22:55:00+08:00')).wt,'0');
  assert.equal(deviceHeaders({...settings,quietStart:6,quietEnd:10},new Date('2026-10-13T06:55:00+08:00')).wt,'3');
  assert.equal(deviceHeaders({...settings,quietStart:0,quietEnd:23},new Date('2026-10-13T00:01:00+08:00')).wt,'22');
  assert.equal(deviceHeaders({...settings,timezone:'UTC'},new Date('2026-10-13T22:55:00Z')).wt,'7');
  const dst={...settings,timezone:'America/New_York'};
  assert.equal(deviceHeaders(dst,new Date('2026-03-07T22:55:00-05:00')).wt,'6');
  assert.equal(deviceHeaders(dst,new Date('2026-10-31T22:55:00-04:00')).wt,'8');
});

test('设备响应和记录保存实际 wt，首次无缓存仍延后唤醒，预览不下发控制头',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mojian-refresh-'));
  let now=new Date('2026-10-13T21:55:00+08:00');
  const server=createApp({dataDir,clock:()=>now}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const saved=await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});assert.equal(saved.status,200);
  const call=id=>fetch(base+'/generate-image',{headers:{'x-devid':id}});
  let response=await call('device-A');assert.equal(response.headers.get('wt'),'0');
  const first=Buffer.from(await response.arrayBuffer());
  now=new Date('2026-10-13T22:55:00+08:00');
  response=await call('device-A');assert.equal(response.headers.get('wt'),'7');assert.deepEqual(Buffer.from(await response.arrayBuffer()),first);
  let state=await (await fetch(base+'/api/state')).json();
  assert.equal(state.requests[0].held,true);assert.equal(state.requests[0].quietActive,true);assert.equal(state.requests[0].responseHeaders.wt,'7');
  assert.equal(state.settings.interval,'0');assert.equal(state.devices[0].lastResponse.wt,'7');
  response=await call('device-B');assert.equal(response.headers.get('wt'),'7');await response.arrayBuffer();
  state=await (await fetch(base+'/api/state')).json();assert.equal(state.requests[0].held,false);assert.equal(state.requests[0].quietActive,true);
  response=await fetch(base+'/generate-image?istest=1');assert.equal(response.headers.get('wt'),null);await response.arrayBuffer();
  assert.equal((await (await fetch(base+'/api/state')).json()).requests.length,state.requests.length);
  now=new Date('2026-10-14T06:55:00+08:00');response=await call('device-A');assert.equal(response.headers.get('wt'),'0');await response.arrayBuffer();
  state=await (await fetch(base+'/api/state')).json();assert.equal(state.requests[0].held,false);assert.equal(state.requests[0].quietActive,false);
});
