#!/usr/bin/env node
'use strict';

/**
 * 将 puppeteer-core 打包为单文件 vendor/puppeteer-core.cjs
 * 发布前运行: npm run build
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'scripts', '_puppeteer-entry.cjs');
const OUT = path.join(ROOT, 'fe-harness', 'vendor', 'puppeteer-core.cjs');

// 创建临时入口：re-export puppeteer-core
fs.writeFileSync(ENTRY, `module.exports = require('puppeteer-core');\n`);

const externals = [
  'fs', 'path', 'child_process', 'os', 'net', 'http', 'https',
  'tls', 'crypto', 'stream', 'url', 'zlib', 'events', 'util',
  'buffer', 'querystring', 'string_decoder', 'assert', 'dns',
  'readline', 'worker_threads', 'perf_hooks', 'async_hooks',
].map(m => `--external:${m}`).join(' ');

try {
  execSync(
    `npx esbuild "${ENTRY}" --bundle --platform=node --target=node18 --format=cjs --outfile="${OUT}" --minify ${externals}`,
    { cwd: ROOT, stdio: 'inherit' }
  );

  const size = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log(`\n✓ puppeteer-core bundled → fe-harness/vendor/puppeteer-core.cjs (${size} MB)\n`);
} finally {
  // 清理临时入口
  try { fs.unlinkSync(ENTRY); } catch (_) {}
}
