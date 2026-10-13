const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {createCanvas}=require('canvas');
const Memo=require('../public/memo-editor');
const Text=require('../public/text-layout');
const {render}=require('../lib/render');
const {defaultSettings}=require('../lib/themes');
const {createApp}=require('../server');

test('独立备忘录优先于全局内容，空事项回退且不会污染其他元素',async()=>{
  const el={id:'memo',type:'memo',x:0,y:0,width:160,height:280,color:'#111111',size:22,lineHeight:1.5,text:'{{memo}}',memo:'☑ 完成事项\n□ 独立事项'};
  const global={memo:'□ 全局事项'};
  const resolved=Text.resolveVariables(el,global);
  assert.equal(resolved.text,el.memo);
  assert.equal(Text.styleAt(resolved,2).strike,true);
  assert.equal(Text.styleAt(resolved,resolved.text.indexOf('独立')).strike,false);
  assert.equal(global.memo,'□ 全局事项');
  for(const memo of [undefined,'',' \n\t','□ \n☑ \n☐ '])assert.equal(Text.resolveVariables({...el,memo},global).text,global.memo);
  assert.equal(Text.resolveVariables({...el,memo:''},{memo:''}).text,'');
  const theme={width:160,height:280,background:'#ffffff',elements:[el]};
  const settings={...defaultSettings,width:160,height:280,mode:'original',memo:global.memo};
  const bmp=(await render(theme,settings)).bmp;
  assert.deepEqual(bmp,(await render(theme,{...settings,memo:'□ 改过的全局事项'})).bmp);
  assert.deepEqual(bmp,(await render({...theme,elements:[{...el,type:'text',memo:undefined}]},{...settings,memo:el.memo})).bmp);
  assert.deepEqual((await render({...theme,elements:[{...el,memo:''}]},settings)).bmp,(await render({...theme,elements:[{...el,type:'text',memo:undefined}]},settings)).bmp);
});

test('主题事项通过接口保存并在重启后保留，清空和旧文字备忘录兼容',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mojian-theme-memo-'));
  let server;
  t.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});});
  const start=async()=>{server=createApp({dataDir}).listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;};
  let base=await start();
  const request=(url,method,body)=>fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const el={id:'m',type:'memo',x:0,y:0,width:160,height:200,color:'#111111',size:18,memo:'☑ 主题事项'};
  const theme={name:'独立备忘录',width:160,height:200,background:'#ffffff',elements:[el,{...el,id:'legacy',type:'text',text:'{{memo}}',memo:'□ 旧主题事项'}]};
  const response=await request('/api/themes','POST',theme);assert.equal(response.status,201);
  let saved=await response.json();
  await new Promise(resolve=>server.close(resolve));base=await start();
  const state=await (await fetch(base+'/api/state')).json();
  assert.deepEqual(state.customThemes.find(t=>t.id===saved.id).elements.map(e=>e.memo),['☑ 主题事项','□ 旧主题事项']);
  assert.equal((await request('/api/preview','POST',{theme:saved})).status,200);
  const exported=await request('/api/export','POST',{theme:saved});assert.equal(exported.status,200);
  assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0,2).toString(),'BM');
  for(const memo of [null,[],123,'字'.repeat(5001)])assert.equal((await request(`/api/themes/${saved.id}`,'PUT',{...saved,elements:[{...el,memo}]})).status,400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'))).customThemes[0].elements[0].memo,'☑ 主题事项');
  saved.elements[0].memo='';
  assert.equal((await request(`/api/themes/${saved.id}`,'PUT',saved)).status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'))).customThemes[0].elements[0].memo,'');
});

test('旧备忘录兼容普通文字和方框，完成与取消状态可往返保存',()=>{
  const items=Memo.parse('今日事项\r\n□ 阅读\r\n☑ 买水果\r\n☐ 运动\r\n');
  assert.deepEqual(items.map(item=>[item.text,item.todo,item.done]),[['今日事项',false,false],['阅读',true,false],['买水果',true,true],['运动',true,false],['',false,false]]);
  items[1].done=true;items[2].done=false;
  assert.equal(Memo.serialize(items),'今日事项\n☑ 阅读\n□ 买水果\n□ 运动\n');
  assert.deepEqual(Memo.parse(Memo.serialize(items)),items);
  assert.deepEqual(Memo.parse(''),[]);assert.equal(Memo.serialize([]),'');
});

test('备忘录完成删除线只影响完成事项，保留重复变量及相邻文字格式',()=>{
  const el={text:'{{city}}\n{{memo}}\n结尾\n{{memo}}',bold:true,italic:true};
  const memo='☑ 已完成😀事项\n□ 未完成事项\n普通说明';
  const result=Text.resolveVariables(el,{city:'杭州',memo});
  assert.equal(result.text,`杭州\n${memo}\n结尾\n${memo}`);
  for(let i=0;i<result.text.length;i++){
    const completed=[...result.text.matchAll(/已完成😀事项/g)].some(m=>i>=m.index&&i<m.index+m[0].length);
    const style=Text.styleAt(result,i);assert.equal(style.strike,completed);assert.equal(style.bold,true);assert.equal(style.italic,true);
  }
  assert.equal(el.styles,undefined);
});

test('墨水屏渲染为换行后的整条完成事项绘制删除线，取消后恢复',async()=>{
  const memo='☑ 阅读二十分钟并记录今天的收获\n□ 去户外走一走';
  const element={id:'memo',type:'text',x:0,y:0,width:160,height:280,color:'#111111',size:22,lineHeight:1.5,text:'{{memo}}'};
  const theme={width:160,height:280,background:'#ffffff',elements:[element]};
  const settings={...defaultSettings,width:160,height:280,mode:'original',memo};
  const glyphs=Text.layout(createCanvas(1,1).getContext('2d'),{...element,text:'□☑☐'}).lines[0].glyphs;
  assert.equal(glyphs[0].width,glyphs[1].width);assert.equal(glyphs[1].width,glyphs[2].width);
  const actual=await render(theme,settings);
  const expected={...element,text:memo};Text.formatSelection(expected,2,memo.indexOf('\n'),'strike');
  assert.deepEqual(actual.bmp,(await render({...theme,elements:[expected]},settings)).bmp);
  assert.notDeepEqual(actual.bmp,(await render({...theme,elements:[{...element,text:memo}]},settings)).bmp);
  const undone=memo.replace('☑','□');
  assert.deepEqual((await render(theme,{...settings,memo:undone})).bmp,(await render({...theme,elements:[{...element,text:undone}]},settings)).bmp);
});

test('备忘录勾选状态持久化，重启保留且可清空，过长内容不覆盖已保存值',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mojian-memo-'));
  let server;
  t.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});});
  const start=async()=>{server=createApp({dataDir}).listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;};
  let base=await start();
  const save=memo=>fetch(`${base}/api/settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({memo})});
  const memo='☑ 已完成事项\n□ 下一项\n普通文字';
  assert.equal((await save(memo)).status,200);
  await new Promise(resolve=>server.close(resolve));base=await start();
  assert.equal((await (await fetch(`${base}/api/state`)).json()).settings.memo,memo);
  assert.equal((await save('字'.repeat(5001))).status,400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'))).settings.memo,memo);
  assert.equal((await save('')).status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'))).settings.memo,'');
});
