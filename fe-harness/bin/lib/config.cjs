'use strict';

const path = require('path');
const { getFeDir, readJSON, writeJSON, autoParse } = require('./core.cjs');

function configPath(root) {
  return path.join(getFeDir(root), 'config.jsonc');
}

function getConfig(root) {
  const cfg = readJSON(configPath(root));
  if (!cfg) {
    return { error: 'config.jsonc not found. Run `npx fe-harness` to install.' };
  }
  return cfg;
}

function setConfig(root, key, value) {
  const cfg = getConfig(root);
  if (cfg.error) return cfg;

  const parsed = autoParse(value);
  cfg[key] = parsed;
  writeJSON(configPath(root), cfg);
  return { ok: true, key, value: parsed };
}

function initConfig(root, config) {
  const feDir = getFeDir(root);
  writeJSON(path.join(feDir, 'config.jsonc'), config);
  return { ok: true, path: path.join(feDir, 'config.jsonc') };
}

module.exports = { getConfig, setConfig, initConfig, configPath };
