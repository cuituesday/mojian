const { createCanvas, loadImage } = require('canvas');
const { lunarParts, countdown } = require('./calendar');
const { font, paginate, drawWeather, drawMonth } = require('./widgets');

function dateParts(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, weekday: 'long' }).format(now);
  return { ...p, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday,
    dayNumber: Number(p.day), monthNumber: Number(p.month), weekdayVertical: weekday.split('').join('\n'),
    monthEnglish: new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'long'}).format(now),
    weekdayEnglish: new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'long'}).format(now),
    ...lunarParts(+p.year,+p.month,+p.day) };
}
function isQuiet(settings, now) {
  if (!settings.quietEnabled || settings.quietStart === settings.quietEnd) return false;
  const h = Number(dateParts(settings.timezone, now).hour);
  return settings.quietStart < settings.quietEnd ? h >= settings.quietStart && h < settings.quietEnd : h >= settings.quietStart || h < settings.quietEnd;
}
function wrapText(ctx, value, width) {
  const lines = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
function processPixels(data, width, height, settings) {
  if (settings.mode === 'original') return;
  const light = new Float32Array(width * height);
  const reds = new Uint8Array(width * height);
  for (let p = 0; p < light.length; p++) {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    reds[p] = r > 80 && r - Math.max(g, b) >= settings.redThreshold;
    light[p] = .299 * r + .587 * g + .114 * b;
  }
  const diffusion = settings.mode === 'floyd' ? [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]] : settings.mode === 'atkinson' ? [[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]] : [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, i = p * 4;
    if (reds[p]) { data[i] = 255; data[i + 1] = data[i + 2] = 0; continue; }
    const v = light[p] >= settings.brightness ? 255 : 0, error = light[p] - v;
    data[i] = data[i + 1] = data[i + 2] = v;
    for (const [dx, dy, weight] of diffusion) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny < height && !reds[ny * width + nx]) light[ny * width + nx] += error * weight;
    }
  }
}
async function render(theme, settings, weather = {}, now = new Date(), context = {}) {
  const canvas = createCanvas(settings.width, settings.height), ctx = canvas.getContext('2d');
  ctx.fillStyle = theme.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (settings.rotation === 180) { ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); }
  ctx.scale(canvas.width / theme.width, canvas.height / theme.height);
  const p = dateParts(settings.timezone, now);
  const vars = { ...p, ...settings, temperature:'23',low:'18',high:'26',humidity:'56',condition:'晴',tomorrowCondition:'晴',tomorrowLow:'17',tomorrowHigh:'25',weatherSource:'示例天气',weatherFlag:'示例',battery:'--', ...weather, ...context.vars, countdown:countdown(p,settings) };
  const feeds = {}, feedPages = {};
  for (const el of theme.elements.filter(e=>e.type==='feed')) {
    const source = el.source || 'trending';
    const items = context.feeds?.[source]?.items || String(settings[source] || '').split('\n').filter(Boolean);
    const layout = paginate(ctx,el,items), index = Math.max(0,context.pageIndex || 0) % layout.pages.length;
    feeds[el.id] = {...layout,index}; feedPages[source] = { page:index+1,total:layout.pages.length };
    vars[`${source}Page`] = index+1; vars[`${source}Pages`] = layout.pages.length;
    vars[`${source}Status`] = [vars.weatherFlag ? `天气${vars.weatherFlag}` : '',context.feeds?.[source]?.status || '手动内容'].filter(Boolean).join(' · ');
  }
  for (const el of theme.elements) {
    ctx.save(); ctx.beginPath(); ctx.rect(el.x, el.y, el.width, el.height); ctx.clip(); ctx.fillStyle = el.color;
    if (el.type === 'rect') ctx.fillRect(el.x, el.y, el.width, el.height);
    if (el.type === 'text') {
      font(ctx,el.size,el.bold);
      ctx.textBaseline = 'top';
      const value = el.text.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
      let size = el.size;
      if (el.fit && !value.includes('\n')) { while(size > 9 && ctx.measureText(value).width > el.width) font(ctx,--size,el.bold); }
      ctx.textAlign=el.align || 'left';
      const x=el.x+(el.align==='center'?el.width/2:el.align==='right'?el.width:0);
      wrapText(ctx, value, el.width).forEach((line, i) => ctx.fillText(line, x, el.y + i * size * (el.lineHeight || 1.3)));
    }
    if (el.type === 'weather-icon') drawWeather(ctx,el,vars.condition);
    if (el.type === 'month-grid') drawMonth(ctx,el,p,vars);
    if (el.type === 'feed') {
      const f = feeds[el.id]; font(ctx,el.size||18,el.bold!==false);ctx.textBaseline='top';ctx.textAlign='left';
      f.pages[f.index].forEach((line,i)=>ctx.fillText(line,el.x,el.y+i*f.lineHeight));
    }
    if (el.type === 'image' && el.src) {
      const img = await loadImage(el.src);
      const scale = Math.max(el.width / img.width, el.height / img.height);
      ctx.drawImage(img, el.x + (el.width - img.width * scale) / 2, el.y + (el.height - img.height * scale) / 2, img.width * scale, img.height * scale);
    }
    if (el.type === 'landscape') {
      ctx.fillStyle = '#eeeeee'; ctx.fillRect(el.x, el.y, el.width, el.height);
      for (let n = 0; n < 3; n++) {
        ctx.fillStyle = ['#bbbbbb', '#777777', '#222222'][n]; ctx.beginPath(); ctx.moveTo(el.x, el.y + el.height);
        for (let i = 0; i <= 8; i++) ctx.lineTo(el.x + i * el.width / 8, el.y + el.height * (.42 + n * .16) + Math.sin(i * 1.7 + n) * 46);
        ctx.lineTo(el.x + el.width, el.y + el.height); ctx.fill();
      }
    }
    if (el.type === 'calendar') {
      const year = Number(p.year), month = Number(p.month), today = Number(p.day), start = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate(), cw = el.width / 7, ch = el.height / 7;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `11px sans-serif`;
      ['一','二','三','四','五','六','日'].forEach((v, i) => ctx.fillText(v, el.x + (i + .5) * cw, el.y + ch / 2));
      for (let d = 1; d <= days; d++) {
        const col = (start + d - 1) % 7, row = Math.floor((start + d - 1) / 7) + 1, x = el.x + (col + .5) * cw, y = el.y + (row + .5) * ch;
        if (d === today) { ctx.fillStyle = '#cc2626'; ctx.fillRect(x - 11, y - ch / 2, 22, ch); ctx.fillStyle = '#ffffff'; } else ctx.fillStyle = el.color;
        ctx.fillText(String(d), x, y);
      }
    }
    ctx.restore();
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  processPixels(pixels.data, canvas.width, canvas.height, settings);
  ctx.resetTransform(); ctx.putImageData(pixels, 0, 0);
  return { png: canvas.toBuffer('image/png'), bmp: encodeBMP(pixels.data, canvas.width, canvas.height), feedPages };
}
function encodeBMP(data, width, height) {
  const stride = Math.ceil(width * 3 / 4) * 4, buffer = Buffer.alloc(54 + stride * height);
  buffer.write('BM'); buffer.writeUInt32LE(buffer.length, 2); buffer.writeUInt32LE(54, 10); buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18); buffer.writeInt32LE(height, 22); buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(24, 28); buffer.writeUInt32LE(stride * height, 34);
  buffer.writeInt32LE(2835, 38); buffer.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = ((height - 1 - y) * width + x) * 4, t = 54 + y * stride + x * 3;
    buffer[t] = data[s + 2]; buffer[t + 1] = data[s + 1]; buffer[t + 2] = data[s];
  }
  return buffer;
}
module.exports = { render, encodeBMP, isQuiet, dateParts, processPixels };
