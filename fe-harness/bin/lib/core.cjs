'use strict';

const path = require('path');
const fs = require('fs');

// --- Path helpers ---

function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.fe', 'config.jsonc'))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function getFeDir(root) {
  return path.join(root, '.fe');
}

function getRuntimeDir(root) {
  return path.join(root, '.fe-runtime');
}

function getContextDir(root) {
  return path.join(getRuntimeDir(root), 'context');
}

function getLogFile(root) {
  return path.join(getRuntimeDir(root), 'runtime.log');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// --- JSON helpers ---

function stripJsonComments(str) {
  // Only strip comments outside of quoted strings
  let result = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escape) {
      result += ch;
      escape = false;
      continue;
    }
    if (inString) {
      result += ch;
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    // Not in string
    if (ch === '"') {
      inString = true;
      result += ch;
    } else if (ch === '/' && str[i + 1] === '/') {
      // Line comment — skip to end of line
      while (i < str.length && str[i] !== '\n') i++;
      result += '\n';
    } else if (ch === '/' && str[i + 1] === '*') {
      // Block comment — skip to */
      i += 2;
      while (i < str.length - 1 && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i++; // skip past /
    } else {
      result += ch;
    }
  }
  return result;
}

function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(stripJsonComments(raw));
  } catch (e) {
    return null;
  }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

function autoParse(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (!isNaN(value) && value !== '') return Number(value);
  return value;
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

module.exports = {
  findProjectRoot,
  getFeDir,
  getRuntimeDir,
  getContextDir,
  getLogFile,
  ensureDir,
  readJSON,
  writeJSON,
  writeFile,
  readFile,
  autoParse,
  timestamp,
};
