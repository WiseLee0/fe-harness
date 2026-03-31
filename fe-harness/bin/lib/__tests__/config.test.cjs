'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getConfig, setConfig, initConfig, configPath } = require('../config.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('configPath', () => {
  it('should return correct path', () => {
    assert.equal(configPath(tmpDir), path.join(tmpDir, '.fe', 'config.jsonc'));
  });
});

describe('getConfig', () => {
  it('should return error when config does not exist', () => {
    const result = getConfig(tmpDir);
    assert.ok(result.error);
    assert.ok(result.error.includes('config.jsonc not found'));
  });

  it('should return config when file exists', () => {
    const cfgDir = path.join(tmpDir, '.fe');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'config.jsonc'), JSON.stringify({ maxRetries: 5 }));
    const result = getConfig(tmpDir);
    assert.equal(result.maxRetries, 5);
  });
});

describe('initConfig', () => {
  it('should create config file with provided data', () => {
    const config = { devServerCommand: 'npm run dev' };
    const result = initConfig(tmpDir, config);
    assert.equal(result.ok, true);

    const saved = JSON.parse(fs.readFileSync(configPath(tmpDir), 'utf8'));
    assert.equal(saved.devServerCommand, 'npm run dev');
  });
});

describe('setConfig', () => {
  beforeEach(() => {
    initConfig(tmpDir, { maxRetries: 5, devServerCommand: '' });
  });

  it('should set a string value', () => {
    const result = setConfig(tmpDir, 'devServerCommand', 'pnpm dev');
    assert.equal(result.ok, true);
    assert.equal(result.value, 'pnpm dev');

    const cfg = getConfig(tmpDir);
    assert.equal(cfg.devServerCommand, 'pnpm dev');
  });

  it('should auto-parse boolean true', () => {
    const result = setConfig(tmpDir, 'someFlag', 'true');
    assert.equal(result.value, true);
  });

  it('should auto-parse boolean false', () => {
    const result = setConfig(tmpDir, 'someFlag', 'false');
    assert.equal(result.value, false);
  });

  it('should auto-parse numbers', () => {
    const result = setConfig(tmpDir, 'maxRetries', '10');
    assert.equal(result.value, 10);
  });

  it('should keep empty string as string', () => {
    const result = setConfig(tmpDir, 'devServerCommand', '');
    assert.equal(result.value, '');
  });

  it('should return error if config not initialized', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-empty-'));
    const result = setConfig(emptyDir, 'key', 'val');
    assert.ok(result.error);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
