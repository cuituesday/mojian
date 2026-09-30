// 浏览器文字编辑区和服务端图片共用排版，避免两套换行规则。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MojianText = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const family = '"Mojian Text", sans-serif';
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
    const result={...el,styles:el.styles?.map(s=>({...s}))};
    const matches=[...el.text.matchAll(/\{\{(\w+)\}\}/g)];
    for(const match of matches.reverse()) if(vars[match[1]]!==undefined) replaceText(result,match.index,match.index+match[0].length,String(vars[match[1]]));
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
    const measure=(char,index)=>{font(ctx,styles[index]||el,size);return ctx.measureText(char).width;};
    if (el.fit && !value.includes('\n')) {
      const width=()=>{let index=0,total=0;for(const char of value){total+=measure(char,index);index+=char.length;}return total;};
      while (size > 6 && width() > el.width) size--;
    }
    const lineHeight = size * (el.lineHeight || 1.3), lines = [];
    let text = '', start = 0, offset = 0, glyphs=[], advance=0;
    const push = () => {
      const width = advance + (glyphs.at(-1)?.style.italic ? size*.2 : 0);
      const x = el.align === 'center' ? (el.width - width) / 2 : el.align === 'right' ? el.width - width : 0;
      const stops = [{ index: start, x }];
      for (const glyph of glyphs) stops.push({index:glyph.index+glyph.text.length,x:x+glyph.x+glyph.width});
      lines.push({ text, start, end: start + text.length, x, y: lines.length * lineHeight, width, stops, glyphs });
      text='';glyphs=[];advance=0;
    };
    for (const char of value) {
      if (char === '\n') { push(); offset++; start = offset; continue; }
      const width=measure(char,offset),style=baseStyle(styles[offset]||el);
      if (text && advance + width + (style.italic?size*.2:0) > el.width) { push(); start = offset; }
      glyphs.push({text:char,index:offset,x:advance,width,style});advance+=width;
      text += char; offset += char.length;
    }
    push();
    return { lines, size, lineHeight, height: lines.length * lineHeight, value };
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
        if(width)ctx.scale(glyph.width/width,1);
        ctx.fillText(glyph.text,0,0);ctx.restore();
        ctx.strokeStyle = el.color; ctx.lineWidth = Math.max(1, result.size / 18);
        for (const y of [glyph.style.underline ? line.y + result.size * 1.02 : null, glyph.style.strike ? line.y + result.size * .56 : null]) {
          if (y !== null && glyph.width) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+glyph.width, y); ctx.stroke(); }
        }
      }
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
