#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

// --- Chrome Detection ---

const CHROME_PATHS_MACOS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const CHROME_PATHS_LINUX = [
  'google-chrome-stable',
  'google-chrome',
  'chromium-browser',
  'chromium',
];

function findChrome() {
  // 1. Environment variable
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const platform = os.platform();

  // 2. Platform-specific paths
  if (platform === 'darwin') {
    for (const p of CHROME_PATHS_MACOS) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'linux') {
    for (const name of CHROME_PATHS_LINUX) {
      try {
        const resolved = execSync(`which ${name}`, { encoding: 'utf8' }).trim();
        if (resolved) return resolved;
      } catch (_) {}
    }
  }

  return null;
}

// --- Session Management ---

const SESSION_PREFIX = 'fe-browser-';
const CHROME_DATA_PREFIX = 'fe-chrome-';

function sessionFilePath(sessionId) {
  return path.join(os.tmpdir(), `${SESSION_PREFIX}${sessionId}.json`);
}

function chromeDataDir(sessionId) {
  return path.join(os.tmpdir(), `${CHROME_DATA_PREFIX}${sessionId}`);
}

function generateSessionId() {
  return crypto.randomBytes(3).toString('hex');
}

function readSession(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeSession(sessionId, data) {
  fs.writeFileSync(sessionFilePath(sessionId), JSON.stringify(data, null, 2), 'utf8');
}

function deleteSession(sessionId) {
  const filePath = sessionFilePath(sessionId);
  try { fs.unlinkSync(filePath); } catch (_) {}
  const dataDir = chromeDataDir(sessionId);
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (_) {}
}

function listSessions() {
  const tmpDir = os.tmpdir();
  const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(SESSION_PREFIX) && f.endsWith('.json'));
  return files.map(f => {
    const sessionId = f.slice(SESSION_PREFIX.length, -5);
    try {
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, f), 'utf8'));
      return { sessionId, ...data };
    } catch (_) {
      return { sessionId, error: 'corrupt session file' };
    }
  });
}

// --- Browser Lifecycle ---

