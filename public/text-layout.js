// 浏览器文字编辑区和服务端图片共用排版，避免两套换行规则。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MojianText = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const family = '"Mojian Text", sans-serif';
  const isCheckbox = char => ['□','☐','☑'].includes(char);
  const formatKeys = ['bold','italic','underline','strike'];
  const baseStyle = el => Object.fromEntries(formatKeys.map(key => [key, Boolean(el[key])]));
  const sameStyle = (a,b) => formatKeys.every(key => a[key] === b[key]);
  function styleAt(el, index) {
    const span = (el.styles || []).find(s => index >= s.start && index < s.end);
    return { ...baseStyle(el), ...span };
  }
  function stylesPerCharacter(el) {
    const result = Array.from({length:el.text.length}, () => baseStyle(el));
    for (const span of el.styles || []) for (let i=span.start; i<span.end; i++) result[i]=baseStyle(span);
    return result;
  }
  function packStyles(styles) {
    const spans=[];
    styles.forEach((style,index) => {
      const last=spans.at(-1);
      if(last && sameStyle(last,style)) last.end=index+1;
      else spans.push({start:index,end:index+1,...baseStyle(style)});
    });
    return spans;
  }
  function formatSelection(el, start, end, key) {
    if(start===end || !formatKeys.includes(key)) return false;
    const styles=stylesPerCharacter(el), enabled=!styles.slice(start,end).every(s=>s[key]);
    for(let i=start;i<end;i++) styles[i]={...styles[i],[key]:enabled};
    el.styles=packStyles(styles);return true;
  }
  function replaceText(el, start, end, inserted) {
    const styles=stylesPerCharacter(el);
    const inherited=baseStyle(styleAt(el,start===end?Math.max(0,start-1):start));
    styles.splice(start,end-start,...Array.from({length:inserted.length},()=>inherited));
    el.text=el.text.slice(0,start)+inserted+el.text.slice(end);el.styles=packStyles(styles);
  }
  function resolveVariables(el, vars) {
    let completedRanges=null,memoRanges=null;
    if(Array.isArray(el.memoItems)) {
      // 结构化事项可区分事项内部换行和下一条事项，完成状态覆盖整条内容。
      if(el.memoItems.some(item=>item.text.trim())) {
        let offset=0;completedRanges=[];memoRanges=[];
        const memo=el.memoItems.map(item=>{
          const prefix=item.todo?(item.done?'☑ ':'□ '):'',text=item.text.replace(/\r\n?/g,'\n');
          memoRanges.push({start:offset,contentStart:offset+prefix.length,end:offset+prefix.length+text.length,todo:item.todo});
          if(item.todo&&item.done)completedRanges.push([offset+prefix.length,offset+prefix.length+text.length]);
          offset+=prefix.length+text.length+1;
          return prefix+text;
        }).join('\n');
        vars={...vars,memo};
      }
    }
    // 空白事项或仅有方框视为未填写，继续使用全局备忘录。
    else if(typeof el.memo==='string' && el.memo.split(/\r?\n/).some(line=>line.replace(/^[ \t]*[□☐☑]?[ \t]*/, '').trim())) vars={...vars,memo:el.memo};
    const result={...el,styles:el.styles?.map(s=>({...s})),memoRanges:[]};
    const matches=[...el.text.matchAll(/\{\{(\w+)\}\}/g)];
    for(const match of matches.reverse()) if(vars[match[1]]!==undefined) {
      const value=String(vars[match[1]]).replace(/\r\n?/g,'\n');
      const delta=value.length-match[0].length;
      for(const range of result.memoRanges)for(const key of ['start','contentStart','end'])range[key]+=delta;
      replaceText(result,match.index,match.index+match[0].length,value);
      // 完成状态随备忘录变量展开，仅给事项文字添加删除线，保留其他格式。
      if(match[1]==='memo'){
        let offset=0;
        const items=memoRanges||value.split('\n').map(line=>{
          const prefix=line.match(/^[ \t]*[□☐☑][ \t]*/)?.[0]||'';
          const item={start:offset,contentStart:offset+prefix.length,end:offset+line.length,todo:Boolean(prefix)};
          offset+=line.length+1;return item;
        });
        result.memoRanges.unshift(...items.map((item,index)=>({...item,start:match.index+item.start,contentStart:match.index+item.contentStart,end:match.index+item.end,separator:item.todo&&index<items.length-1})));
        const styles=stylesPerCharacter(result);
        const ranges=completedRanges||[...value.matchAll(/^([ \t]*☑[ \t]*)([^\n]*)/gm)].map(line=>[line.index+line[1].length,line.index+line[0].length]);
        for(const [from,to] of ranges){
          const start=match.index+from,end=match.index+to;
          for(let i=start;i<end;i++)styles[i]={...styles[i],strike:true};
        }
        result.styles=packStyles(styles);
      }
    }
    return result;
  }
  function font(ctx, el, size = el.size) {
    // Explicit skew in draw() keeps Chinese italics consistent with node-canvas.
    ctx.font = `${el.bold ? 'bold ' : ''}${size}px ${family}`;
  }
  function layout(ctx, el, value = el.text) {
    value = String(value).replace(/\r\n?/g, '\n');
    let size = el.size;
    const styles=stylesPerCharacter({...el,text:value});
    const measure=(char,index)=>{font(ctx,styles[index]||el,size);return isCheckbox(char)?size*.9:ctx.measureText(char).width;};
    if (el.fit && !value.includes('\n')) {
      const width=()=>{let index=0,total=0;for(const char of value){total+=measure(char,index);index+=char.length;}return total;};
      while (size > 6 && width() > el.width) size--;
    }
    const lineHeight = size * (el.lineHeight || 1.3), lines = [];
    let text = '', start = 0, offset = 0, glyphs=[], advance=0;
    const ranges=el.memoRanges||[];
    const itemAt=index=>ranges.find(item=>index>=item.start&&index<=item.end);
    const indentAt=index=>{
      const item=itemAt(index);
      if(!item?.todo||index<=item.start)return 0;
      let width=0,i=item.start;
      for(const char of value.slice(item.start,item.contentStart)){width+=measure(char,i);i+=char.length;}
      // 缩进使用坐标，不向内容插入空格，也不为缩进绘制删除线。
      return Math.min(width,Math.max(0,el.width-size));
    };
    const push = () => {
      const width = advance + (glyphs.at(-1)?.style.italic ? size*.2 : 0);
      const x = el.align === 'center' ? (el.width - width) / 2 : el.align === 'right' ? el.width - width : 0;
      const stops = [{ index: start, x }];
      for (const glyph of glyphs) stops.push({index:glyph.index+glyph.text.length,x:x+glyph.x+glyph.width});
      lines.push({ text, start, end: start + text.length, x, y: lines.length * lineHeight, width, stops, glyphs });
      text='';glyphs=[];advance=0;
    };
    for (const char of value) {
      if (char === '\n') { push(); offset++; start = offset; advance=indentAt(start);continue; }
      const width=measure(char,offset),style=baseStyle(styles[offset]||el);
      if (text && advance + width + (style.italic?size*.2:0) > el.width) { push(); start = offset;advance=indentAt(start); }
      glyphs.push({text:char,index:offset,x:advance,width,style});advance+=width;
      text += char; offset += char.length;
    }
    push();
    const separators=[];
    for(const item of ranges){
      const itemLines=lines.filter(line=>line.start>=item.start&&line.start<=item.end);
      if(!itemLines.length)continue;
      // 同一事项使用统一的对齐基准，让居中、右对齐时的续行也保留悬挂缩进。
      if(item.todo){
        const width=Math.max(...itemLines.map(line=>line.width));
        const x=el.align==='center'?(el.width-width)/2:el.align==='right'?el.width-width:0;
        for(const line of itemLines){const delta=x-line.x;line.x=x;for(const stop of line.stops)stop.x+=delta;}
      }
      if(item.separator&&el.memoSeparators===true){
        const last=itemLines.at(-1);
        // 横线画在已有行距内，不新增行或改变后续事项的位置。
        separators.push({y:last.y+(size*1.08+lineHeight)/2});
      }
    }
    return { lines, size, lineHeight, height: lines.length * lineHeight, value, separators };
  }
  function draw(ctx, el, value = el.text, measured = null) {
    const result = measured || layout(ctx, el, value);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, el.width, el.height); ctx.clip();
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = el.color;
    for (const line of result.lines) {
      for(const glyph of line.glyphs) {
        font(ctx,glyph.style,result.size);
        const width=ctx.measureText(glyph.text).width,x=line.x+glyph.x;
        ctx.save();ctx.translate(x,line.y+result.size*.88);
        if(glyph.style.italic)ctx.transform(1,0,-.22,1,0,0);
        if(isCheckbox(glyph.text)){
          // 方框与勾选标志统一绘制，避免字体回退导致大小不一致。
          const side=result.size*.7,top=-result.size*.74;
          ctx.strokeStyle=el.color;ctx.lineWidth=Math.max(1,result.size/18);
          ctx.strokeRect(1,top,side,side);
          if(glyph.text==='☑'){
            ctx.beginPath();ctx.moveTo(1+side*.18,top+side*.5);ctx.lineTo(1+side*.42,top+side*.75);ctx.lineTo(1+side*.84,top+side*.22);ctx.stroke();
          }
        }else{
          if(width)ctx.scale(glyph.width/width,1);
          ctx.fillText(glyph.text,0,0);
        }
        ctx.restore();
        ctx.strokeStyle = el.color; ctx.lineWidth = Math.max(1, result.size / 18);
        for (const y of [glyph.style.underline ? line.y + result.size * 1.02 : null, glyph.style.strike ? line.y + result.size * .56 : null]) {
          if (y !== null && glyph.width) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+glyph.width, y); ctx.stroke(); }
        }
      }
    }
    ctx.strokeStyle=el.color;ctx.lineWidth=1;
    for(const separator of result.separators||[]){
      ctx.beginPath();ctx.moveTo(0,separator.y);ctx.lineTo(el.width,separator.y);ctx.stroke();
    }
    ctx.restore(); return result;
  }
  function caret(result, index) {
    const line = [...result.lines].reverse().find(l => index >= l.start) || result.lines[0];
    return { x: (line.stops.find(s => s.index >= index) || line.stops.at(-1)).x, y: line.y };
  }
  function hit(result, x, y) {
    const line = result.lines[Math.max(0, Math.min(result.lines.length - 1, Math.floor(y / result.lineHeight)))];
    return line.stops.reduce((best, stop) => Math.abs(stop.x - x) < Math.abs(best.x - x) ? stop : best).index;
  }
  return { family, font, layout, draw, caret, hit, formatKeys, styleAt, formatSelection, replaceText, resolveVariables };
});
