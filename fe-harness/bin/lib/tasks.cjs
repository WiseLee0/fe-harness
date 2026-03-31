'use strict';

const fs = require('fs');
const path = require('path');
const { getRuntimeDir, getContextDir, getLogFile, ensureDir, readJSON, writeJSON, autoParse, timestamp } = require('./core.cjs');

function tasksPath(root) {
  return path.join(getRuntimeDir(root), 'tasks.json');
}

function loadTasks(root) {
  const tasks = readJSON(tasksPath(root));
  if (!tasks) return [];
  return Array.isArray(tasks) ? tasks : [];
}

function saveTasks(root, tasks) {
  writeJSON(tasksPath(root), tasks);
}

function resetTaskFields(task) {
  task.status = 'pending';
  task.verifyPassed = false;
  task.retryCount = 0;
  task.bestScore = 0;
  task.bestScoresJSON = null;
  task.lastError = '';
  task.startedAt = '';
  task.completedAt = '';
  task.executorFinishedAt = '';
}

function listTasks(root) {
  return loadTasks(root);
}

function getTask(root, id) {
  const tasks = loadTasks(root);
  const task = tasks.find(t => t.id === Number(id));
  return task || { error: `Task #${id} not found` };
}

function updateTask(root, id, field, value) {
  const tasks = loadTasks(root);
  const idx = tasks.findIndex(t => t.id === Number(id));
  if (idx === -1) return { error: `Task #${id} not found` };

  tasks[idx][field] = autoParse(value);
  if (field === 'status' && value === 'in_progress' && !tasks[idx].startedAt) {
    tasks[idx].startedAt = timestamp();
  }
  if (field === 'status' && value === 'done') {
    tasks[idx].completedAt = timestamp();
  }
  saveTasks(root, tasks);
  return { ok: true, id: Number(id), field, value };
}

// --- Next task selection (dependency-aware) ---

function getNextTask(root) {
  const tasks = loadTasks(root);

  // First: any in_progress task
  const inProgress = tasks.find(t => t.status === 'in_progress');
  if (inProgress) return inProgress;

  // Then: first pending task with all dependencies satisfied
  for (const task of tasks) {
    if (task.status !== 'pending') continue;

    const deps = task.dependsOn || [];
    const allSatisfied = deps.every(depId => {
      const dep = tasks.find(t => t.id === depId);
      return dep && dep.status === 'done';
    });

    if (allSatisfied) return task;
  }

  return { done: true, message: 'All tasks completed or no executable task available' };
}

// --- Failure propagation ---

function propagateFailure(root, failedId) {
  const tasks = loadTasks(root);
  const failedTask = tasks.find(t => t.id === Number(failedId));
  if (!failedTask) return { error: `Task #${failedId} not found` };

  const skipped = [];

  function markDependents(id) {
    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      const deps = task.dependsOn || [];
      if (deps.includes(Number(id))) {
        task.status = 'skipped';
        task.lastError = `依赖任务失败: ${failedTask.name} (#${failedId})`;
        skipped.push(task.id);
        markDependents(task.id);
      }
    }
  }

  markDependents(Number(failedId));
  saveTasks(root, tasks);
  return { ok: true, skipped };
}

// --- Batch operations ---

function failTask(root, id, errorMsg) {
  const tasks = loadTasks(root);
  const failedId = Number(id);
  const failedTask = tasks.find(t => t.id === failedId);
  if (!failedTask) return { error: `Task #${id} not found` };

  failedTask.status = 'failed';
  failedTask.lastError = errorMsg || '';

  const skipped = [];
  function markDependents(tid) {
    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      if ((task.dependsOn || []).includes(tid)) {
        task.status = 'skipped';
        task.lastError = `依赖任务失败: ${failedTask.name} (#${failedId})`;
        skipped.push(task.id);
        markDependents(task.id);
      }
    }
  }
  markDependents(failedId);

  saveTasks(root, tasks);
  return { ok: true, id: failedId, skipped };
}

function completeTasks(root, ids) {
  const tasks = loadTasks(root);
  const completed = [];
  for (const id of ids) {
    const idx = tasks.findIndex(t => t.id === Number(id));
    if (idx === -1) continue;
    tasks[idx].status = 'done';
    tasks[idx].verifyPassed = true;
    tasks[idx].completedAt = timestamp();
    completed.push(Number(id));
  }
  saveTasks(root, tasks);
  return { ok: true, completed };
}

