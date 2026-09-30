const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadConfig } = require('../lib/maintenance');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.INK_DATA_DIR || path.join(root, 'data'));
const port = Number(process.env.PORT || 4000);
const url = `http://127.0.0.1:${port}`;

async function health() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.service !== 'ink-studio' || !data.ok) throw Error(`端口 ${port} 被其他服务占用，请检查后重试。`);
    return data;
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw error;
  }
}

async function main() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT 必须为有效端口号');
  const running = await health();
  if (running) { console.log(`服务已运行（PID ${running.pid}）：${url}`); return; }
  loadConfig();
  fs.mkdirSync(dataDir, { recursive: true });
  const logPath = path.join(dataDir, 'logs');
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(port), INK_DATA_DIR: dataDir,
      ...(process.env.INK_CONFIG_FILE ? { INK_CONFIG_FILE: path.resolve(process.env.INK_CONFIG_FILE) } : {}) }
  });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw Error(`服务启动失败，请查看 ${logPath}`);
    const result = await health();
    if (result?.pid === child.pid) {
      console.log(`后台服务已启动（PID ${child.pid}）：${url}\n服务端数据：${dataDir}\n运行日志：${logPath}\n关闭当前终端不会停止服务；电脑重启后需重新启动。`);
      return;
    }
  }
  child.kill('SIGTERM');
  throw Error(`启动等待超时，请查看 ${logPath}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
