const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { once } = require('node:events');
const { createCanvas } = require('canvas');
const { createApp, validateTheme } = require('../server');
const { render } = require('../lib/render');
const { defaultSettings } = require('../lib/themes');
const Text = require('../public/text-layout');
const Geometry = require('../public/geometry');
const { condition } = require('../lib/data-sources');
const text = {id:'t',type:'text',x:0,y:0,width:100,height:100,color:'#111111',size:24,lineHeight:1.3,text:'墨间 ABC',bold:false};
const theme = elements => ({name:'编辑器测试',width:100,height:100,background:'#ffffff',elements});

test('shared text layout preserves explicit lines, unicode, wrapping and fit alignment',()=>{
  const ctx=createCanvas(1,1).getContext('2d');
  const value='墨间\n\nABC 123\n😀天气\n';
  const result=Text.layout(ctx,{...text,width:65,text:value});
  assert.equal(result.lines.map(l=>l.text).join(''),value.replace(/\n/g,''));
  assert.equal(result.lines.at(-1).text,'');assert.ok(result.lines.some(l=>l.text===''));
  for(const line of result.lines){assert.ok(line.width<=65.01);assert.equal(value.slice(line.start,line.end),line.text);}
  const fit=Text.layout(ctx,{...text,width:40,fit:true,text:'ABCDEFGHIJK',align:'center'});
  assert.ok(fit.size<24);assert.equal(fit.lines.length,1);
  assert.equal(fit.lines[0].x,(40-fit.lines[0].width)/2);
  const line=result.lines.find(l=>l.text==='墨间');
  assert.equal(Text.hit(result,line.stops[1].x,line.y),line.stops[1].index);
  assert.deepEqual(Text.caret(result,line.stops[1].index),{x:line.stops[1].x,y:line.y});
});

test('text decorations render and survive validation; malformed style/crop data is rejected',async()=>{
  const styled={...text,italic:true,underline:true,strike:true};
  const saved=validateTheme(theme([styled]));
  for(const key of ['italic','underline','strike'])assert.equal(saved.elements[0][key],true);
  const settings={...defaultSettings,width:100,height:100,mode:'original'};
  const plain=(await render(theme([text]),settings)).bmp;
  const decorated=(await render(saved,settings)).bmp;
  assert.notDeepEqual(plain,decorated);
  assert.throws(()=>validateTheme(theme([{...text,underline:'false'}])));
  const src=createCanvas(10,10).toDataURL();
  for(const crop of [{x:-.1,y:0,width:1,height:1},{x:.8,y:0,width:.3,height:1},{x:0,y:0,width:0,height:1},null]){
    assert.throws(()=>validateTheme(theme([{...text,type:'image',src,crop}])));
  }
});

test('saved normalized crop selects expected source pixels in preview and rotated BMP',async()=>{
  const image=createCanvas(200,100),ctx=image.getContext('2d');
  ctx.fillStyle='#ff0000';ctx.fillRect(0,0,100,100);ctx.fillStyle='#000000';ctx.fillRect(100,0,100,100);
  const el={id:'i',type:'image',x:0,y:0,width:100,height:100,color:'#ffffff',src:image.toDataURL(),crop:{x:.5,y:0,width:.5,height:1}};
  const saved=validateTheme(theme([el]));
  for(const rotation of [0,180]){
    const bmp=(await render(saved,{...defaultSettings,width:100,height:100,rotation})).bmp;
    assert.deepEqual([...bmp.subarray(54+50*300+50*3,54+50*300+50*3+3)],[0,0,0]);
  }
  const uncropped=(await render(theme([{...el,crop:undefined}]),{...defaultSettings,width:100,height:100})).bmp;
  assert.deepEqual([...uncropped.subarray(54+50*300+10*3,54+50*300+10*3+3)],[0,0,255]);
});

test('all resize handles anchor opposite edges, preserve ratio and respect rotation mapping',()=>{
  const start={x:30,y:40,width:100,height:80};
  for(const handle of ['nw','n','ne','e','se','s','sw','w']){
    const r=Geometry.resize(start,handle,20,10);
    if(handle.includes('w'))assert.equal(r.x+r.width,start.x+start.width);else assert.equal(r.x,start.x);
    if(handle.includes('n'))assert.equal(r.y+r.height,start.y+start.height);else assert.equal(r.y,start.y);
    assert.ok(r.width>0&&r.height>0);
    assert.equal(Geometry.flipHandle(Geometry.flipHandle(handle)),handle);
  }
  assert.deepEqual(Geometry.resize(start,'se',50,40,true),{x:30,y:40,width:150,height:120});
  assert.equal(Geometry.resize(start,'w',1000,0).width,1);
  assert.equal(Geometry.resize(start,'se',9999,9999).width,3200);
  assert.equal(Geometry.flipHandle('nw'),'se');
});