function saveRetryState(root, id, data) {
  const tasks = loadTasks(root);
  const idx = tasks.findIndex(t => t.id === Number(id));
  if (idx === -1) return { error: `Task #${id} not found` };

  if (data.retryCount !== undefined) tasks[idx].retryCount = data.retryCount;
  if (data.bestScore !== undefined) tasks[idx].bestScore = data.bestScore;
  if (data.bestScoresJSON !== undefined) tasks[idx].bestScoresJSON = data.bestScoresJSON;
  saveTasks(root, tasks);
  return { ok: true, id: Number(id) };
}

// --- Reset ---

function resetTask(root, id) {
  const tasks = loadTasks(root);
  const idx = tasks.findIndex(t => t.id === Number(id));
  if (idx === -1) return { error: `Task #${id} not found` };

  resetTaskFields(tasks[idx]);
  saveTasks(root, tasks);
  return { ok: true, id: Number(id) };
}

function resetAllFailed(root) {
  const tasks = loadTasks(root);
  const resetIds = [];

  for (const task of tasks) {
    if (task.status === 'failed' || task.status === 'skipped') {
      resetTaskFields(task);
      resetIds.push(task.id);
    }
  }

  saveTasks(root, tasks);
  return { ok: true, reset: resetIds };
}

// --- Wave grouping (topological level sort) ---

function getWaves(root, preloadedTasks) {
  const tasks = preloadedTasks || loadTasks(root);
  if (tasks.length === 0) return { waves: {}, waveOrder: [], taskCount: 0 };

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // Assign wave numbers via topological-level sort
  const waveOf = new Map();
  const circularDeps = [];

  function computeWave(id, visited) {
    if (waveOf.has(id)) return waveOf.get(id);
    if (visited.has(id)) {
      // Circular dependency detected — record warning and break cycle
      const cycle = [...visited, id].map(Number);
      circularDeps.push(cycle);
      waveOf.set(id, 1);
      return 1;
    }
    visited.add(id);

    const task = taskMap.get(id);
    const deps = (task && task.dependsOn) || [];
    if (deps.length === 0) {
      waveOf.set(id, 1);
      return 1;
    }

    let maxDepWave = 0;
    for (const depId of deps) {
      if (!taskMap.has(depId)) continue; // skip missing deps
      maxDepWave = Math.max(maxDepWave, computeWave(depId, visited));
    }
    // If waveOf was already set during cycle detection inside the recursive
    // calls above, keep that value — do not overwrite it.
    if (waveOf.has(id)) return waveOf.get(id);
    const wave = maxDepWave + 1;
    waveOf.set(id, wave);
    return wave;
  }

  for (const task of tasks) {
    computeWave(task.id, new Set());
  }

  // Group tasks by wave
  const waves = {};
  for (const task of tasks) {
    const wave = waveOf.get(task.id);
    if (!waves[wave]) waves[wave] = [];
    waves[wave].push({
      id: task.id,
      name: task.name,
      status: task.status,
      type: task.figmaUrl ? 'design' : 'logic',
      dependsOn: task.dependsOn || [],
    });
  }

  const waveOrder = Object.keys(waves).map(Number).sort((a, b) => a - b);

  // Summary for each wave
  const waveSummary = {};
  let completedWaves = 0;
  let completedTasks = 0;
  for (const w of waveOrder) {
    const waveTasks = waves[w];
    const done = waveTasks.filter(t => t.status === 'done').length;
    const allDone = done === waveTasks.length;
    if (allDone) completedWaves++;
    completedTasks += done;
    waveSummary[w] = {
      total: waveTasks.length,
      pending: waveTasks.filter(t => t.status === 'pending').length,
      done,
      failed: waveTasks.filter(t => t.status === 'failed' || t.status === 'skipped').length,
      allDone,
      tasks: waveTasks,
    };
  }

  const remaining = tasks.length - completedTasks;

  // Circular dependency warning
  let circularWarning = null;
  if (circularDeps.length > 0) {
    const cycles = circularDeps.map(c => c.join(' → ')).join('; ');
    circularWarning = `⚠️ 检测到循环依赖（已自动打破）: ${cycles}。受影响的任务可能在同一 wave 中并行执行，请检查 dependsOn 配置。`;
  }

  return {
    waves: waveSummary,
    waveOrder,
    taskCount: tasks.length,
    completedWaves,
    completedTasks,
    remaining,
    circularWarning,
  };
}

// --- File conflict detection for parallel execution ---

