// Native textarea handles input, IME and undo; the canvas shares server text layout.
function bindTextEditor(element, changed) {
  const root = document.querySelector('#text-editor');
  if (!root) return null;
  const canvas = root.querySelector('canvas'), input = root.querySelector('textarea');
  const viewport = root.parentElement, hint = document.querySelector('#text-layout-hint');
  input.value = element.text;
  let layout, scaleX = 1, scaleY = 1, anchor = 0, selecting = false, authoritative=null, signature='',timer,request=0;
  let beforeEdit=null, composition=null;
  const undo=[], redo=[];
  const snapshot=()=>({text:element.text,styles:structuredClone(element.styles||[]),height:element.height,start:input.selectionStart,end:input.selectionEnd});
  function remember(value){undo.push(value);if(undo.length>100)undo.shift();redo.length=0;}
  function history(backward){
    const source=backward?undo:redo,target=backward?redo:undo;if(!source.length)return;
    target.push(snapshot());const value=source.pop();
    Object.assign(element,{text:value.text,styles:value.styles,height:value.height});input.value=value.text;
    input.setSelectionRange(value.start,value.end);syncHeight();paint();changed();
  }
  function syncHeight(){document.querySelector('[data-prop="height"]').value=element.height;}
  function revealCaret(){
    const caret=MojianText.caret(layout,input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd);
    const y=caret.y*scaleY,bottom=(caret.y+layout.lineHeight)*scaleY;
    if(bottom>viewport.scrollTop+viewport.clientHeight-16)viewport.scrollTop=bottom-viewport.clientHeight+16;
    if(y<viewport.scrollTop)viewport.scrollTop=y;
  }
  function applyFormat(key){
    const {selectionStart:start,selectionEnd:end}=input;
    if(start===end)return;
    remember(snapshot());MojianText.formatSelection(element,start,end,key);
    input.focus({preventScroll:true});input.setSelectionRange(start,end);paint();changed();
  }
  function paint() {
    const key=JSON.stringify(element);
    if(key!==signature){
      signature=key;authoritative=null;clearTimeout(timer);const version=++request;
      timer=setTimeout(async()=>{
        try{const r=await fetch('/api/text-layout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({element})});
          if(!r.ok)return;const value=await r.json();if(version===request&&root.isConnected){authoritative=value;paint();}
        }catch{/* 本地即时排版仍可编辑，下次输入会重试。 */}
      },100);
    }
    const stage = document.querySelector('#stage');
    scaleX = stage.clientWidth / draft.width; scaleY = stage.clientHeight / draft.height;
    const width = Math.max(1, element.width * scaleX), height = Math.max(1, element.height * scaleY);
    root.style.width = `${width}px`; root.style.height = `${height}px`;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio * scaleX, ratio * scaleY);
    ctx.fillStyle = draft.background; ctx.fillRect(0, 0, element.width, element.height);
    layout = authoritative || MojianText.layout(ctx, element);
    if (document.activeElement === input) {
      const from = input.selectionStart, to = input.selectionEnd;
      ctx.fillStyle = '#bcd6ef';
      for (const line of layout.lines) {
        if (to > line.start && from <= line.end) {
          const a = line.stops.find(s => s.index >= Math.max(from,line.start)) || line.stops.at(-1);
          const b = line.stops.find(s => s.index >= Math.min(to,line.end)) || line.stops.at(-1);
          ctx.fillRect(a.x,line.y,Math.max(2,b.x-a.x),layout.lineHeight);
        }
      }
    }
    MojianText.draw(ctx, element, element.text, layout);
    const cursor = MojianText.caret(layout, input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd);
    if (document.activeElement === input && input.selectionStart === input.selectionEnd) {
      ctx.fillStyle = '#436f46'; ctx.fillRect(cursor.x,cursor.y,1/scaleX,layout.size*1.2);
    }
    // Keep the IME candidate window close to the drawn caret.
    input.style.left = `${Math.min(width-1, Math.max(0,cursor.x*scaleX))}px`;
    input.style.top = `${Math.min(height-1, Math.max(0,cursor.y*scaleY))}px`;
    hint.textContent = `${element.width} × ${element.height} · ${element.size}px · ${layout.lines.length} 行` +
      (layout.height > element.height ? ' · 文字超出高度，可拖大元素或点击「适应高度」' : '') +
      (element.text.includes('{{') ? ' · 变量在画布中替换为实际内容' : '');
    document.querySelectorAll('[data-text-toggle]').forEach(button=>{
      const key=button.dataset.textToggle,from=input.selectionStart,to=input.selectionEnd;
      button.disabled=from===to;button.title=from===to?'请先选中文字':button.getAttribute('aria-label');
      let count=0;for(let i=from;i<to;i++)if(MojianText.styleAt(element,i)[key])count++;
      button.setAttribute('aria-pressed',count&&count<to-from?'mixed':String(to>from&&count===to-from));
    });
  }
  input.addEventListener('compositionstart',()=>{composition=snapshot();});
  input.addEventListener('compositionend',()=>{if(composition)remember(composition);composition=null;});
  input.addEventListener('beforeinput',event=>{
    if(event.inputType==='historyUndo'||event.inputType==='historyRedo') {event.preventDefault();history(event.inputType==='historyUndo');return;}
    beforeEdit=snapshot();
  });
  input.addEventListener('input', () => {
    const old=element.text,value=input.value;
    if(old===value)return;
    const saved=beforeEdit||snapshot();
    let from=saved.start,to=saved.end,insertedLength=value.length-(old.length-(to-from));
    // Selection bounds disambiguate edits within repeated letters; deletion and
    // IME updates can extend past those bounds, so fall back to a text diff.
    if(insertedLength<0 || old.slice(0,from)!==value.slice(0,from) || old.slice(to)!==value.slice(from+insertedLength)) {
      from=0;while(from<old.length&&from<value.length&&old[from]===value[from])from++;
      to=old.length;let newEnd=value.length;
      while(to>from&&newEnd>from&&old[to-1]===value[newEnd-1]){to--;newEnd--;}
      insertedLength=newEnd-from;
    }
    if(!composition)remember(saved);
    MojianText.replaceText(element,from,to,value.slice(from,from+insertedLength));beforeEdit=null;
    paint();
    // Enter and wrapping must reveal the new line in both editor and preview.
    if(layout.height>element.height){element.height=Math.min(3200,Math.ceil(layout.height));syncHeight();paint();}
    revealCaret();changed();
  });
  // The native input is hidden, so vertical navigation must follow visible lines.
  input.addEventListener('keydown', event => {
    if(!event.isComposing&&(event.ctrlKey||event.metaKey)){
      const key=event.key.toLowerCase();
      if(key==='z'||key==='y'){event.preventDefault();history(key==='z'&&!event.shiftKey);return;}
      if(['b','i','u'].includes(key)){event.preventDefault();applyFormat({b:'bold',i:'italic',u:'underline'}[key]);return;}
    }
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const backward=input.selectionDirection==='backward';
    const index=backward?input.selectionStart:input.selectionEnd;
    const cursor=MojianText.caret(layout,index);
    const next=MojianText.hit(layout,cursor.x,cursor.y+(event.key==='ArrowUp'?-1:1)*layout.lineHeight);
    const fixed=event.shiftKey?(backward?input.selectionEnd:input.selectionStart):next;
    input.setSelectionRange(Math.min(fixed,next),Math.max(fixed,next),next<fixed?'backward':'forward');paint();revealCaret();
  });
  for (const event of ['select','keyup','focus','blur','compositionend']) input.addEventListener(event, paint);
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault(); input.focus({ preventScroll:true });
    const rect = canvas.getBoundingClientRect();
    const index = MojianText.hit(layout,(event.clientX-rect.left)/scaleX,(event.clientY-rect.top)/scaleY);
    anchor = event.shiftKey ? input.selectionStart : index;
    input.setSelectionRange(Math.min(anchor,index),Math.max(anchor,index));
    selecting = true; canvas.setPointerCapture(event.pointerId); paint();
  });
  canvas.addEventListener('pointermove', event => {
    if (!selecting) return;
    const rect = canvas.getBoundingClientRect(), index=MojianText.hit(layout,(event.clientX-rect.left)/scaleX,(event.clientY-rect.top)/scaleY);
    input.setSelectionRange(Math.min(anchor,index),Math.max(anchor,index),index<anchor?'backward':'forward'); paint();
  });
  canvas.addEventListener('pointerup', () => { selecting=false; });
  canvas.addEventListener('pointercancel', () => { selecting=false; });
  document.querySelectorAll('[data-text-toggle]').forEach(button => {
    button.addEventListener('pointerdown',event=>event.preventDefault());
    button.addEventListener('click',()=>applyFormat(button.dataset.textToggle));
  });
  document.querySelector('#fit-text-height').addEventListener('click', () => {
    element.height = Math.min(3200,Math.ceil(layout.height));
    document.querySelector('[data-prop="height"]').value=element.height; paint(); changed();
  });
  const observer=new ResizeObserver(paint); observer.observe(document.querySelector('#stage'));
  paint();
  document.fonts.ready.then(() => { if (root.isConnected) paint(); });
  return { paint, destroy:()=>{observer.disconnect();clearTimeout(timer);request++;} };
}

