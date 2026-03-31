'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getFeDir, getRuntimeDir, getContextDir, ensureDir, readJSON, writeJSON, writeFile, readFile, timestamp } = require('../core.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Path helpers ---

describe('getFeDir', () => {
  it('should return .fe under root', () => {
    assert.equal(getFeDir('/project'), path.join('/project', '.fe'));
  });
});

describe('getRuntimeDir', () => {
  it('should return .fe-runtime under root', () => {
    assert.equal(getRuntimeDir('/project'), path.join('/project', '.fe-runtime'));
  });
});

describe('getContextDir', () => {
  it('should return .fe-runtime/context under root', () => {
    assert.equal(getContextDir('/project'), path.join('/project', '.fe-runtime', 'context'));
  });
});

// --- ensureDir ---

describe('ensureDir', () => {
  it('should create nested directories', () => {
    const dir = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(dir);
    assert.ok(fs.existsSync(dir));
  });

  it('should not throw if directory already exists', () => {
    ensureDir(tmpDir);
    assert.ok(fs.existsSync(tmpDir));
  });
});

// --- readJSON / writeJSON ---

describe('readJSON', () => {
  it('should return null for non-existent file', () => {
    assert.equal(readJSON(path.join(tmpDir, 'nope.json')), null);
  });

  it('should return null for invalid JSON', () => {
    const fp = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(fp, 'not json');
    assert.equal(readJSON(fp), null);
  });

  it('should parse valid JSON', () => {
    const fp = path.join(tmpDir, 'good.json');
    fs.writeFileSync(fp, '{"a":1}');
    assert.deepEqual(readJSON(fp), { a: 1 });
  });
});

describe('writeJSON', () => {
  it('should write JSON and create parent dirs', () => {
    const fp = path.join(tmpDir, 'sub', 'data.json');
    writeJSON(fp, { key: 'value' });
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.deepEqual(data, { key: 'value' });
  });

  it('should produce formatted JSON', () => {
    const fp = path.join(tmpDir, 'fmt.json');
    writeJSON(fp, { a: 1 });
    const raw = fs.readFileSync(fp, 'utf8');
    assert.ok(raw.includes('\n'));
  });

  it('should atomically write (no .tmp left)', () => {
    const fp = path.join(tmpDir, 'atomic.json');
    writeJSON(fp, { x: 1 });
    assert.ok(!fs.existsSync(fp + '.tmp'));
    assert.ok(fs.existsSync(fp));
  });
});

// --- writeFile / readFile ---

describe('writeFile', () => {
  it('should write string content and create parent dirs', () => {
    const fp = path.join(tmpDir, 'nested', 'file.txt');
    writeFile(fp, 'hello');
    assert.equal(fs.readFileSync(fp, 'utf8'), 'hello');
  });
});

describe('readFile', () => {
  it('should return null for non-existent file', () => {
    assert.equal(readFile(path.join(tmpDir, 'nope.txt')), null);
  });

  it('should read file content', () => {
    const fp = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(fp, 'content');
    assert.equal(readFile(fp), 'content');
  });
});

// --- timestamp ---

describe('timestamp', () => {
  it('should return formatted timestamp (YYYY-MM-DD HH:MM:SS)', () => {
    const ts = timestamp();
    assert.match(ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
