const fs = require('node:fs');
const path = require('node:path');

const DAY = 24 * 60 * 60 * 1000;
const defaults = Object.freeze({ logRetentionDays: 30, frameRetentionDays: 30, tempRetentionHours: 24, cleanupIntervalMinutes: 60 });

function loadConfig(file = process.env.INK_CONFIG_FILE || path.join(__dirname, '..', 'config.json')) {
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('配置文件必须是 JSON 对象');
  for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) throw Error(`未知配置项：${key}`);
  const config = { ...defaults, ...input };
  for (const [key, value] of Object.entries(config)) {
    const max = key.endsWith('Days') ? 3650 : key.endsWith('Hours') ? 8760 : 1440;
    if (!Number.isInteger(value) || value < 1 || value > max) throw Error(`${key} 必须为 1–${max} 的整数`);
  }
  return config;
}

function pruneRequests(requests, config, now = Date.now()) {
  return requests.filter(entry => Date.parse(entry.at) >= now - config.logRetentionDays * DAY).slice(0, 200);
}

// Delete only recognized application files, never directories or symlinks.
function cleanFiles(dataDir, config, now = Date.now()) {
  const removed = [];
  const scan = (dir, ageFor) => {
    if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) return;
    for (const name of fs.readdirSync(dir)) {
      const age = ageFor(name);
      if (age === null) continue;
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (stat.isFile() && stat.mtimeMs < now - age) { fs.unlinkSync(file); removed.push(file); }
    }
  };
  scan(path.join(dataDir, 'logs'), name => /^server-\d{4}-\d{2}-\d{2}\.log$/.test(name) ? config.logRetentionDays * DAY : null);
  scan(path.join(dataDir, 'frames'), name => /^[a-f0-9]{64}\.bmp$/.test(name) ? config.frameRetentionDays * DAY
    : /^[a-f0-9]{64}\.bmp\.tmp$/.test(name) ? config.tempRetentionHours * 3600000 : null);
  scan(dataDir, name => name === 'server.log' ? config.logRetentionDays * DAY
    : ['state.json.tmp', 'source-cache.json.tmp'].includes(name) ? config.tempRetentionHours * 3600000 : null);
  return removed;
}

module.exports = { loadConfig, defaults, pruneRequests, cleanFiles };