// Cropping stores normalized source coordinates, preserving the original image.
async function cropImage(src, element = null) {
  const image = new Image(); image.src=src; await image.decode();
  if (image.width*image.height > 40e6) throw Error('图片像素过大，请选择 4000 万像素以内的图片');
  const dialog=document.querySelector('#image-crop');
  const canvas=dialog.querySelector('canvas'), ctx=canvas.getContext('2d');
  const zoom=dialog.querySelector('#crop-zoom'), ratio=dialog.querySelector('#crop-ratio');
  const initial=element?.crop;
  const originalRatio=image.width/image.height;
  const targetRatio=element?element.width/element.height:originalRatio;
  ratio.innerHTML=`<option value="${targetRatio}">${element?'当前元素比例':'原图比例'}</option><option value="1">1 : 1</option><option value="1.3333333333333333">4 : 3</option><option value="1.7777777777777777">16 : 9</option><option value="${draft.width/draft.height}">画布比例</option>`;
  let center={x:initial?initial.x+initial.width/2:.5,y:initial?initial.y+initial.height/2:.5}, factor=1, box, scale, drag;
  function geometry() {
    const r=Number(ratio.value), width=Math.min(500,310*r),height=width/r;
    box={x:(600-width)/2,y:(380-height)/2,width,height};
    scale=Math.max(width/image.width,height/image.height)*factor;
    const halfX=width/(2*scale*image.width),halfY=height/(2*scale*image.height);
    center.x=Math.max(halfX,Math.min(1-halfX,center.x));center.y=Math.max(halfY,Math.min(1-halfY,center.y));
  }
  function draw() {
    geometry();ctx.clearRect(0,0,600,380);ctx.fillStyle='#e9ede4';ctx.fillRect(0,0,600,380);
    ctx.drawImage(image,300-center.x*image.width*scale,190-center.y*image.height*scale,image.width*scale,image.height*scale);
    ctx.fillStyle='#14231b99';ctx.beginPath();ctx.rect(0,0,600,380);ctx.rect(box.x,box.y,box.width,box.height);ctx.fill('evenodd');
    ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.strokeRect(box.x,box.y,box.width,box.height);
    ctx.lineWidth=.7;
    for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(box.x+box.width*i/3,box.y);ctx.lineTo(box.x+box.width*i/3,box.y+box.height);ctx.moveTo(box.x,box.y+box.height*i/3);ctx.lineTo(box.x+box.width,box.y+box.height*i/3);ctx.stroke();}
    zoom.value=String(factor);dialog.querySelector('#crop-zoom-label').textContent=`${Math.round(factor*100)}%`;
  }
  geometry();
  if(initial){factor=Math.max(1,Math.min(10,box.width/(initial.width*image.width*scale)));}
  function setZoom(value){factor=Math.max(1,Math.min(10,value));draw();}
  const controller=new AbortController(), options={signal:controller.signal};
  zoom.addEventListener('input',()=>setZoom(Number(zoom.value)),options);
  ratio.addEventListener('change',()=>{factor=1;draw();},options);
  dialog.querySelector('#crop-zoom-out').addEventListener('click',()=>setZoom(factor/1.15),options);
  dialog.querySelector('#crop-zoom-in').addEventListener('click',()=>setZoom(factor*1.15),options);
  dialog.querySelector('#crop-reset').addEventListener('click',()=>{center={x:.5,y:.5};factor=1;draw();},options);
  const point=e=>{const b=canvas.getBoundingClientRect();return {x:(e.clientX-b.left)*600/b.width,y:(e.clientY-b.top)*380/b.height};};
  canvas.addEventListener('pointerdown',e=>{e.preventDefault();drag={...point(e),cx:center.x,cy:center.y};canvas.setPointerCapture(e.pointerId);},options);
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);center={x:drag.cx-(p.x-drag.x)/(image.width*scale),y:drag.cy-(p.y-drag.y)/(image.height*scale)};draw();},options);
  for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>{drag=null;},options);
  canvas.addEventListener('wheel',e=>{e.preventDefault();setZoom(factor*Math.exp(-e.deltaY*.002));},{...options,passive:false});
  return new Promise(resolve=>{
    let result=null;
    dialog.querySelector('#crop-apply').addEventListener('click',()=>{
      geometry();const width=box.width/(image.width*scale),height=box.height/(image.height*scale);
      result={src,crop:{x:Math.max(0,center.x-width/2),y:Math.max(0,center.y-height/2),width,height},ratio:Number(ratio.value)};
      dialog.close();
    },options);
    dialog.querySelector('#crop-cancel').addEventListener('click',()=>dialog.close(),options);
    dialog.addEventListener('close',()=>{controller.abort();resolve(result);},{once:true});
    dialog.showModal();draw();
  });
}
