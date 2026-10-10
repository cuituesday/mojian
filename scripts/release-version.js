const { execFileSync } = require('node:child_process');

function parseVersion(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
function releaseVersion(tags, commitTags, requested = '') {
  const versions = tags.filter(parseVersion).sort(compareVersions);
  const existing = commitTags.filter(parseVersion).sort(compareVersions);
  const latest = versions.at(-1);
  if (requested) {
    if (!parseVersion(requested)) throw Error('指定版本必须使用 v主版本.次版本.补丁版本，例如 v0.1.1');
    if (existing.includes(requested)) return requested;
    if (tags.includes(requested)) throw Error('指定版本已属于其他提交，不能覆盖');
    if (compareVersions(requested, latest || 'v0.1.0') <= 0) throw Error('指定版本必须高于当前最高版本，首个版本至少为 v0.1.1');
    return requested;
  }
  // 重跑同一提交复用已分配的版本，包括构建失败后的重试。
  if (existing.length) return existing.at(-1);
  const [major, minor, patch] = parseVersion(latest || 'v0.1.0');
  if (patch === Number.MAX_SAFE_INTEGER) throw Error('补丁版本过大，请指定新的次版本');
  return `v${major}.${minor}.${patch + 1}`;
}

if (require.main === module) {
  try {
    const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const commit = process.env.GITHUB_SHA || 'HEAD';
    console.log(releaseVersion(git(['tag', '--list']), git(['tag', '--points-at', commit]), (process.env.RELEASE_VERSION || '').trim()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { releaseVersion };