function checkConflicts(root, preloadedTasks) {
  const tasks = preloadedTasks || loadTasks(root);
  if (tasks.length === 0) return { conflicts: [], hasConflicts: false };

  const waveResult = getWaves(root, tasks);
  const conflicts = [];

  for (const waveNum of waveResult.waveOrder) {
    const waveTasks = waveResult.waves[waveNum].tasks;
    if (waveTasks.length <= 1) continue;

    // Build file-to-tasks map for this wave
    const fileOwners = new Map();
    for (const wt of waveTasks) {
      const task = tasks.find(t => t.id === wt.id);
      const files = (task && task.filesModified) || [];
      for (const file of files) {
        if (!fileOwners.has(file)) fileOwners.set(file, []);
        fileOwners.get(file).push(wt.id);
      }
    }

    // Find conflicts (files owned by multiple tasks in same wave)
    for (const [file, owners] of fileOwners) {
      if (owners.length > 1) {
        conflicts.push({
          wave: waveNum,
          file,
          tasks: owners,
        });
      }
    }
  }

  return {
    conflicts,
    hasConflicts: conflicts.length > 0,
  };
}

// --- Auto-resolve file conflicts by adding dependencies ---

function resolveConflicts(root) {
  const tasks = loadTasks(root);
  const { conflicts, hasConflicts } = checkConflicts(root, tasks);
  if (!hasConflicts) return { ok: true, resolved: 0 };
  const added = [];

  // Group conflicts by wave
  const conflictsByWave = new Map();
  for (const c of conflicts) {
    if (!conflictsByWave.has(c.wave)) conflictsByWave.set(c.wave, []);
    conflictsByWave.get(c.wave).push(c);
  }

  for (const [, waveConflicts] of conflictsByWave) {
    // Collect all conflicting task pairs — sort first to build a
    // deterministic chain (1→2→3) so all tasks end up in different waves.
    const pairs = new Set();
    for (const c of waveConflicts) {
      const sorted = [...c.tasks].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length - 1; i++) {
        pairs.add(`${sorted[i]}:${sorted[i + 1]}`);
      }
    }

    for (const pair of pairs) {
      const [earlierId, laterId] = pair.split(':').map(Number);
      const laterTask = tasks.find(t => t.id === laterId);
      if (laterTask) {
        if (!laterTask.dependsOn) laterTask.dependsOn = [];
        if (!laterTask.dependsOn.includes(earlierId)) {
          laterTask.dependsOn.push(earlierId);
          added.push({ from: laterId, dependsOn: earlierId });
        }
      }
    }
  }

  saveTasks(root, tasks);
  return { ok: true, resolved: added.length, added };
}

// --- Status overview ---

function getStatus(root) {
  const tasks = loadTasks(root);
  const summary = {
    total: tasks.length,
    pending: 0,
    in_progress: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    tasks: [],
  };

  for (const task of tasks) {
    summary[task.status] = (summary[task.status] || 0) + 1;
    summary.tasks.push({
      id: task.id,
      name: task.name,
      status: task.status,
      type: task.figmaUrl ? 'design' : 'logic',
      retryCount: task.retryCount || 0,
      verifyPassed: task.verifyPassed || false,
    });
  }

  return summary;
}

function updateTaskJSON(root, id, field, jsonValue) {
  const tasks = loadTasks(root);
  const idx = tasks.findIndex(t => t.id === Number(id));
  if (idx === -1) return { error: `Task #${id} not found` };

  tasks[idx][field] = jsonValue;
  saveTasks(root, tasks);
  return { ok: true, id: Number(id), field };
}

// --- Completion summary ---

