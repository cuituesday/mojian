const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {searchChineseCities:search}=require('../lib/city-search');
const {createDataSources}=require('../lib/data-sources');
const {createApp}=require('../server');
const data=require('../lib/locations/china-cities.json');

test('中文城市简称和市后缀一致，开封与商丘不会匹配同名乡镇',()=>{
  for(const [name,location] of [['北京','北京市'],['开封','河南省 · 开封市'],['商丘','河南省 · 商丘市']]){
    const results=search(name);
    assert.deepEqual(search(name+'市'),results);
    assert.equal(results.length,1);assert.equal(results[0].name,name);
    assert.equal(results[0].level,'city');assert.equal(results[0].location,location);
  }
});

test('同名地名先市后区县，明确区县后缀和省市前缀时尊重指定地区',()=>{
  assert.equal(search('朝阳')[0].location,'辽宁省 · 朝阳市');
  assert.equal(search('朝阳市')[0].level,'city');
  assert.equal(search('朝阳县')[0].level,'county');
  const districts=search('朝阳区');assert.equal(districts.length,2);
  assert.ok(districts.every(c=>c.level==='county'));
  assert.deepEqual(districts.map(c=>c.location),['北京市','吉林省 · 长春市']);
  for(const q of ['北京市朝阳区','北京朝阳','北京市 朝阳区']){
    const rows=search(q);assert.equal(rows.length,1);assert.equal(rows[0].location,'北京市');
    assert.equal(rows[0].latitude,39.9215);assert.equal(rows[0].longitude,116.4864);
  }
  assert.equal(search('长春市朝阳区')[0].location,'吉林省 · 长春市');
  for(const q of ['宁陵','宁陵县','商丘宁陵县','河南省商丘市宁陵县','河南商丘宁陵']){
    const rows=search(q);assert.equal(rows.length,1);assert.equal(rows[0].name,'宁陵');
    assert.equal(rows[0].location,'河南省 · 商丘市');assert.equal(rows[0].level,'county');
    assert.equal(rows[0].latitude,34.4493);assert.equal(rows[0].longitude,115.3201);
  }
  assert.equal(search('广州市天河区')[0].name,'天河');
  assert.equal(search('枣庄市市中区')[0].location,'山东省 · 枣庄市');
  assert.equal(search('济南市市中区')[0].location,'山东省 · 济南市');
  assert.deepEqual(search('北京市宁陵县'),[]);
});

test('本地坐标目录有效，无本地命中时保留在线地名查询',async t=>{
  assert.ok(data.rows.length>3000);assert.equal(new Set(data.rows.map(r=>r[0])).size,data.rows.length);
  for(const row of data.rows){assert.equal(row.length,8);assert.ok(row[5]>=-90&&row[5]<=90);assert.ok(row[6]>=-180&&row[6]<=180);}
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mojian-cities-'));
  t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  let calls=0;
  const sources=createDataSources({dataDir,fetchImpl:async url=>{
    calls++;assert.equal(new URL(url).searchParams.get('name'),'London');
    return {ok:true,text:async()=>JSON.stringify({results:[{id:123,name:'London',latitude:51.5,longitude:-.12,timezone:'Europe/London',country:'英国'}]})};
  }});
  for(const q of ['北京','北京市','北京市朝阳区','朝阳区','开封','开封市','商丘','商丘市','宁陵县'])assert.ok((await sources.cities(q)).length);
  assert.equal(calls,0);
  assert.equal((await sources.cities('London'))[0].timezone,'Europe/London');assert.equal(calls,1);
});

test('城市接口断网仍可查询中文市区县，并保存选择的天气坐标',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mojian-city-api-'));
  let calls=0;
  const server=createApp({dataDir,fetchImpl:async()=>{calls++;throw Error('测试断网');}}).listen(0,'127.0.0.1');
  await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  let selected;
  for(const q of ['北京','北京市','北京市朝阳区','朝阳区','开封','开封市','商丘','商丘市','宁陵县']){
    const response=await fetch(`${base}/api/cities?q=${encodeURIComponent(q)}`);assert.equal(response.status,200);
    const {cities}=await response.json();assert.ok(cities.length);selected=cities[0];
  }
  assert.equal(calls,0);
  const response=await fetch(`${base}/api/settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({city:selected.name,cityLocation:selected.location,latitude:selected.latitude,longitude:selected.longitude,timezone:selected.timezone,weatherLive:true})});
  assert.equal(response.status,200);
  const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'))).settings;
  assert.equal(saved.city,'宁陵');assert.equal(saved.cityLocation,'河南省 · 商丘市');assert.equal(saved.latitude,34.4493);assert.equal(saved.longitude,115.3201);
});
