const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {createCanvas}=require('canvas');
const Memo=require('../public/memo-editor');
const Text=require('../public/text-layout');
const {render,encodeBMP}=require('../lib/render');
const {defaultSettings}=require('../lib/themes');
const {createApp}=require('../server');

function drawMemo(el){
  const canvas=createCanvas(el.width,el.height),ctx=canvas.getContext('2d');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,el.width,el.height);Text.draw(ctx,el);
  return encodeBMP(ctx.getImageData(0,0,el.width,el.height).data,el.width,el.height);
}

test('待办续行悬挂对齐，横线只分隔事项且不增加行距',()=>{
  const ctx=createCanvas(1,1).getContext('2d');
  const memoItems=[{text:'第一项文字较长需要自动换行继续显示\n手动换行\n\n空行后的内容',todo:true,done:true},{text:'下一条事项',todo:true,done:false}];
  for(const align of ['left','center','right']){
    const el=Text.resolveVariables({text:'{{memo}}',memoItems,memoSeparators:true,width:150,height:400,size:20,lineHeight:1.5,align},{});
    const result=Text.layout(ctx,el),first=result.lines[0];
    const textX=first.x+first.glyphs.find(g=>g.index===2).x;
    const boundary=el.memoRanges[1].start;
    const continuation=result.lines.filter(line=>line.start>0&&line.start<boundary&&line.glyphs.length);
    assert.ok(continuation.length>=3);
    for(const line of continuation)assert.equal(line.x+line.glyphs[0].x,textX);
    assert.equal(result.value,'☑ '+memoItems[0].text+'\n□ '+memoItems[1].text);
    assert.equal(result.separators.length,1);
    const last=result.lines.filter(line=>line.start<boundary).at(-1);
    const next=result.lines.find(line=>line.start===boundary);
    assert.equal(next.y-last.y,30);
    assert.ok(result.separators[0].y>last.y+20&&result.separators[0].y<next.y);
    for(const memoSeparators of [undefined,false]){
      const noSeparators=Text.layout(ctx,{...el,memoSeparators});
      assert.equal(noSeparators.separators.length,0);
      assert.deepEqual(result.lines,noSeparators.lines);assert.equal(result.height,noSeparators.height);
    }
    const canvas=createCanvas(el.width,el.height),context=canvas.getContext('2d');
    context.fillStyle='#ffffff';context.fillRect(0,0,el.width,el.height);Text.draw(context,{...el,color:'#000000'});
    const second=result.lines[1],indentPixel=context.getImageData(1,Math.floor(second.y+20*.56),1,1).data;
    assert.deepEqual([...indentPixel],[255,255,255,255]);
    assert.ok(context.getImageData(el.width-2,Math.floor(result.separators[0].y),1,1).data[0]<255);
  }
  const repeated=Text.resolveVariables({text:'{{city}}\n{{memo}}\n结尾\n{{memo}}',memoSeparators:true,width:150,height:400,size:20},{city:'北京市',memo:'□ 第一项\n□ 第二项'});
  for(const item of repeated.memoRanges)assert.equal(repeated.text.slice(item.start,item.contentStart),'□ ');
  assert.equal(Text.layout(ctx,repeated).separators.length,2);
});

test('多行事项仅按完成状态绘制整条删除线，空事项回退全局内容',async()=>{
  const memoItems=[{text:'第一行😀\r\n\r\n第二行',todo:true,done:true},{text:'下一项\n☑ 这里是事项内文字',todo:true,done:false}];
  const el={id:'m',type:'text',text:'{{memo}}',memoItems,x:0,y:0,width:240,height:280,color:'#111111',size:20};
  const text='☑ 第一行😀\n\n第二行\n□ 下一项\n☑ 这里是事项内文字';
  const resolved=Text.resolveVariables(el,{memo:'全局事项'});
  assert.equal(resolved.text,text);
  const end=text.indexOf('\n□');
  for(let i=0;i<text.length;i++)assert.equal(Text.styleAt(resolved,i).strike,i>=2&&i<end);
  const theme={width:240,height:280,background:'#ffffff',elements:[{...el,type:'memo'}]};
  const settings={...defaultSettings,width:240,height:280,mode:'original'};
  const expected={...el,text,memoItems:undefined,memoRanges:resolved.memoRanges};Text.formatSelection(expected,2,end,'strike');
  assert.deepEqual((await render(theme,settings)).bmp,drawMemo(expected));
  for(const items of [[],[{text:' \n\t',todo:true,done:true}]]){
    const fallback=Text.resolveVariables({...el,memo:'过期独立内容',memoItems:items},{memo:'☑ 全局事项'});
    assert.equal(fallback.text,'☑ 全局事项');assert.equal(Text.styleAt(fallback,2).strike,true);
  }
});

