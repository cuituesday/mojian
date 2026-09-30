const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaults, loadConfig, cleanFiles, pruneRequests } = require('../lib/maintenance');
const { createLogger } = require('../lib/logging');
const { createApp } = require('../server');
const { defaultSettings } = require('../lib/themes');

const DAY = 86400000;
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-maintenance-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('config supplies defaults and rejects invalid retention before cleanup', t => {
  const file = path.join(temporary(t), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ logRetentionDays: 7 }));
  assert.deepEqual(loadConfig(file), { ...defaults, logRetentionDays: 7 });
  for (const value of [{ logRetentionDays: 0 }, { frameRetentionDays: -1 }, { tempRetentionHours: 0.5 }, { cleanupIntervalMinutes: 1441 }, { logRetentionDays: '30' }, { logRetensionDays: 30 }, [], null]) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => loadConfig(file));
  }
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => loadConfig(file));
  assert.throws(() => loadConfig(`${file}.missing`));
});

test('cleanup removes expired app files only and respects age boundaries and symlinks', t => {
  const dir = temporary(t), now = Date.parse('2026-09-29T12:00:00Z');
  const put = (name, age) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'keep or clean');
    const date = new Date(now - age); fs.utimesSync(file, date, date);
    return file;
  };
  const expired = [put('logs/server-2026-08-01.log', 31 * DAY), put('server.log', 31 * DAY), put(`frames/${'a'.repeat(64)}.bmp`, 31 * DAY), put(`frames/${'b'.repeat(64)}.bmp.tmp`, 2 * DAY), put('state.json.tmp', 2 * DAY), put('source-cache.json.tmp', 2 * DAY)];
  const kept = [put('logs/server-2026-09-29.log', 0), put('logs/server-2026-08-30.log', 30 * DAY), put(`frames/${'c'.repeat(64)}.bmp`, DAY), put(`frames/${'d'.repeat(64)}.bmp.tmp`, DAY / 2), put('state.json', 365 * DAY), put('source-cache.json', 365 * DAY), put('frames/holiday.bmp', 365 * DAY), put('logs/private.log', 365 * DAY)];
  const target = put('external-history.txt', 365 * DAY);
  const link = path.join(dir, 'frames', `${'e'.repeat(64)}.bmp`);
  fs.symlinkSync(target, link);
  const directory = path.join(dir, 'frames', `${'f'.repeat(64)}.bmp`);
  fs.mkdirSync(directory); fs.utimesSync(directory, new Date(0), new Date(0));
  assert.deepEqual(cleanFiles(dir, defaults, now).sort(), expired.sort());
  for (const file of expired) assert.equal(fs.existsSync(file), false);
  for (const file of [...kept, link, target, directory]) assert.equal(fs.existsSync(file), true);
  assert.deepEqual(cleanFiles(dir, defaults, now), []);
  const custom = { ...defaults, frameRetentionDays: 1 };
  assert.ok(cleanFiles(dir, custom, now + 1).includes(kept[2]));

  const linkedDir = temporary(t), outside = temporary(t);
  const outsideFile = path.join(outside, 'server-2020-01-01.log');
  fs.writeFileSync(outsideFile, 'external'); fs.utimesSync(outsideFile, new Date(0), new Date(0));
  fs.symlinkSync(outside, path.join(linkedDir, 'logs'));
  cleanFiles(linkedDir, defaults, now);
  assert.equal(fs.existsSync(outsideFile), true);
});

test('request retention enforces age and count and persists on startup and maintenance', t => {
  const dir = temporary(t), now = Date.now();
  const recent = { at: new Date(now).toISOString(), id: 'recent' };
  const old = { at: new Date(now - 31 * DAY).toISOString(), id: 'old' };
  assert.deepEqual(pruneRequests([recent, old, { at: 'bad' }], defaults, now), [recent]);
  assert.equal(pruneRequests(Array.from({ length: 205 }, () => recent), defaults, now).length, 200);
  const stateFile = path.join(dir, 'state.json');
  const state = { settings: defaultSettings, customThemes: [{ id: 'saved-theme' }], devices: [{ id: 'offline-device' }], activeTheme: 'calendar', requests: [recent, old] };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const app = createApp({ dataDir: dir });
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.deepEqual(saved.requests, [recent]);
  assert.deepEqual(saved.devices, state.devices);
  assert.deepEqual(saved.customThemes, state.customThemes);
  const temp = path.join(dir, 'state.json.tmp');
  fs.writeFileSync(temp, 'interrupted write'); fs.utimesSync(temp, new Date(0), new Date(0));
  assert.deepEqual(app.locals.maintenance(), [temp]);
});

test('logger rotates across UTC midnight without retaining an open file handle', t => {
  const dir = temporary(t);
  let date = new Date('2026-09-28T23:59:59Z');
  const write = createLogger(dir, () => date);
  write('info', 'before %s', 'midnight');
  date = new Date('2026-09-29T00:00:01Z');
  write('error', 'after midnight');
  const first = path.join(dir, 'logs', 'server-2026-09-28.log');
  const second = path.join(dir, 'logs', 'server-2026-09-29.log');
  assert.match(fs.readFileSync(first, 'utf8'), /\[INFO\] before midnight/);
  assert.match(fs.readFileSync(second, 'utf8'), /\[ERROR\] after midnight/);
  fs.unlinkSync(second);
  write('info', 'recreated');
  assert.match(fs.readFileSync(second, 'utf8'), /recreated/);
  assert.equal(fs.readdirSync(path.join(dir, 'logs')).length, 2);
});
