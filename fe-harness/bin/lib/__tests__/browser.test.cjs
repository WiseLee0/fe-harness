'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const browserCjs = path.resolve(__dirname, '..', '..', 'browser.cjs');
const {
  findChrome,
  generateSessionId,
  readSession,
  writeSession,
  deleteSession,
  listSessions,
  formatA11yNode,
} = require('../browser-core.cjs');

// --- Helper ---

function run(args, opts = {}) {
  const timeout = opts.timeout || 20000;
  const result = execSync(`node ${browserCjs} ${args}`, {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...(opts.env || {}) },
  }).trim();
  try {
    const parsed = JSON.parse(result);
    // Don't parse plain numbers/booleans — they're likely session IDs
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return result;
    return parsed;
  } catch (_) {
    return result;
  }
}

// ============================================================
// Unit tests (no browser needed)
// ============================================================

describe('browser-core unit tests', () => {

  describe('findChrome', () => {
    it('should find Chrome on this machine', () => {
      const chromePath = findChrome();
      assert.ok(chromePath, 'Chrome should be found');
      assert.ok(fs.existsSync(chromePath), `Chrome path should exist: ${chromePath}`);
    });
  });

  describe('generateSessionId', () => {
    it('should return a 6-char hex string', () => {
      const id = generateSessionId();
      assert.match(id, /^[0-9a-f]{6}$/);
    });

    it('should return unique values', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateSessionId()));
      assert.ok(ids.size >= 18, 'Should generate mostly unique IDs');
    });
  });

  describe('session file management', () => {
    let testSessionId;

    beforeEach(() => {
      testSessionId = 'test' + generateSessionId().slice(0, 2);
    });

    afterEach(() => {
      deleteSession(testSessionId);
    });

    it('readSession returns null for non-existent session', () => {
      assert.equal(readSession('nonexistent999'), null);
    });

    it('writeSession + readSession roundtrip', () => {
      const data = { pid: 12345, wsEndpoint: 'ws://localhost:9222', createdAt: new Date().toISOString() };
      writeSession(testSessionId, data);
      const loaded = readSession(testSessionId);
      assert.deepEqual(loaded, data);
    });

    it('deleteSession removes session file', () => {
      writeSession(testSessionId, { pid: 1 });
      assert.ok(readSession(testSessionId));
      deleteSession(testSessionId);
      assert.equal(readSession(testSessionId), null);
    });
  });

  describe('formatA11yNode', () => {
    it('should format a simple node', () => {
      const result = formatA11yNode({ role: 'button', name: 'Submit' });
      assert.equal(result.trim(), '- button "Submit"');
    });

    it('should handle nested children', () => {
      const tree = {
        role: 'document',
        name: 'Page',
        children: [
          { role: 'heading', name: 'Title', level: 1 },
          { role: 'button', name: 'Click' },
        ],
      };
      const result = formatA11yNode(tree);
      assert.ok(result.includes('- document "Page"'));
      assert.ok(result.includes('  - heading "Title" level=1'));
      assert.ok(result.includes('  - button "Click"'));
    });

    it('should handle null input', () => {
      assert.equal(formatA11yNode(null), '');
    });
  });

  describe('CLI usage', () => {
    it('should show usage for unknown command', () => {
      try {
        run('unknowncmd');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('Unknown command') || err.status === 1);
      }
    });
  });
});

// ============================================================
// Integration tests (launch real Chrome)
// ============================================================

