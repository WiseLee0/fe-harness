'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const MIN_LEVEL = LEVELS.INFO;

const LOG_FILENAME = 'runtime.log';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

let _root = null;
let _logPath = null;
let _fd = null;

function timestamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace('T', ' ');
}

/**
 * Open the log file on demand. Creates .fe-runtime/ and the file only when
 * the first log entry is actually written.
 */
function _ensureFd() {
  if (_fd) return true;
  if (!_root) return false;

  const runtimeDir = path.join(_root, '.fe-runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  _logPath = path.join(runtimeDir, LOG_FILENAME);
  _fd = fs.openSync(_logPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o644);

  _rotateIfNeeded();
  return true;
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE.
 * Keeps one backup: runtime.log → runtime.log.bak (overwrites previous backup).
 */
function _rotateIfNeeded() {
  if (!_logPath) return;
  try {
    const stat = fs.statSync(_logPath);
    if (stat.size < MAX_LOG_SIZE) return;
  } catch (_) {
    return; // file gone — will be recreated on next write
  }
  // Close current fd before rotating
  if (_fd) { try { fs.closeSync(_fd); } catch (_) {} _fd = null; }
  const bakPath = _logPath + '.bak';
  try { fs.renameSync(_logPath, bakPath); } catch (_) {}
  // Reopen (creates a fresh file)
  _fd = fs.openSync(_logPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o644);
}

/**
 * Initialize logger. Only records the project root — the log file is created
 * lazily on the first log() call, so no files are touched in projects that
 * never actually produce log output.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
function initLogger(root) {
  if (_root) return _logPath;
  // Only enable logging for projects that have been initialized with fe-harness
  if (!fs.existsSync(path.join(root, '.fe', 'config.jsonc'))) return null;
  _root = root;
  return null;
}

/**
 * Write a log entry.
 * The log file is created on the first call (lazy init).
 * Uses writeSync with O_APPEND fd — POSIX guarantees atomic append for writes
 * ≤ PIPE_BUF (typically 4096 bytes). Log lines are well within this limit.
 *
 * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
 * @param {string} category  e.g. 'init', 'task', 'wave', 'scoring', 'browser'
 * @param {string} message
 * @param {object} [data]    optional structured data
 */
function log(level, category, message, data) {
  if (LEVELS[level] < MIN_LEVEL) return;
  if (!_ensureFd()) return;

  const dataStr = data !== undefined ? ' ' + JSON.stringify(data) : '';
  const line = `[${timestamp()}] [${level}] [${category}] ${message}${dataStr}\n`;
  fs.writeSync(_fd, line);
}

/** Return current log file path, or null if not initialized. */
function getLogPath() {
  return _logPath;
}

/** Close the log file descriptor. */
function closeLogger() {
  if (_fd) {
    fs.closeSync(_fd);
    _fd = null;
  }
}

module.exports = { initLogger, log, getLogPath, closeLogger };
