const { lunarParts } = require('./calendar');
const family = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
function font(ctx, size, bold = true) { ctx.font = `${bold ? 'bold ' : ''}${size}px ${family}`; }
function wrap(ctx, value, width) {
  const result = [];
  for (const paragraph of String(value).split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && ctx.measureText(line+char).width > width) {
        const chars=[...line];
        // Keep closing punctuation with the preceding character instead of orphaning it.
        if(chars.length>1&&/[，。！？；：、）》」』】…,.!?;:)]/.test(char)){const last=chars.pop();result.push(chars.join(''));line=last;}
        else {result.push(line);line='';}
      }
      line += char;
    }
    result.push(line);
  }
  return result;
}
function ellipsis(ctx, value, width) {
  if (ctx.measureText(value).width <= width) return value;
  const chars = [...value]; while (chars.length && ctx.measureText(chars.join('')+'…').width > width) chars.pop(); return chars.join('')+'…';
}
function paginate(ctx, el, items) {
  font(ctx, el.size || 18, el.bold !== false);
  const lineHeight = (el.size || 18) * (el.lineHeight || 1.1), capacity = Math.max(1,Math.floor(el.height/lineHeight));
  const pages = []; let page = [];
  (items.length ? items : ['暂无内容']).forEach((item, i) => {
    const title = `${i+1}. ${typeof item === 'string' ? item : item.title}`;
    let lines = el.source === 'trending' ? [ellipsis(ctx,title,el.width)] : wrap(ctx,title,el.width);
    if (lines.length > capacity) { lines = lines.slice(0,capacity); lines[capacity-1] = ellipsis(ctx,lines[capacity-1]+'…',el.width); }
    if (page.length + lines.length > capacity) { pages.push(page); page = []; }
    page.push(...lines);
  });
  if (page.length) pages.push(page);
  return { pages, lineHeight };
}
function drawWeather(ctx, el, condition) {
  ctx.translate(el.x,el.y); ctx.scale(el.width/64,el.height/58); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111111'; ctx.fillStyle = '#ffffff';
  const sunny = /晴/.test(condition), rain = /雨|雷/.test(condition), snow = /雪/.test(condition), unknown = /暂无|--/.test(condition);
  if (unknown) { font(ctx,30);ctx.textAlign='center';ctx.fillStyle='#111111';ctx.fillText('?',32,5); return; }
  if (sunny) { ctx.fillStyle='#ff0000';ctx.beginPath();ctx.arc(42,16,10,0,Math.PI*2);ctx.fill();for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(42+Math.cos(a)*13,16+Math.sin(a)*13);ctx.lineTo(42+Math.cos(a)*17,16+Math.sin(a)*17);ctx.stroke();} }
  ctx.fillStyle='#ffffff'; ctx.beginPath();ctx.moveTo(13,36);ctx.bezierCurveTo(0,36,0,21,12,21);ctx.bezierCurveTo(11,6,31,4,35,16);ctx.bezierCurveTo(44,10,53,16,52,23);ctx.bezierCurveTo(65,25,60,37,50,37);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#111111';ctx.beginPath();ctx.arc(25,25,1.5,0,Math.PI*2);ctx.arc(39,25,1.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(32,27,4,0,Math.PI);ctx.stroke();
  ctx.fillStyle='#ff0000';ctx.beginPath();ctx.arc(19,30,2,0,Math.PI*2);ctx.arc(45,30,2,0,Math.PI*2);ctx.fill();
  for(let i=0;i<3;i++){ctx.strokeStyle=i===1?'#ff0000':'#111111';ctx.beginPath();if(rain){ctx.moveTo(17+i*14,43);ctx.lineTo(13+i*14,53);}else if(snow){ctx.moveTo(14+i*15,43);ctx.lineTo(20+i*15,51);ctx.moveTo(20+i*15,43);ctx.lineTo(14+i*15,51);}else{ctx.moveTo(10,43+i*6);ctx.lineTo(54,43+i*6);}ctx.stroke();}
}
function drawMonth(ctx, el, p, vars) {
  const year = +p.year, month = +p.month, day = +p.day, first = new Date(Date.UTC(year,month-1,1)), start = first.getUTCDay();
  const days = new Date(Date.UTC(year,month,0)).getUTCDate(), rows = Math.ceil((days+start)/7), header = el.height*.12, rh=(el.height-header)/rows, cw=el.width/7;
  ctx.textAlign='center';ctx.textBaseline='middle';
  ['日','一','二','三','四','五','六'].forEach((label,col)=>{ctx.fillStyle=col===0||col===6?'#ff0000':'#111111';ctx.fillRect(el.x+col*cw,el.y,cw,header);ctx.fillStyle='#ffffff';font(ctx,16,false);ctx.fillText(label,el.x+(col+.5)*cw,el.y+header/2);});
  for(let i=0;i<rows*7;i++) {
    const date = new Date(Date.UTC(year,month-1,i-start+1)), d=date.getUTCDate(), m=date.getUTCMonth()+1, y=date.getUTCFullYear(), col=i%7, row=Math.floor(i/7);
    const x=el.x+col*cw, top=el.y+header+row*rh, today=d===day&&m===month, lunar=lunarParts(y,m,d);
    ctx.fillStyle=today?'#ff0000':'#ffffff';ctx.fillRect(x,top,cw,rh);ctx.strokeStyle='#111111';ctx.lineWidth=.8;ctx.strokeRect(x,top,cw,rh);
    ctx.fillStyle=today?'#ffffff':lunar.lunarLabel.includes('月')?'#ff0000':'#111111';font(ctx,Math.min(13,rh*.27),true);ctx.fillText(lunar.lunarLabel,x+cw/2,top+rh*.22);
    ctx.fillStyle=today?'#ffffff':m!==month?'#555555':col===0||col===6?'#ff0000':'#111111';font(ctx,Math.min(16,rh*.34),false);ctx.fillText(String(d),x+cw/2,top+rh*.62);
    const forecast = vars.forecast?.find(f=>f.date===date.toISOString().slice(0,10));
    if(forecast) {font(ctx,Math.min(10,rh*.21),false);ctx.fillText(forecast.condition,x+cw/2,top+rh*.87);}
  }
}
module.exports = { font, wrap, ellipsis, paginate, drawWeather, drawMonth };