test('多行待办保存和重启后保持事项边界，非法内容不会覆盖已保存主题',async t=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mojian-multiline-memo-'));
  let server;
  t.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});});
  const start=async()=>{server=createApp({dataDir}).listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;};
  let base=await start();
  const request=(url,method,body)=>fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const memoItems=[{text:'买水果\r\n苹果和香蕉',todo:true,done:true},{text:'读书\n□ 第二章',todo:true,done:false}];
  const el={id:'m',type:'memo',x:0,y:0,width:240,height:280,color:'#111111',size:20,memoItems,memoSeparators:true};
  const response=await request('/api/themes','POST',{name:'多行待办',width:240,height:280,background:'#ffffff',elements:[el]});
  assert.equal(response.status,201);const saved=await response.json();
  const expected=[{...memoItems[0],text:'买水果\n苹果和香蕉'},memoItems[1]];
  assert.deepEqual(saved.elements[0].memoItems,expected);
  assert.equal(saved.elements[0].memo,Memo.serialize(expected));
  await new Promise(resolve=>server.close(resolve));base=await start();
  const state=await (await fetch(base+'/api/state')).json();
  assert.deepEqual(state.customThemes.find(theme=>theme.id===saved.id).elements[0].memoItems,expected);
  assert.equal(state.customThemes.find(theme=>theme.id===saved.id).elements[0].memoSeparators,true);
  assert.equal((await request(`/api/themes/${saved.id}`,'PUT',{...saved,elements:[{...el,memoSeparators:'true'}]})).status,400);
  assert.equal((await request('/api/preview','POST',{theme:saved})).status,200);
  for(const items of [null,{},[{}],[{text:'测试',todo:true,done:'true'}],Array(501).fill(expected[0]),[{...expected[0],text:'字'.repeat(5001)}]]){
    assert.equal((await request(`/api/themes/${saved.id}`,'PUT',{...saved,elements:[{...el,memoItems:items}]})).status,400);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'state.json'))).customThemes[0].elements[0].memoItems,expected);
  const cleared=await request(`/api/themes/${saved.id}`,'PUT',{...saved,elements:[{...el,memo:'旧事项',memoItems:[],memoSeparators:false}]});
  assert.equal(cleared.status,200);const clearedTheme=await cleared.json();
  assert.equal(clearedTheme.elements[0].memo,'');assert.equal(clearedTheme.elements[0].memoSeparators,false);
});

test('主题事项编辑器保留回车和粘贴换行，添加按钮新增独立待办',t=>{
  // 最小事件环境只验证编辑器的事项边界，原生回车插入由浏览器完成。
  class Element {
    constructor(){this.children=[];this.handlers={};this.style={};this.classList={toggle(){}};this.scrollHeight=40;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    addEventListener(name,handler){this.handlers[name]=handler;}
    setAttribute(){}
    querySelector(){return null;}
  }
  const previous=global.document;
  global.document={createElement:()=>new Element()};
  t.after(()=>{if(previous===undefined)delete global.document;else global.document=previous;});
  const container=new Element(),field={value:'□ 事项'},changes=[];
  Memo.mount(container,field,items=>changes.push(items),{multiline:true});
  const [toolbar,list]=container.children,input=list.children[0].children[1];
  let prevented=false;
  input.handlers.keydown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
  input.value='事项\n第二行\n☑ 粘贴内容';input.handlers.input();
  assert.equal(list.children.length,1);
  assert.deepEqual(changes.at(-1),[{text:input.value,todo:true,done:false}]);
  toolbar.children[0].handlers.click();
  assert.equal(changes.at(-1).length,2);assert.equal(changes.at(-1)[1].text,'');
  const reopened=new Element();Memo.mount(reopened,field,()=>{},{multiline:true,items:changes.at(-1)});
  assert.equal(reopened.children[1].children.length,2);
  assert.equal(reopened.children[1].children[0].children[1].value,input.value);
  const globalContainer=new Element(),globalField={value:'□ 原事项'};let globalItems;
  Memo.mount(globalContainer,globalField,items=>{globalItems=items;});
  const globalInput=globalContainer.children[1].children[0].children[1];
  globalInput.selectionStart=globalInput.selectionEnd=3;
  globalInput.handlers.keydown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(globalItems.length,2);
});

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
  assert.equal(saved.elements[0].memoSeparators,false);
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
  const expected={...element,text:memo,memoRanges:Text.resolveVariables(element,{memo}).memoRanges};Text.formatSelection(expected,2,memo.indexOf('\n'),'strike');
  assert.deepEqual(actual.bmp,drawMemo(expected));
  assert.notDeepEqual(actual.bmp,drawMemo({...expected,styles:undefined}));
  const undone=memo.replace('☑','□');
  assert.deepEqual((await render(theme,{...settings,memo:undone})).bmp,drawMemo({...expected,text:undone,styles:undefined}));
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