describe('browser.cjs integration tests', () => {

  describe('start command', () => {
    let sessionId;

    afterEach(() => {
      if (sessionId) {
        try { run(`stop ${sessionId}`); } catch (_) {}
        sessionId = null;
      }
    });

    it('should start a browser and return session info', () => {
      const result = run('start');
      assert.equal(result.ok, true);
      assert.ok(result.sessionId);
      assert.ok(result.pid);
      assert.ok(result.wsEndpoint);
      assert.ok(result.debugPort);
      assert.ok(result.viewport);
      sessionId = result.sessionId;
    });

    it('--session-id-only should return just the ID', () => {
      const result = run('start --session-id-only');
      assert.match(result, /^[0-9a-f]{6}$/);
      sessionId = result;
    });

    it('--viewport should set custom dimensions', () => {
      const result = run('start --viewport 800x600');
      assert.equal(result.viewport.width, 800);
      assert.equal(result.viewport.height, 600);
      sessionId = result.sessionId;
    });
  });

  describe('navigate command', () => {
    let sessionId;

    before(() => {
      sessionId = run('start --session-id-only');
    });

    after(() => {
      try { run(`stop ${sessionId}`); } catch (_) {}
    });

    it('should navigate to a URL and return title', () => {
      const result = run(`navigate ${sessionId} https://example.com`);
      assert.equal(result.ok, true);
      assert.equal(result.title, 'Example Domain');
    });

    it('should support --wait-for text', () => {
      const result = run(`navigate ${sessionId} https://example.com --wait-for "Example Domain"`);
      assert.equal(result.ok, true);
    });

    it('should error on invalid session', () => {
      try {
        run('navigate nonexist999 https://example.com');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.status === 1);
      }
    });
  });

  describe('screenshot command', () => {
    let sessionId;
    let screenshotPath;

    before(() => {
      sessionId = run('start --session-id-only');
      run(`navigate ${sessionId} https://example.com`);
      screenshotPath = path.join(os.tmpdir(), `fe-test-screenshot-${Date.now()}.png`);
    });

    after(() => {
      try { fs.unlinkSync(screenshotPath); } catch (_) {}
      try { run(`stop ${sessionId}`); } catch (_) {}
    });

    it('should capture a screenshot to file', () => {
      const result = run(`screenshot ${sessionId} ${screenshotPath}`);
      assert.equal(result.ok, true);
      assert.ok(fs.existsSync(result.path));
      const stats = fs.statSync(result.path);
      assert.ok(stats.size > 1000, 'Screenshot should be a real image (> 1KB)');
    });

    it('should support --full-page', () => {
      const fpPath = screenshotPath + '.fullpage.png';
      try {
        const result = run(`screenshot ${sessionId} ${fpPath} --full-page`);
        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(fpPath));
      } finally {
        try { fs.unlinkSync(fpPath); } catch (_) {}
      }
    });
  });

  describe('eval command', () => {
    let sessionId;

    before(() => {
      sessionId = run('start --session-id-only');
      run(`navigate ${sessionId} https://example.com`);
    });

    after(() => {
      try { run(`stop ${sessionId}`); } catch (_) {}
    });

    it('should evaluate a simple expression', () => {
      const result = run(`eval ${sessionId} "document.title"`);
      assert.equal(result.ok, true);
      assert.equal(result.result, 'Example Domain');
    });

    it('should evaluate and return object', () => {
      const result = run(`eval ${sessionId} "({a:1, b:'hello'})"`);
      assert.equal(result.ok, true);
      assert.deepEqual(result.result, { a: 1, b: 'hello' });
    });

    it('should handle --stdin for complex scripts', () => {
      const script = '(() => { return document.querySelector("h1").textContent; })()';
      const result = JSON.parse(execSync(
        `echo '${script}' | node ${browserCjs} eval ${sessionId} --stdin`,
        { encoding: 'utf8', timeout: 10000 }
      ).trim());
      assert.equal(result.ok, true);
      assert.equal(result.result, 'Example Domain');
    });
  });

  describe('snapshot command', () => {
    let sessionId;

    before(() => {
      sessionId = run('start --session-id-only');
      run(`navigate ${sessionId} https://example.com`);
    });

    after(() => {
      try { run(`stop ${sessionId}`); } catch (_) {}
    });

    it('should return accessibility tree as text', () => {
      const result = run(`snapshot ${sessionId}`);
      assert.equal(result.ok, true);
      assert.ok(result.snapshot.includes('Example Domain'));
      assert.ok(result.snapshot.includes('heading'));
    });

    it('should save to file with --file', () => {
      const filePath = path.join(os.tmpdir(), `fe-test-snapshot-${Date.now()}.txt`);
      try {
        const result = run(`snapshot ${sessionId} --file ${filePath}`);
        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(filePath));
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes('Example Domain'));
      } finally {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
    });
  });

  describe('stop command', () => {
    it('should stop browser and clean up', () => {
      const sid = run('start --session-id-only');
      // Verify session exists
      assert.ok(readSession(sid));
      // Stop
      const result = run(`stop ${sid}`);
      assert.equal(result.ok, true);
      assert.equal(result.cleaned, true);
      // Verify session removed
      assert.equal(readSession(sid), null);
    });

    it('should handle already-stopped session gracefully', () => {
      const sid = run('start --session-id-only');
      run(`stop ${sid}`);
      // Stop again
      const result = run(`stop ${sid}`);
      assert.equal(result.ok, true);
    });
  });

  describe('list command', () => {
    it('should list active sessions', () => {
      const sid = run('start --session-id-only');
      try {
        const result = run('list');
        assert.equal(result.ok, true);
        assert.ok(Array.isArray(result.sessions));
        const found = result.sessions.find(s => s.sessionId === sid);
        assert.ok(found, 'Should find the active session');
      } finally {
        try { run(`stop ${sid}`); } catch (_) {}
      }
    });
  });

  describe('cleanup command', () => {
    it('should clean up dead sessions', () => {
      // Create a fake session with a dead PID
      const fakeId = 'fake' + generateSessionId().slice(0, 2);
      writeSession(fakeId, {
        pid: 999999, // almost certainly dead
        wsEndpoint: 'ws://localhost:1/fake',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      });
      const result = run('cleanup --max-age 1');
      assert.equal(result.ok, true);
      assert.ok(
        result.alreadyDead.includes(fakeId) || result.cleaned.includes(fakeId),
        'Fake session should be cleaned'
      );
    });
  });
});