function getCompletionSummary(root) {
  const tasks = loadTasks(root);
  if (tasks.length === 0) return { error: 'No tasks found' };

  const pending = tasks.filter(t => t.status === 'pending');
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const done = tasks.filter(t => t.status === 'done');
  const failed = tasks.filter(t => t.status === 'failed');
  const skipped = tasks.filter(t => t.status === 'skipped');

  const unfinished = [...pending, ...inProgress];
  const isAllFinished = unfinished.length === 0;

  // Score stats from done tasks
  const scores = done.filter(t => t.bestScore > 0).map(t => t.bestScore);
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

  // Task type breakdown
  const designTasks = tasks.filter(t => !!t.figmaUrl);
  const logicTasks = tasks.filter(t => !t.figmaUrl);
  const designDone = designTasks.filter(t => t.status === 'done').length;
  const logicDone = logicTasks.filter(t => t.status === 'done').length;

  // Total retries
  const totalRetries = tasks.reduce((sum, t) => sum + (t.retryCount || 0), 0);

  // Duration calculation
  const startTimes = tasks
    .filter(t => t.startedAt)
    .map(t => new Date(t.startedAt).getTime())
    .filter(t => !isNaN(t));
  const endTimes = tasks
    .filter(t => t.completedAt)
    .map(t => new Date(t.completedAt).getTime())
    .filter(t => !isNaN(t));
  const earliestStart = startTimes.length > 0 ? Math.min(...startTimes) : 0;
  const latestEnd = endTimes.length > 0 ? Math.max(...endTimes) : 0;
  const totalDurationMs = earliestStart && latestEnd ? latestEnd - earliestStart : 0;

  // Format duration as human readable
  function formatDuration(ms) {
    if (ms <= 0) return '-';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  // Per-task durations
  const taskDurations = tasks.map(t => {
    const s = t.startedAt ? new Date(t.startedAt).getTime() : 0;
    const e = t.completedAt ? new Date(t.completedAt).getTime() : 0;
    return (s && e) ? e - s : 0;
  });

  // Warnings for failed/skipped tasks
  const warnings = [];
  for (const t of failed) {
    warnings.push({ id: t.id, name: t.name, status: 'failed', error: t.lastError || '' });
  }
  for (const t of skipped) {
    warnings.push({ id: t.id, name: t.name, status: 'skipped', error: t.lastError || '' });
  }

  return {
    isAllFinished,
    total: tasks.length,
    done: done.length,
    failed: failed.length,
    skipped: skipped.length,
    pending: pending.length,
    inProgress: inProgress.length,
    designTasks: { total: designTasks.length, done: designDone },
    logicTasks: { total: logicTasks.length, done: logicDone },
    scores: { avg: avgScore, min: minScore, max: maxScore },
    totalRetries,
    duration: {
      totalMs: totalDurationMs,
      totalFormatted: formatDuration(totalDurationMs),
      startedAt: earliestStart ? new Date(earliestStart).toISOString() : '',
      completedAt: latestEnd ? new Date(latestEnd).toISOString() : '',
    },
    warnings,
    hasWarnings: warnings.length > 0,
    completedAt: timestamp(),
    tasks: tasks.map((t, i) => {
      const s = t.startedAt ? new Date(t.startedAt).getTime() : 0;
      const ef = t.executorFinishedAt ? new Date(t.executorFinishedAt).getTime() : 0;
      const execDurationMs = (s && ef) ? ef - s : 0;
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        type: t.figmaUrl ? 'design' : 'logic',
        bestScore: t.bestScore || 0,
        retryCount: t.retryCount || 0,
        startedAt: t.startedAt || '',
        executorFinishedAt: t.executorFinishedAt || '',
        completedAt: t.completedAt || '',
        executorDuration: formatDuration(execDurationMs),
        duration: formatDuration(taskDurations[i]),
      };
    }),
  };
}

// --- Archive tasks ---

function archiveTasks(root) {
  const srcPath = tasksPath(root);
  if (!fs.existsSync(srcPath)) return { error: 'No tasks.json to archive' };

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const historyDir = path.join(getRuntimeDir(root), 'history');
  const archiveDir = path.join(historyDir, stamp);

  ensureDir(archiveDir);

  // Copy tasks.json
  fs.copyFileSync(srcPath, path.join(archiveDir, 'tasks.json'));

  // Copy context files if they exist
  const contextDir = getContextDir(root);
  if (fs.existsSync(contextDir)) {
    const contextFiles = fs.readdirSync(contextDir);
    if (contextFiles.length > 0) {
      const archiveContextDir = path.join(archiveDir, 'context');
      ensureDir(archiveContextDir);
      for (const f of contextFiles) {
        fs.copyFileSync(path.join(contextDir, f), path.join(archiveContextDir, f));
      }
    }
  }

  // Copy log file if it exists
  const logFile = getLogFile(root);
  if (fs.existsSync(logFile)) {
    fs.copyFileSync(logFile, path.join(archiveDir, 'runtime.log'));
  }
  // Also copy .bak if it exists
  const logBak = logFile + '.bak';
  if (fs.existsSync(logBak)) {
    fs.copyFileSync(logBak, path.join(archiveDir, 'runtime.log.bak'));
  }

  // Clean up: remove tasks.json, context files, and log file
  fs.unlinkSync(srcPath);
  const contextDirPath = getContextDir(root);
  if (fs.existsSync(contextDirPath)) {
    for (const f of fs.readdirSync(contextDirPath)) {
      fs.unlinkSync(path.join(contextDirPath, f));
    }
  }
  // Clean log file
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
  if (fs.existsSync(logBak)) fs.unlinkSync(logBak);

  return {
    ok: true,
    archiveDir: path.relative(root, archiveDir),
    timestamp: stamp,
  };
}

module.exports = {
  loadTasks,
  saveTasks,
  tasksPath,
  listTasks,
  getTask,
  updateTask,
  updateTaskJSON,
  getNextTask,
  getWaves,
  checkConflicts,
  resolveConflicts,
  propagateFailure,
  failTask,
  completeTasks,
  saveRetryState,
  resetTask,
  resetAllFailed,
  getStatus,
  getCompletionSummary,
  archiveTasks,
};
