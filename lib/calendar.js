const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year:'numeric',month:'long',day:'numeric',timeZone:'UTC' });
function lunarParts(year, month, day) {
  const p = Object.fromEntries(lunarFormatter.formatToParts(new Date(Date.UTC(year,month-1,day,12))).map(p=>[p.type,p.value]));
  const d = Number(p.day), digits = ['','一','二','三','四','五','六','七','八','九'];
  const lunarDay = d === 10 ? '初十' : d === 20 ? '二十' : d === 30 ? '三十' : `${d < 10 ? '初' : d < 20 ? '十' : '廿'}${digits[d%10]}`;
  const zodiac = '鼠牛虎兔龙蛇马羊猴鸡狗猪'[((Number(p.relatedYear)-4)%12+12)%12];
  return { lunarMonth:p.month,lunarDay,lunarYear:p.yearName,zodiac,lunarDate:p.month+lunarDay,lunarLabel:d === 1 ? p.month : lunarDay };
}
function countdown(parts, settings) {
  const today = Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day));
  const target = settings.countdownDate ? Date.parse(settings.countdownDate+'T00:00:00Z') : Date.UTC(Number(parts.year),9,1);
  const days = Math.round((target-today)/86400000), name = settings.countdownName || '目标日';
  return days === 0 ? `今天是${name}` : days > 0 ? `距${name}还有${days}天` : `${name}已过${Math.abs(days)}天`;
}
module.exports = { lunarParts, countdown };
