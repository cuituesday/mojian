const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');

function createLogger(dataDir, now = () => new Date()) {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return (level, ...args) => {
    const date = now();
    const line = `${date.toISOString()} [${level.toUpperCase()}] ${format(...args)}\n`;
    // Open and close on each write: midnight rotation and cleanup cannot leave
    // the process writing to a deleted file through a long-lived descriptor.
    fs.appendFileSync(path.join(dir, `server-${date.toISOString().slice(0, 10)}.log`), line);
  };
}

function installLogging(dataDir) {
  const write = createLogger(dataDir);
  const original = {};
  for (const level of ['log', 'info', 'warn', 'error']) {
    original[level] = console[level].bind(console);
    console[level] = (...args) => {
      original[level](...args);
      try { write(level, ...args); }
      catch (error) { original.error?.(`日志写入失败：${error.message}`); }
    };
  }
  process.on('uncaughtExceptionMonitor', error => console.error(error));
}

module.exports = { createLogger, installLogging };
