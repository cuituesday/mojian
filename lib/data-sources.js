const fs = require('node:fs');
const path = require('node:path');
const ENDPOINTS = {
  weibo:'https://weibo.com/ajax/side/hotSearch',
  toutiao:'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
  geocoding:'https://geocoding-api.open-meteo.com/v1/search',
  weather:'https://api.open-meteo.com/v1/forecast'
};
function condition(code) {
  const names={0:'晴',1:'多云',2:'多云',3:'阴',45:'雾',48:'雾',51:'小雨',53:'小雨',55:'中雨',56:'冻雨',57:'冻雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'冻雨',71:'小雪',73:'中雪',75:'大雪',77:'小雪',80:'阵雨',81:'阵雨',82:'暴雨',85:'阵雪',86:'阵雪',95:'雷阵雨',96:'雷阵雨',99:'雷阵雨'};
  return names[code] || '暂无';
}
function normalizeFeed(kind,data) {
  const rows = kind==='weibo'?data?.data?.realtime:data?.data;
  if(!Array.isArray(rows))throw Error('数据格式发生变化');
  const items=rows.filter(r=>!r.is_ad).map(r=>({title:String(kind==='weibo'?(r.word||r.word_scheme||''):(r.Title||'')).trim().slice(0,300)})).filter(r=>r.title);
  if(!items.length)throw Error('接口没有返回有效标题');
  return items.slice(0,100);
}
function createDataSources({dataDir,fetchImpl=fetch,now=()=>Date.now()}) {
  const cachePath=path.join(dataDir,'source-cache.json');
  let cache={};
  if(fs.existsSync(cachePath)) {try{cache=JSON.parse(fs.readFileSync(cachePath,'utf8'));}catch{console.warn('数据源缓存损坏，将重新拉取。');}}
  const inFlight=new Map(), failures=new Map();
  function save() {fs.writeFileSync(`${cachePath}.tmp`,JSON.stringify(cache));fs.renameSync(`${cachePath}.tmp`,cachePath);}
  async function json(url,headers={}) {
    const response=await fetchImpl(url,{headers:{'User-Agent':'Mozilla/5.0 mojian/0.2',...headers},signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const raw=await response.text(); if(raw.length>4e6)throw Error('数据响应过大');
    try{return JSON.parse(raw);}catch{throw Error('接口返回了非 JSON 内容，可能暂时受访问限制');}
  }
  async function cached(key,loader) {
    const time=now(), old=cache[key];
    if(old&&time-old.at<10*60e3)return {...old,stale:false};
    const failed=failures.get(key);
    if(failed&&time-failed.at<60e3)return { ...old,stale:true,error:failed.error };
    if(inFlight.has(key))return inFlight.get(key);
    const pending=(async()=>{
      try {const value=await loader();const entry={at:now(),value};cache[key]=entry;save();failures.delete(key);return {...entry,stale:false};}
      catch(e){failures.set(key,{at:now(),error:e.message});return {...old,stale:true,error:e.message};}
      finally {inFlight.delete(key);}
    })();
    inFlight.set(key,pending);return pending;
  }
  const stamp=(at,timezone)=>new Date(at).toLocaleString('zh-CN',{timeZone:timezone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  async function feed(kind,settings) {
    const source=settings[`${kind}Source`];
    if(source==='manual')return {items:String(settings[kind]||'').split('\n').filter(Boolean).map(title=>({title})),status:'手动内容',source:'manual',stale:false};
    const entry=await cached(source,async()=>normalizeFeed(source,await json(ENDPOINTS[source],source==='weibo'?{Referer:'https://weibo.com/'}:{})));
    const label=source==='weibo'?'微博':'头条';
    return {items:entry.value||[{title:`${label}暂时无法获取，请稍后重试`}],status:entry.value?`${entry.stale?'旧缓存':'更新'} ${stamp(entry.at,settings.timezone)}`:'获取失败 · 暂无缓存',source,stale:entry.stale,error:entry.error,at:entry.at};
  }
  async function weather(settings) {
    if(!settings.weatherLive)return {};
    const key=`weather:${settings.latitude},${settings.longitude},${settings.timezone}`;
    const entry=await cached(key,async()=>{
      const params=new URLSearchParams({latitude:settings.latitude,longitude:settings.longitude,timezone:settings.timezone,current:'temperature_2m,relative_humidity_2m,weather_code',daily:'weather_code,temperature_2m_max,temperature_2m_min',forecast_days:'7'});
      const data=await json(`${ENDPOINTS.weather}?${params}`),c=data.current,d=data.daily;
      if(!Number.isFinite(c?.temperature_2m)||!Array.isArray(d?.time)||d.time.length<2)throw Error('天气数据格式无效');
      const forecast=d.time.map((date,i)=>({date,condition:condition(d.weather_code[i]),high:Math.round(d.temperature_2m_max[i]),low:Math.round(d.temperature_2m_min[i])}));
      return {temperature:Math.round(c.temperature_2m),humidity:c.relative_humidity_2m,condition:condition(c.weather_code),high:forecast[0].high,low:forecast[0].low,tomorrowHigh:forecast[1].high,tomorrowLow:forecast[1].low,tomorrowCondition:forecast[1].condition,forecast};
    });
    if(!entry.value)return {temperature:'--',humidity:'--',high:'--',low:'--',tomorrowHigh:'--',tomorrowLow:'--',tomorrowCondition:'--',condition:'暂无',weatherSource:'天气获取失败',weatherFlag:'失败',error:entry.error};
    return {...entry.value,weatherSource:`${entry.stale?'旧缓存':'Open-Meteo'} · ${stamp(entry.at,settings.timezone)}`,weatherFlag:entry.stale?'旧缓存':'',at:entry.at,error:entry.error};
  }
  async function cities(query) {
    const params=new URLSearchParams({name:query,count:'10',language:'zh',format:'json'});
    const data=await json(`${ENDPOINTS.geocoding}?${params}`);
    return (data.results||[]).map(c=>({id:c.id,name:c.name,latitude:c.latitude,longitude:c.longitude,timezone:c.timezone||'Asia/Shanghai',location:[c.admin1,c.admin2,c.country].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' · ')}));
  }
  function status() {return Object.fromEntries(Object.entries(cache).filter(([k])=>k==='weibo'||k==='toutiao').map(([k,v])=>[k,{at:v.at,count:v.value?.length||0}]));}
  return {feed,weather,cities,status};
}
module.exports = {createDataSources,normalizeFeed,ENDPOINTS,condition};
