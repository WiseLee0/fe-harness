#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { findProjectRoot, getContextDir, ensureDir } = require('./lib/core.cjs');
const { listTasks, getTask, updateTask, updateTaskJSON, getNextTask, getWaves, checkConflicts, resolveConflicts, propagateFailure, failTask, completeTasks, saveRetryState, resetTask, resetAllFailed, getStatus, getCompletionSummary, archiveTasks } = require('./lib/tasks.cjs');
const { getConfig, setConfig, initConfig } = require('./lib/config.cjs');
const { calculateScore, checkRegression } = require('./lib/scoring.cjs');
const { initLogger, log, getLogPath, closeLogger } = require('./lib/logger.cjs');

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

const root = findProjectRoot();

// Initialize logger (silent no-op if .fe-runtime doesn't exist yet)
try { initLogger(root); } catch (_) { /* ignore — logging is best-effort */ }

function output(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Read JSON from stdin (for --stdin flag).
 * Reads all remaining args after --stdin as space-separated JSON objects,
 * or reads from actual stdin if no inline data follows.
 */
function readStdinSync() {
  return fs.readFileSync('/dev/stdin', 'utf8').trim();
}

function usage() {
  output({
    commands: {
      'tasks list': 'List all tasks',
      'tasks waves': 'Get wave-grouped task execution plan (dependency-based)',
      'tasks check-conflicts': 'Check for file ownership conflicts within waves',
      'tasks resolve-conflicts': 'Auto-resolve conflicts by adding dependencies',
      'tasks next': 'Get next executable task (dependency-aware)',
      'tasks get <id>': 'Get task by ID',
      'tasks update <id> <field> <value>': 'Update a task field',
      'tasks update-json <id> <field> <json>': 'Update a task field with JSON value',
      'tasks propagate-failure <id>': 'Propagate failure to dependent tasks',
      'tasks reset <id>': 'Reset a task to pending',
      'tasks reset-all-failed': 'Reset all failed/skipped tasks',
      'tasks fail <id> [--error "msg"]': 'Mark task failed + set error + propagate failure (atomic)',
      'tasks complete <id1> [id2 ...]': 'Batch-mark tasks as done with verifyPassed=true',
      'tasks summary': 'Get completion summary with stats, scores and warnings',
      'tasks archive': 'Archive tasks.json + context to .fe-runtime/history/ and clean up',
      'tasks save-retry <id> --stdin': 'Update retryCount + bestScore + bestScoresJSON atomically (JSON stdin)',
      'tasks status': 'Get status overview',
      'scoring calculate <type> <scores-json|--stdin>': 'Calculate weighted score (type: design|logic)',
      'scoring check-regression <current-json> <best-json> | --stdin': 'Check for score regression',
      'config get': 'Get project config',
      'config set <key> <value>': 'Set a config value',
      'config init <config-json>': 'Initialize config',
      'init execute': 'Pre-execution checks',
      'init context': 'Ensure context directory exists and is clean',
      'log <level> <category> <message> [json-data]': 'Write a structured log entry (level: INFO|WARN|ERROR)',
    },
  });
}

try {
  switch (command) {
    case 'tasks': {
      switch (subcommand) {
        case 'list':
          output(listTasks(root));
          break;
        case 'next':
          output(getNextTask(root));
          break;
        case 'waves': {
          const wavesResult = getWaves(root);
          log('INFO', 'wave', `Wave 计划: ${wavesResult.waveOrder?.length || 0} 个 wave, ${wavesResult.taskCount || 0} 个任务`, { remaining: wavesResult.remaining, completedWaves: wavesResult.completedWaves });
          output(wavesResult);
          break;
        }
        case 'check-conflicts':
          output(checkConflicts(root));
          break;
        case 'resolve-conflicts': {
          const resolveResult = resolveConflicts(root);
          if (resolveResult.resolved > 0) {
            log('WARN', 'task', `文件冲突已自动解决`, { resolved: resolveResult.resolved, added: resolveResult.added });
          }
          output(resolveResult);
          break;
        }
        case 'get':
          output(getTask(root, args[2]));
          break;
        case 'update': {
          const updateResult = updateTask(root, args[2], args[3], args[4]);
          if (args[3] === 'status') {
            log('INFO', 'task', `任务状态变更 #${args[2]} ${args[3]}=${args[4]}`);
          }
          output(updateResult);
          break;
        }
        case 'update-json': {
          const field = args[3] === '--stdin' ? args[4] : args[3];
          const jsonValue = args[3] === '--stdin' ? JSON.parse(readStdinSync()) : JSON.parse(args[4]);
          output(updateTaskJSON(root, args[2], field, jsonValue));
          break;
        }
        case 'propagate-failure':
          output(propagateFailure(root, args[2]));
          break;
        case 'reset':
          output(resetTask(root, args[2]));
          break;
        case 'reset-all-failed':
          output(resetAllFailed(root));
          break;
        case 'fail': {
          const errIdx = args.indexOf('--error');
          const errorMsg = errIdx >= 0 ? args.slice(errIdx + 1).join(' ') : '';
          const failResult = failTask(root, args[2], errorMsg);
          log('WARN', 'task', `任务失败 #${args[2]}`, { error: errorMsg, skipped: failResult.skipped });
          output(failResult);
          break;
        }
        case 'complete': {
          const completeResult = completeTasks(root, args.slice(2));
          log('INFO', 'task', `任务完成`, { completed: completeResult.completed });
          output(completeResult);
          break;
        }
        case 'save-retry': {
          const retryData = JSON.parse(readStdinSync());
          output(saveRetryState(root, args[2], retryData));
          break;
        }
        case 'status':
          output(getStatus(root));
          break;
        case 'summary': {
          const summaryResult = getCompletionSummary(root);
          log('INFO', 'phase', `complete 阶段 - 生成摘要`, { total: summaryResult.total, done: summaryResult.done, failed: summaryResult.failed });
          output(summaryResult);
          break;
        }
        case 'archive': {
          const archiveResult = archiveTasks(root);
          log('INFO', 'phase', `complete 阶段 - 归档任务`, { archiveDir: archiveResult.archiveDir });
          output(archiveResult);
          break;
        }
        default:
          output({ error: `Unknown tasks subcommand: ${subcommand}` });
      }
      break;
    }

    case 'scoring': {
      const cfg = getConfig(root);
      const thresholds = {
        verifyThreshold: cfg.verifyThreshold || 80,
        reviewThreshold: cfg.reviewThreshold || 80,
        dimensionThreshold: cfg.dimensionThreshold || 6,
        scoreDropTolerance: cfg.scoreDropTolerance || 3,
      };

      switch (subcommand) {
        case 'calculate': {
          const type = args[2]; // 'design' or 'logic'
          let scores;
          if (args[3] === '--stdin') {
            scores = JSON.parse(readStdinSync());
          } else {
            scores = JSON.parse(args[3]);
          }
          const scoreResult = calculateScore(scores, type, thresholds);
          log('INFO', 'scoring', `评分计算 type=${type}`, {
            total_score: scoreResult.total_score,
            passed: scoreResult.passed,
            input_scores: scores,
            failed_dimensions: scoreResult.failed_dimensions,
            warnings: scoreResult.warnings.length > 0 ? scoreResult.warnings : undefined,
          });
          output(scoreResult);
          break;
        }
        case 'check-regression': {
          let current, best;
          if (args[2] === '--stdin') {
            // Read two JSON objects from stdin (newline separated or as array)
            const stdinData = readStdinSync();
            const parts = stdinData.split('\n').filter(Boolean);
            if (parts.length >= 2) {
              current = JSON.parse(parts[0]);
              best = JSON.parse(parts[1]);
            } else {
              const arr = JSON.parse(stdinData);
              current = arr[0];
              best = arr[1];
            }
          } else {
            current = JSON.parse(args[2]);
            best = JSON.parse(args[3]);
          }
          const regResult = checkRegression(current, best, thresholds);
          if (regResult.regressed) {
            log('WARN', 'scoring', `检测到评分回归`, { regressed: regResult.regressed, details: regResult.regressions });
          }
          output(regResult);
          break;
        }
        default:
          output({ error: `Unknown scoring subcommand: ${subcommand}` });
      }
      break;
    }

    case 'config': {
      switch (subcommand) {
        case 'get':
          output(getConfig(root));
          break;
        case 'set':
          output(setConfig(root, args[2], args[3]));
          break;
        case 'init': {
          const initCfgResult = initConfig(root, JSON.parse(args[2]));
          log('INFO', 'phase', `plan 阶段启动`, { config: Object.keys(JSON.parse(args[2])) });
          output(initCfgResult);
          break;
        }
        default:
          output({ error: `Unknown config subcommand: ${subcommand}` });
      }
      break;
    }

    case 'init': {
      switch (subcommand) {
        case 'execute': {
          // Pre-execution checks
          const cfg = getConfig(root);
          if (cfg.error) { output(cfg); break; }
          const tasks = listTasks(root);
          if (tasks.length === 0) { output({ error: 'No tasks found. Run /fe:plan first.' }); break; }

          // Check if any design tasks exist (need dev server)
          const hasDesignTasks = tasks.some(t => !!t.figmaUrl);

          const missing = [];
          if (hasDesignTasks) {
            if (!cfg.devServerCommand) missing.push('devServerCommand');
          }
          if (missing.length > 0) {
            output({ error: `Config incomplete (design tasks require dev server). Missing: ${missing.join(', ')}` });
            break;
          }

          const initResult = {
            ok: true,
            config: cfg,
            taskCount: tasks.length,
            hasDesignTasks,
            pending: tasks.filter(t => t.status === 'pending').length,
            in_progress: tasks.filter(t => t.status === 'in_progress').length,
            done: tasks.filter(t => t.status === 'done').length,
          };
          log('INFO', 'init', `执行初始化完成`, { taskCount: initResult.taskCount, hasDesignTasks, pending: initResult.pending, done: initResult.done });
          output(initResult);
          break;
        }
        case 'context': {
          const contextDir = getContextDir(root);
          ensureDir(contextDir);
          // Optional: pass task IDs to only clean files for specific tasks
          // Usage: fe-tools.cjs init context [id1 id2 ...]
          const taskIds = args.slice(2).map(Number).filter(n => !isNaN(n));

          // Build patterns: if task IDs provided, only match those IDs; otherwise match all
          const idPattern = taskIds.length > 0
            ? `(${taskIds.join('|')})`
            : '\\d+';
          const contextPatterns = [
            new RegExp(`^impl-result-${idPattern}\\.json$`),
            new RegExp(`^verify-result-${idPattern}\\.json$`),
            new RegExp(`^verify-analysis-${idPattern}\\.md$`),
            new RegExp(`^review-result-${idPattern}\\.json$`),
            new RegExp(`^review-analysis-${idPattern}\\.md$`),
            new RegExp(`^fix-result-${idPattern}\\.json$`),
            new RegExp(`^(impl-screenshot|self-check|fix-check)-${idPattern}\\.png$`),
            new RegExp(`^a11y-snapshot-${idPattern}\\.txt$`),
          ];
          // Always clean non-ID-suffixed legacy files and backpressure results
          const legacyPatterns = [
            /^impl-result\.json$/,
            /^verify-result\.json$/,
            /^verify-analysis\.md$/,
            /^review-result\.json$/,
            /^review-analysis\.md$/,
            /^fix-result\.json$/,
            /^fix-result-bp\.json$/,
          ];
          const allPatterns = [...contextPatterns, ...legacyPatterns];

          const files = fs.readdirSync(contextDir);
          let cleaned = 0;
          for (const f of files) {
            if (allPatterns.some(p => p.test(f))) {
              fs.unlinkSync(path.join(contextDir, f));
              cleaned++;
            }
          }
          output({ ok: true, contextDir, cleaned, taskIds: taskIds.length > 0 ? taskIds : 'all' });
          break;
        }
        default:
          output({ error: `Unknown init subcommand: ${subcommand}` });
      }
      break;
    }

    case 'log': {
      const lvl = (args[1] || 'INFO').toUpperCase();
      const cat = args[2] || 'agent';
      const msg = args[3] || '';
      let data;
      if (args[4]) {
        try { data = JSON.parse(args[4]); } catch (_) { data = { raw: args[4] }; }
      }
      log(lvl, cat, msg, data);
      output({ ok: true });
      break;
    }

    default:
      usage();
  }
} catch (err) {
  log('ERROR', 'system', `未捕获异常: ${err.message}`, { stack: err.stack });
  closeLogger();
  output({ error: err.message, stack: err.stack });
  process.exit(1);
} finally {
  closeLogger();
}
