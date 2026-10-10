const data = require('./locations/china-cities.json');

const clean = value => String(value).normalize('NFKC').trim().replace(/[\s·,，/\\-]+/g, '').toLowerCase();
// 只移除地名末尾的行政区后缀，不能破坏「市中区」等名称中的文字。
const shortName = value => value.replace(/(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|自治县|自治旗|地区|省|市|区|县|旗|盟)$/u, '');
const variants = name => [...new Set([name, shortName(name)].filter(Boolean))];
const combine = (left, right) => left.flatMap(a => right.map(b => a + b));
const citiesByCode = new Map(data.rows.filter(row => /00$/.test(row[7])).map(row => [row[7], row]));

const locations = data.rows.map(([id, name, province, city, timezone, latitude, longitude, adcode]) => {
  // 按行政代码校正上级名称，避免来源中少量区县误挂到其他同省城市。
  const parent = citiesByCode.get(adcode.slice(0, 4) + '00');
  if (parent) { province = parent[2]; city = parent[3]; }
  const cityLevel = /00$/.test(adcode);
  const names = variants(name);
  if (cityLevel) names.push(...variants(city));
  else if (!/(?:市|区|县|旗|林区|特区)$/.test(name)) {
    // 区县简称补充常用查询后缀；展示名称仍保留来源原文，避免伪造正式名称。
    const code = Number(adcode.slice(-2));
    const suffix = adcode === '-' || code < 21 ? '区' : code >= 81 ? '市' : '县';
    names.push(name + suffix);
  }
  const parents = [...variants(province), ...variants(city)];
  if (province !== city) parents.push(...combine(variants(province), variants(city)));
  const aliases = new Set([...names, ...combine(parents, names)].map(clean));
  return {
    result: { id: `cn-${id}`, name, latitude, longitude, timezone,
      location: [...new Set([province, city])].join(' · '), level: cityLevel ? 'city' : 'county',
      levelLabel: cityLevel ? '市级' : '区县', source: 'local' },
    aliases,
    names: [...new Set(names.map(clean))]
  };
});

function searchChineseCities(query) {
  const key = clean(query);
  if (key.length < 2 || !/[\u3400-\u9fff]/u.test(key)) return [];
  const exact = locations.filter(item => item.aliases.has(key));
  // 先精确匹配市级；用户明确输入区县后缀或上级地名时，不会误命中同名市。
  const cities = exact.filter(item => item.result.level === 'city');
  if (exact.length) return (cities.length ? cities : exact).map(item => item.result).slice(0, 20);
  const partial = locations.filter(item => item.names.some(name => name.startsWith(key)));
  const cityMatches = partial.filter(item => item.result.level === 'city');
  return (cityMatches.length ? cityMatches : partial).map(item => item.result).slice(0, 20);
}

module.exports = { searchChineseCities };