test('restored weather drawings distinguish sun, rain, snow and unknown conditions',async()=>{
  const weather=theme([{id:'w',type:'weather-icon',x:0,y:0,width:100,height:100,color:'#111111'}]);
  const buffers=await Promise.all(['晴','雨','雪','暂无'].map(condition=>render(weather,{...defaultSettings,width:100,height:100},{condition})));
  for(let i=1;i<buffers.length;i++)assert.notDeepEqual(buffers[i].bmp,buffers[i-1].bmp);
  assert.equal(condition(999),'暂无');
});

test('selection styles preserve unselected text, overlapping formats, edits and variable offsets',()=>{
  const el={...text,text:'普通斜体结尾',bold:true};
  Text.formatSelection(el,2,4,'italic');Text.formatSelection(el,3,5,'underline');
  assert.equal(Text.styleAt(el,0).italic,false);assert.equal(Text.styleAt(el,2).italic,true);
  assert.equal(Text.styleAt(el,3).underline,true);assert.equal(Text.styleAt(el,4).italic,false);
  Text.formatSelection(el,2,4,'bold');assert.equal(Text.styleAt(el,2).bold,false);assert.equal(Text.styleAt(el,0).bold,true);
  Text.replaceText(el,0,0,'开头\n');assert.equal(Text.styleAt(el,5).italic,true);assert.equal(el.text,'开头\n普通斜体结尾');
  Text.replaceText(el,5,7,'替换');assert.equal(Text.styleAt(el,5).italic,true);assert.equal(Text.styleAt(el,7).underline,true);
  const dynamic={...text,text:'{{city}}尾部'};Text.formatSelection(dynamic,0,8,'italic');Text.formatSelection(dynamic,8,10,'strike');
  const resolved=Text.resolveVariables(dynamic,{city:'北京'});
  assert.equal(resolved.text,'北京尾部');assert.equal(Text.styleAt(resolved,0).italic,true);
  assert.equal(Text.styleAt(resolved,2).italic,false);assert.equal(Text.styleAt(resolved,2).strike,true);
  const saved=validateTheme(theme([el]));assert.deepEqual(saved.elements[0].styles,el.styles);
  for(const styles of [[{start:-1,end:2}],[{start:0,end:9999}],[{start:2,end:1}]])assert.throws(()=>validateTheme(theme([{...el,styles}])));
});

test('Chinese italics visibly skew selected glyphs and leave surrounding glyphs unchanged',()=>{
  const el={...text,width:300,text:'普通文字斜体结尾'};
  const draw=value=>{const c=createCanvas(300,100);Text.draw(c.getContext('2d'),value);return c.getContext('2d');};
  const plain=draw(el);Text.formatSelection(el,4,6,'italic');const italic=draw(el);
  assert.deepEqual(plain.getImageData(0,0,90,100).data,italic.getImageData(0,0,90,100).data);
  assert.notDeepEqual(plain.getImageData(95,0,60,40).data,italic.getImageData(95,0,60,40).data);
  assert.deepEqual(plain.getImageData(170,0,100,100).data,italic.getImageData(170,0,100,100).data);
  const layout=Text.layout(createCanvas(1,1).getContext('2d'),{...el,text:'第一行\n\n第三行\n'});
  assert.deepEqual(layout.lines.map(l=>l.text),['第一行','','第三行','']);
});

test('text layout API matches render layout; crop and formats persist after server restart',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mojian-editor-'));
  const server=createApp({dataDir}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await(await fetch(base+'/api/health')).json()).service,'mojian');
  const element={...text,text:'共享排版\nabc',underline:true,bold:true};
  Text.formatSelection(element,1,3,'italic');Text.formatSelection(element,5,8,'strike');
  const layout=await(await post('/api/text-layout',{element})).json();
  assert.deepEqual(layout,Text.layout(createCanvas(1,1).getContext('2d'),element));
  assert.equal((await post('/api/text-layout',{element:{...element,type:'rect'}})).status,400);
  const source=createCanvas(50,50).toDataURL();
  const image={id:'i',type:'image',x:0,y:0,width:50,height:50,color:'#ffffff',src:source,crop:{x:.2,y:.2,width:.5,height:.5}};
  const response=await post('/api/themes',theme([element,image]));assert.equal(response.status,201);
  const saved=await response.json();
  const restarted=createApp({dataDir}).listen(0,'127.0.0.1');await once(restarted,'listening');
  try{const state=await(await fetch(`http://127.0.0.1:${restarted.address().port}/api/state`)).json();
    const restored=state.customThemes.find(t=>t.id===saved.id);
    assert.equal(restored.elements[0].underline,true);assert.deepEqual(restored.elements[0].styles,element.styles);assert.deepEqual(restored.elements[1].crop,image.crop);assert.equal(restored.elements[1].src,source);
  }finally{await new Promise(r=>restarted.close(r));}
});