const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async function launch(opts = {}) {
  const http = require('http');
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      'Chrome not found. Install Google Chrome or set CHROME_PATH environment variable.\n' +
      'macOS: brew install --cask google-chrome\n' +
      'Linux: sudo apt install google-chrome-stable'
    );
  }

  const sessionId = generateSessionId();
  const userDataDir = chromeDataDir(sessionId);
  fs.mkdirSync(userDataDir, { recursive: true });

  const maximized = !!opts.maximized;
  const screenWidth = opts.screenWidth || 1920;
  const screenHeight = opts.screenHeight || 1080;
  const viewportWidth = opts.viewportWidth || 1440;
  const viewportHeight = opts.viewportHeight || 900;

  // Find a free port
  const debugPort = await new Promise((resolve, reject) => {
    const srv = require('net').createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });

  // Spawn Chrome as a fully detached process
  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-sync',
    `--screen-info={${screenWidth}x${screenHeight}}`,
  ];
  if (maximized) {
    chromeArgs.push('--start-maximized');
  } else {
    chromeArgs.push(`--window-size=${viewportWidth},${viewportHeight}`);
  }

  const chromeProc = spawn(chromePath, chromeArgs, {
    stdio: 'ignore',
    detached: true,
  });
  chromeProc.unref();

  const pid = chromeProc.pid;

  // Watchdog: spawn a detached process that auto-kills Chrome after timeout
  // This works even after the parent Node process exits
  const timeoutMs = opts.timeout || DEFAULT_SESSION_TIMEOUT_MS;
  const timeoutSec = Math.ceil(timeoutMs / 1000);
  const watchdogProc = spawn('sh', ['-c',
    `sleep ${timeoutSec} && kill ${pid} 2>/dev/null; sleep 5 && kill -9 ${pid} 2>/dev/null; exit 0`
  ], { stdio: 'ignore', detached: true });
  watchdogProc.unref();
  const watchdogPid = watchdogProc.pid;

  // Poll for Chrome to be ready (up to 15 seconds)
  let wsEndpoint = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const data = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${debugPort}/json/version`, (res) => {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      wsEndpoint = data.webSocketDebuggerUrl;
      break;
    } catch (_) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (!wsEndpoint) {
    // Chrome failed to start, clean up
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
    deleteSession(sessionId);
    throw new Error(`Chrome failed to start within 15 seconds (port ${debugPort})`);
  }

  // Connect briefly to set up default page viewport
  const puppeteer = require('../../vendor/puppeteer-core.cjs');
  const browser = await puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
    defaultViewport: maximized ? null : { width: viewportWidth, height: viewportHeight },
  });
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  let finalViewport;
  if (maximized) {
    await page.setViewport(null);
    const windowId = await page.windowId();
    await browser.setWindowBounds(windowId, { windowState: 'maximized' });
    const bounds = await browser.getWindowBounds(windowId);
    finalViewport = { width: bounds.width, height: bounds.height };
  } else {
    await page.setViewport({ width: viewportWidth, height: viewportHeight });
    finalViewport = { width: viewportWidth, height: viewportHeight };
  }
  browser.disconnect();

  const sessionData = {
    sessionId,
    pid,
    wsEndpoint,
    debugPort,
    viewport: finalViewport,
    createdAt: new Date().toISOString(),
    timeoutMs,
    watchdogPid,
  };
  writeSession(sessionId, sessionData);

  return sessionData;
}

async function connect(sessionId) {
  const session = readSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const puppeteer = require('../../vendor/puppeteer-core.cjs');

  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: session.wsEndpoint,
      defaultViewport: session.viewport || { width: 1280, height: 800 },
    });
  } catch (err) {
    throw new Error(`Failed to connect to browser session ${sessionId}: ${err.message}`);
  }

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  return { browser, page };
}

async function stop(sessionId) {
  const session = readSession(sessionId);
  if (!session) {
    deleteSession(sessionId);
    return { cleaned: true, reason: 'no session file' };
  }

  // Kill the watchdog process first (no longer needed)
  if (session.watchdogPid) {
    try { process.kill(session.watchdogPid, 'SIGKILL'); } catch (_) {}
  }

  try {
    const puppeteer = require('../../vendor/puppeteer-core.cjs');
    const browser = await puppeteer.connect({
      browserWSEndpoint: session.wsEndpoint,
    });
    await browser.close();
  } catch (_) {
    // Browser already dead, try to kill by PID
    if (session.pid) {
      try { process.kill(session.pid, 'SIGKILL'); } catch (__) {}
    }
  }

  deleteSession(sessionId);
  return { cleaned: true };
}

async function cleanup(opts = {}) {
  const maxAgeMs = (opts.maxAge || 60) * 60 * 1000;
  const now = Date.now();
  const sessions = listSessions();
  const cleaned = [];
  const alreadyDead = [];

  for (const session of sessions) {
    const age = now - new Date(session.createdAt || 0).getTime();
    const expired = age > maxAgeMs;
    let alive = false;

    if (session.pid) {
      try {
        process.kill(session.pid, 0);
        alive = true;
      } catch (_) {
        alive = false;
      }
    }

    if (expired || !alive) {
      // Kill watchdog process if present
      if (session.watchdogPid) {
        try { process.kill(session.watchdogPid, 'SIGKILL'); } catch (_) {}
      }
      if (alive && session.pid) {
        try { process.kill(session.pid, 'SIGKILL'); } catch (_) {}
        cleaned.push(session.sessionId);
      } else {
        alreadyDead.push(session.sessionId);
      }
      deleteSession(session.sessionId);
    }
  }

  return { cleaned, alreadyDead };
}

// --- A11y Tree Formatting ---

function formatA11yNode(node, indent = 0) {
  if (!node) return '';
  const prefix = '  '.repeat(indent);
  let line = `${prefix}- ${node.role || 'unknown'}`;
  if (node.name) line += ` "${node.name}"`;
  if (node.level) line += ` level=${node.level}`;
  if (node.value) line += ` value="${node.value}"`;
  if (node.checked !== undefined) line += ` checked=${node.checked}`;
  if (node.disabled) line += ' disabled';

  let result = line + '\n';
  if (node.children) {
    for (const child of node.children) {
      result += formatA11yNode(child, indent + 1);
    }
  }
  return result;
}

module.exports = {
  findChrome,
  generateSessionId,
  readSession,
  writeSession,
  deleteSession,
  listSessions,
  launch,
  connect,
  stop,
  cleanup,
  formatA11yNode,
};
