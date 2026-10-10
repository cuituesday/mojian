const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { releaseVersion } = require('../scripts/release-version');

test('发布版本从 v0.1.1 开始，按数值递增最高正式版本的补丁号', () => {
  assert.equal(releaseVersion([], []), 'v0.1.1');
  assert.equal(releaseVersion(['sha-abc', 'v0.2.0-beta.1', 'v01.2.3'], []), 'v0.1.1');
  assert.equal(releaseVersion(['v0.1.9', 'v0.1.10', 'v0.1.2'], []), 'v0.1.11');
  assert.equal(releaseVersion(['v0.1.99', 'v0.2.0'], []), 'v0.2.1');
  assert.equal(releaseVersion(['v1.9.99', 'v2.0.0'], []), 'v2.0.1');
});

test('同一提交重跑复用版本，指定版本不能覆盖其他提交或倒退', () => {
  assert.equal(releaseVersion(['v0.1.1', 'v0.1.2'], ['v0.1.1']), 'v0.1.1');
  assert.equal(releaseVersion(['v0.1.1'], ['v0.1.1'], 'v0.2.0'), 'v0.2.0');
  assert.equal(releaseVersion(['v0.1.1', 'v0.1.2'], ['v0.1.1'], 'v0.1.1'), 'v0.1.1');
  assert.throws(() => releaseVersion(['v0.1.1'], [], 'v0.1.1'), /其他提交/);
  assert.throws(() => releaseVersion(['v0.2.0'], [], 'v0.1.9'), /高于/);
  assert.throws(() => releaseVersion([], [], 'v0.1.0'), /至少/);
  for (const value of ['0.1.1', 'v0.01.1', 'v0.1.1-beta', 'v0.1.1\n其他内容', 'v0.1.9007199254740992']) {
    assert.throws(() => releaseVersion([], [], value), /必须使用/);
  }
});

test('版本脚本读取真实 Git 标签，兼容轻量和附注标签，不自行修改仓库', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mojian-version-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');git('config', 'user.name', '墨间测试');git('config', 'user.email', 'test@example.invalid');
  git('commit', '--allow-empty', '-m', '创建版本测试提交');
  const first = git('rev-parse', 'HEAD');
  const run = (commit = first, version = '') => execFileSync(process.execPath, [path.join(__dirname, '../scripts/release-version.js')], {
    cwd, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: commit, RELEASE_VERSION: version }
  }).trim();
  assert.equal(run(), 'v0.1.1');assert.equal(git('tag', '--list'), '');
  git('tag', '-a', 'v0.1.1', '-m', '测试附注版本');
  assert.equal(run(), 'v0.1.1');
  git('commit', '--allow-empty', '-m', '创建第二个测试提交');
  const second = git('rev-parse', 'HEAD');
  assert.equal(run(second), 'v0.1.2');
  git('tag', 'v0.1.2');assert.equal(run(second), 'v0.1.2');assert.equal(run(first), 'v0.1.1');
  assert.equal(run(second, 'v0.2.0'), 'v0.2.0');
  assert.equal(git('tag', '--list'), 'v0.1.1\nv0.1.2');
});