// ============================================================
// Parallel isolation test (the whole point)
// ============================================================

describe('parallel isolation', () => {
  const sessions = [];

  after(() => {
    for (const sid of sessions) {
      try { run(`stop ${sid}`); } catch (_) {}
    }
  });

  it('two parallel sessions should be fully isolated', async () => {
    // Use data: URIs to avoid network dependency
    const page1 = 'data:text/html,<html><head><title>Page Alpha</title></head><body><h1>Alpha</h1></body></html>';
    const page2 = 'data:text/html,<html><head><title>Page Beta</title></head><body><h1>Beta</h1><p>Extra content here</p></body></html>';

    // Start two sessions
    const s1 = run('start --session-id-only');
    const s2 = run('start --session-id-only');
    sessions.push(s1, s2);

    // Navigate both in parallel (using child processes)
    const navigate = (sid, url) => new Promise((resolve, reject) => {
      const proc = spawn('node', [browserCjs, 'navigate', sid, url], { stdio: 'pipe' });
      let out = '';
      proc.stdout.on('data', d => out += d);
      proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)));
    });

    await Promise.all([navigate(s1, page1), navigate(s2, page2)]);

    // Verify each session has its own page
    const title1 = run(`eval ${s1} "document.title"`);
    const title2 = run(`eval ${s2} "document.title"`);

    assert.equal(title1.result, 'Page Alpha', 'Session 1 should have Page Alpha');
    assert.equal(title2.result, 'Page Beta', 'Session 2 should have Page Beta');

    // Take screenshots and verify they are different
    const ss1 = path.join(os.tmpdir(), `fe-iso-test-1-${Date.now()}.png`);
    const ss2 = path.join(os.tmpdir(), `fe-iso-test-2-${Date.now()}.png`);
    try {
      run(`screenshot ${s1} ${ss1}`);
      run(`screenshot ${s2} ${ss2}`);

      const size1 = fs.statSync(ss1).size;
      const size2 = fs.statSync(ss2).size;
      // Different pages should produce different screenshots
      assert.notEqual(size1, size2, 'Screenshots should differ in size (different pages)');
    } finally {
      try { fs.unlinkSync(ss1); } catch (_) {}
      try { fs.unlinkSync(ss2); } catch (_) {}
    }
  });
});
