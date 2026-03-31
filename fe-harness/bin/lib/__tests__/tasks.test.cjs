'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { initConfig } = require('../config.cjs');
const {
  listTasks, getTask, updateTask, getNextTask,
  propagateFailure, failTask, completeTasks, saveRetryState,
  resetTask, resetAllFailed, getStatus,
  getWaves, checkConflicts, resolveConflicts, tasksPath, saveTasks,
  getCompletionSummary, archiveTasks,
} = require('../tasks.cjs');

let tmpDir;

function seedTasks(tasks) {
  saveTasks(tmpDir, tasks);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-test-'));
  initConfig(tmpDir, { maxRetries: 5 });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- listTasks ---

describe('listTasks', () => {
  it('should return empty array when no tasks file', () => {
    assert.deepEqual(listTasks(tmpDir), []);
  });

  it('should return all tasks', () => {
    seedTasks([{ id: 1, name: 'A', status: 'pending' }, { id: 2, name: 'B', status: 'done' }]);
    const tasks = listTasks(tmpDir);
    assert.equal(tasks.length, 2);
  });
});

// --- getTask ---

describe('getTask', () => {
  it('should return task by id', () => {
    seedTasks([{ id: 1, name: 'A', status: 'pending' }]);
    const task = getTask(tmpDir, '1');
    assert.equal(task.name, 'A');
  });

  it('should return error for missing task', () => {
    seedTasks([]);
    const result = getTask(tmpDir, '99');
    assert.ok(result.error);
  });
});

// --- updateTask ---

describe('updateTask', () => {
  it('should update a field', () => {
    seedTasks([{ id: 1, name: 'A', status: 'pending' }]);
    const result = updateTask(tmpDir, '1', 'status', 'in_progress');
    assert.equal(result.ok, true);
    assert.equal(getTask(tmpDir, '1').status, 'in_progress');
  });

  it('should set completedAt when status becomes done', () => {
    seedTasks([{ id: 1, name: 'A', status: 'in_progress' }]);
    updateTask(tmpDir, '1', 'status', 'done');
    const task = getTask(tmpDir, '1');
    assert.equal(task.status, 'done');
    assert.ok(task.completedAt);
  });

  it('should auto-parse numbers', () => {
    seedTasks([{ id: 1, name: 'A', status: 'pending', retryCount: 0 }]);
    updateTask(tmpDir, '1', 'retryCount', '3');
    assert.equal(getTask(tmpDir, '1').retryCount, 3);
  });

  it('should return error for missing task', () => {
    seedTasks([]);
    const result = updateTask(tmpDir, '99', 'status', 'done');
    assert.ok(result.error);
  });
});

// --- getNextTask ---

describe('getNextTask', () => {
  it('should return in_progress task first', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending' },
      { id: 2, name: 'B', status: 'in_progress' },
    ]);
    const next = getNextTask(tmpDir);
    assert.equal(next.id, 2);
  });

  it('should return first pending task with all deps done', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'done' },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1] },
      { id: 3, name: 'C', status: 'pending', dependsOn: [1] },
    ]);
    const next = getNextTask(tmpDir);
    assert.equal(next.id, 2);
  });

  it('should skip pending task with unsatisfied deps', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending' },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1] },
    ]);
    const next = getNextTask(tmpDir);
    assert.equal(next.id, 1);
  });

  it('should return done message when all completed', () => {
    seedTasks([{ id: 1, name: 'A', status: 'done' }]);
    const next = getNextTask(tmpDir);
    assert.equal(next.done, true);
  });

  it('should return done message when no tasks', () => {
    seedTasks([]);
    const next = getNextTask(tmpDir);
    assert.equal(next.done, true);
  });

  it('should handle tasks with no dependsOn field', () => {
    seedTasks([{ id: 1, name: 'A', status: 'pending' }]);
    const next = getNextTask(tmpDir);
    assert.equal(next.id, 1);
  });
});

// --- propagateFailure ---

describe('propagateFailure', () => {
  it('should skip direct dependents of failed task', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'failed' },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1] },
      { id: 3, name: 'C', status: 'pending' },
    ]);
    const result = propagateFailure(tmpDir, '1');
    assert.equal(result.ok, true);
    assert.deepEqual(result.skipped, [2]);
    assert.equal(getTask(tmpDir, '2').status, 'skipped');
    assert.equal(getTask(tmpDir, '3').status, 'pending');
  });

  it('should recursively skip transitive dependents', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'failed' },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1] },
      { id: 3, name: 'C', status: 'pending', dependsOn: [2] },
    ]);
    const result = propagateFailure(tmpDir, '1');
    assert.deepEqual(result.skipped, [2, 3]);
  });

  it('should return error for missing task', () => {
    seedTasks([]);
    const result = propagateFailure(tmpDir, '99');
    assert.ok(result.error);
  });
});

// --- failTask ---

describe('failTask', () => {
  it('should set status, error, and propagate in one call', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending' },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1] },
      { id: 3, name: 'C', status: 'pending', dependsOn: [2] },
    ]);
    const result = failTask(tmpDir, '1', 'merge conflict');
    assert.equal(result.ok, true);
    assert.equal(result.id, 1);
    assert.deepEqual(result.skipped, [2, 3]);

    const t1 = getTask(tmpDir, '1');
    assert.equal(t1.status, 'failed');
    assert.equal(t1.lastError, 'merge conflict');
    assert.equal(getTask(tmpDir, '2').status, 'skipped');
    assert.equal(getTask(tmpDir, '3').status, 'skipped');
  });

  it('should default error to empty string', () => {
    seedTasks([{ id: 1, name: 'A', status: 'pending' }]);
    failTask(tmpDir, '1');
    assert.equal(getTask(tmpDir, '1').lastError, '');
  });

  it('should return error for missing task', () => {
    seedTasks([]);
    assert.ok(failTask(tmpDir, '99', 'err').error);
  });
});

// --- completeTasks ---

describe('completeTasks', () => {
  it('should batch-complete multiple tasks', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending' },
      { id: 2, name: 'B', status: 'pending' },
      { id: 3, name: 'C', status: 'pending' },
    ]);
    const result = completeTasks(tmpDir, ['1', '3']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.completed, [1, 3]);

    assert.equal(getTask(tmpDir, '1').status, 'done');
    assert.equal(getTask(tmpDir, '1').verifyPassed, true);
    assert.ok(getTask(tmpDir, '1').completedAt);
    assert.equal(getTask(tmpDir, '2').status, 'pending');
    assert.equal(getTask(tmpDir, '3').status, 'done');
  });

  it('should skip non-existent ids', () => {
    seedTasks([{ id: 1, name: 'A', status: 'pending' }]);
    const result = completeTasks(tmpDir, ['1', '99']);
    assert.deepEqual(result.completed, [1]);
  });
});

// --- saveRetryState ---

describe('saveRetryState', () => {
  it('should atomically update retry fields', () => {
    const scores = { layout: 8, spacing: 7 };
    seedTasks([{ id: 1, name: 'A', status: 'in_progress', retryCount: 0, bestScore: 0, bestScoresJSON: null }]);
    const result = saveRetryState(tmpDir, '1', { retryCount: 2, bestScore: 75, bestScoresJSON: scores });
    assert.equal(result.ok, true);

    const task = getTask(tmpDir, '1');
    assert.equal(task.retryCount, 2);
    assert.equal(task.bestScore, 75);
    assert.deepEqual(task.bestScoresJSON, scores);
  });

  it('should update only provided fields', () => {
    seedTasks([{ id: 1, name: 'A', status: 'in_progress', retryCount: 1, bestScore: 50, bestScoresJSON: null }]);
    saveRetryState(tmpDir, '1', { retryCount: 2 });
    const task = getTask(tmpDir, '1');
    assert.equal(task.retryCount, 2);
    assert.equal(task.bestScore, 50);
    assert.equal(task.bestScoresJSON, null);
  });

  it('should return error for missing task', () => {
    seedTasks([]);
    assert.ok(saveRetryState(tmpDir, '99', { retryCount: 1 }).error);
  });
});

// --- resetTask ---

describe('resetTask', () => {
  it('should reset task to pending', () => {
    seedTasks([{ id: 1, name: 'A', status: 'failed', retryCount: 3, lastError: 'err', completedAt: '2024-01-01' }]);
    const result = resetTask(tmpDir, '1');
    assert.equal(result.ok, true);

    const task = getTask(tmpDir, '1');
    assert.equal(task.status, 'pending');
    assert.equal(task.retryCount, 0);
    assert.equal(task.lastError, '');
    assert.equal(task.completedAt, '');
  });

  it('should return error for missing task', () => {
    seedTasks([]);
    assert.ok(resetTask(tmpDir, '99').error);
  });
});

// --- resetAllFailed ---

describe('resetAllFailed', () => {
  it('should reset all failed and skipped tasks', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'failed', retryCount: 2, lastError: 'err' },
      { id: 2, name: 'B', status: 'skipped', retryCount: 0, lastError: 'dep' },
      { id: 3, name: 'C', status: 'done' },
    ]);
    const result = resetAllFailed(tmpDir);
    assert.deepEqual(result.reset, [1, 2]);
    assert.equal(getTask(tmpDir, '1').status, 'pending');
    assert.equal(getTask(tmpDir, '2').status, 'pending');
    assert.equal(getTask(tmpDir, '3').status, 'done');
  });
});

// --- retryCount / bestScore persistence ---

describe('retryCount and bestScore persistence', () => {
  it('should persist retryCount via updateTask', () => {
    seedTasks([{ id: 1, name: 'A', status: 'in_progress', retryCount: 0 }]);
    updateTask(tmpDir, '1', 'retryCount', '3');
    const task = getTask(tmpDir, '1');
    assert.equal(task.retryCount, 3);
  });

  it('should persist bestScore via updateTask', () => {
    seedTasks([{ id: 1, name: 'A', status: 'in_progress', bestScore: 0 }]);
    updateTask(tmpDir, '1', 'bestScore', '75');
    const task = getTask(tmpDir, '1');
    assert.equal(task.bestScore, 75);
  });

  it('should persist complex bestScoresJSON via saveTasks', () => {
    const scores = { layout: 8, spacing: 7, colors: 9, typography: 6, borders: 5, shadows: 4, icons_images: 7, completeness: 8 };
    seedTasks([{ id: 1, name: 'A', status: 'in_progress', bestScoresJSON: scores }]);
    const task = getTask(tmpDir, '1');
    assert.deepEqual(task.bestScoresJSON, scores);
  });
});

// --- resetTask clears bestScore fields ---

describe('resetTask with bestScore fields', () => {
  it('should reset bestScore and bestScoresJSON on reset', () => {
    seedTasks([{
      id: 1, name: 'A', status: 'failed',
      retryCount: 3, bestScore: 65, bestScoresJSON: { layout: 8 },
      lastError: 'err', completedAt: '2024-01-01',
    }]);
    resetTask(tmpDir, '1');
    const task = getTask(tmpDir, '1');
    assert.equal(task.retryCount, 0);
    assert.equal(task.bestScore, 0);
    assert.equal(task.bestScoresJSON, null);
  });
});

// --- getStatus ---

describe('getStatus', () => {
  it('should return correct status summary', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'done' },
      { id: 2, name: 'B', status: 'pending' },
      { id: 3, name: 'C', status: 'in_progress', figmaUrl: 'https://figma.com/...' },
      { id: 4, name: 'D', status: 'failed' },
    ]);
    const status = getStatus(tmpDir);
    assert.equal(status.total, 4);
    assert.equal(status.done, 1);
    assert.equal(status.pending, 1);
    assert.equal(status.in_progress, 1);
    assert.equal(status.failed, 1);
    assert.equal(status.tasks.length, 4);
    assert.equal(status.tasks[2].type, 'design');
    assert.equal(status.tasks[1].type, 'logic');
  });

  it('should return zeros when no tasks', () => {
    seedTasks([]);
    const status = getStatus(tmpDir);
    assert.equal(status.total, 0);
  });
});

// --- getWaves ---

describe('getWaves', () => {
  it('should return empty waves when no tasks', () => {
    seedTasks([]);
    const result = getWaves(tmpDir);
    assert.deepEqual(result.waves, {});
    assert.deepEqual(result.waveOrder, []);
    assert.equal(result.taskCount, 0);
  });

  it('should put all independent tasks in wave 1', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [] },
      { id: 3, name: 'C', status: 'pending', dependsOn: [] },
    ]);
    const result = getWaves(tmpDir);
    assert.deepEqual(result.waveOrder, [1]);
    assert.equal(result.waves[1].total, 3);
  });

  it('should assign correct waves based on dependencies', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [] },
      { id: 3, name: 'C', status: 'pending', dependsOn: [1] },
      { id: 4, name: 'D', status: 'pending', dependsOn: [1, 2] },
      { id: 5, name: 'E', status: 'pending', dependsOn: [3, 4] },
    ]);
    const result = getWaves(tmpDir);
    assert.deepEqual(result.waveOrder, [1, 2, 3]);

    // Wave 1: A, B (no deps)
    assert.equal(result.waves[1].total, 2);
    const w1ids = result.waves[1].tasks.map(t => t.id);
    assert.ok(w1ids.includes(1));
    assert.ok(w1ids.includes(2));

    // Wave 2: C (depends on A), D (depends on A, B)
    assert.equal(result.waves[2].total, 2);
    const w2ids = result.waves[2].tasks.map(t => t.id);
    assert.ok(w2ids.includes(3));
    assert.ok(w2ids.includes(4));

    // Wave 3: E (depends on C, D)
    assert.equal(result.waves[3].total, 1);
    assert.equal(result.waves[3].tasks[0].id, 5);
  });

  it('should handle tasks with no dependsOn field', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending' },
      { id: 2, name: 'B', status: 'pending' },
    ]);
    const result = getWaves(tmpDir);
    assert.deepEqual(result.waveOrder, [1]);
    assert.equal(result.waves[1].total, 2);
  });

  it('should include status summary per wave', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'done', dependsOn: [] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [] },
      { id: 3, name: 'C', status: 'failed', dependsOn: [1] },
    ]);
    const result = getWaves(tmpDir);
    assert.equal(result.waves[1].done, 1);
    assert.equal(result.waves[1].pending, 1);
    assert.equal(result.waves[2].failed, 1);
  });

  it('should handle circular dependencies gracefully', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [2] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1] },
    ]);
    // Should not throw, should assign waves (breaking cycle)
    const result = getWaves(tmpDir);
    assert.ok(result.waveOrder.length > 0);
    assert.equal(result.taskCount, 2);
    // Cycle-broken node should not be overwritten to a higher wave
    const wave1 = result.waves[result.waveOrder[0]];
    assert.ok(wave1.tasks.length >= 1);
    assert.ok(result.circularWarning);
  });

  it('should not overwrite cycle-detected wave assignment', () => {
    // A→B→A: cycle detection sets A=wave1, B should be wave2
    // Without the fix, A would be overwritten to wave3
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [2] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1] },
    ]);
    const result = getWaves(tmpDir);
    // Both tasks should be within the first 2 waves (not wave 3+)
    assert.ok(result.waveOrder.every(w => w <= 2));
  });

  it('should handle 3-node circular dependency', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [3] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1] },
      { id: 3, name: 'C', status: 'pending', dependsOn: [2] },
    ]);
    const result = getWaves(tmpDir);
    assert.equal(result.taskCount, 3);
    assert.ok(result.circularWarning);
    // No task should end up in an unreasonably high wave
    assert.ok(result.waveOrder.every(w => w <= 3));
  });

  it('should include task type in wave tasks', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [], figmaUrl: 'https://figma.com/...' },
      { id: 2, name: 'B', status: 'pending', dependsOn: [] },
    ]);
    const result = getWaves(tmpDir);
    const tasks = result.waves[1].tasks;
    assert.equal(tasks.find(t => t.id === 1).type, 'design');
    assert.equal(tasks.find(t => t.id === 2).type, 'logic');
  });
});

// --- checkConflicts ---

describe('checkConflicts', () => {
  it('should return no conflicts when no file overlap', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [], filesModified: ['src/a.ts'] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [], filesModified: ['src/b.ts'] },
    ]);
    const result = checkConflicts(tmpDir);
    assert.equal(result.hasConflicts, false);
    assert.equal(result.conflicts.length, 0);
  });

  it('should detect conflicts in same wave', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [], filesModified: ['src/shared.ts', 'src/a.ts'] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [], filesModified: ['src/shared.ts', 'src/b.ts'] },
    ]);
    const result = checkConflicts(tmpDir);
    assert.equal(result.hasConflicts, true);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].file, 'src/shared.ts');
    assert.deepEqual(result.conflicts[0].tasks, [1, 2]);
  });

  it('should not flag conflicts across different waves', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [], filesModified: ['src/shared.ts'] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [1], filesModified: ['src/shared.ts'] },
    ]);
    const result = checkConflicts(tmpDir);
    assert.equal(result.hasConflicts, false);
  });

  it('should handle tasks without filesModified', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [] },
    ]);
    const result = checkConflicts(tmpDir);
    assert.equal(result.hasConflicts, false);
  });
});

// --- resolveConflicts ---

describe('resolveConflicts', () => {
  it('should add dependency to resolve file conflict', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [], filesModified: ['src/shared.ts'] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [], filesModified: ['src/shared.ts'] },
    ]);
    const result = resolveConflicts(tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.resolved, 1);

    // Task 2 should now depend on task 1
    const task2 = getTask(tmpDir, '2');
    assert.ok(task2.dependsOn.includes(1));

    // Waves should now be separated
    const waves = getWaves(tmpDir);
    assert.deepEqual(waves.waveOrder, [1, 2]);
  });

  it('should do nothing when no conflicts', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [], filesModified: ['src/a.ts'] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [], filesModified: ['src/b.ts'] },
    ]);
    const result = resolveConflicts(tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.resolved, 0);
  });

  it('should build a complete chain for 3+ tasks conflicting on same file', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'pending', dependsOn: [], filesModified: ['src/shared.ts'] },
      { id: 2, name: 'B', status: 'pending', dependsOn: [], filesModified: ['src/shared.ts'] },
      { id: 3, name: 'C', status: 'pending', dependsOn: [], filesModified: ['src/shared.ts'] },
    ]);
    const result = resolveConflicts(tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.resolved, 2); // 1→2 and 2→3

    // Task 2 depends on 1, task 3 depends on 2
    const task2 = getTask(tmpDir, '2');
    const task3 = getTask(tmpDir, '3');
    assert.ok(task2.dependsOn.includes(1));
    assert.ok(task3.dependsOn.includes(2));

    // All three should now be in separate waves
    const waves = getWaves(tmpDir);
    assert.deepEqual(waves.waveOrder, [1, 2, 3]);
  });
});

// --- getCompletionSummary ---

describe('getCompletionSummary', () => {
  it('should return error when no tasks', () => {
    const result = getCompletionSummary(tmpDir);
    assert.equal(result.error, 'No tasks found');
  });

  it('should report isAllFinished when all done/failed/skipped', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'done', bestScore: 90, retryCount: 0, completedAt: '2026-01-01 12:00:00' },
      { id: 2, name: 'B', status: 'failed', bestScore: 0, retryCount: 2, lastError: 'timeout' },
      { id: 3, name: 'C', status: 'skipped', bestScore: 0, retryCount: 0, lastError: '依赖任务失败' },
    ]);
    const result = getCompletionSummary(tmpDir);
    assert.equal(result.isAllFinished, true);
    assert.equal(result.total, 3);
    assert.equal(result.done, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.totalRetries, 2);
    assert.equal(result.hasWarnings, true);
    assert.equal(result.warnings.length, 2);
  });

  it('should report not finished when pending tasks exist', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'done', bestScore: 85 },
      { id: 2, name: 'B', status: 'pending' },
    ]);
    const result = getCompletionSummary(tmpDir);
    assert.equal(result.isAllFinished, false);
    assert.equal(result.pending, 1);
  });

  it('should calculate score stats correctly', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'done', bestScore: 80, figmaUrl: 'https://figma.com/1' },
      { id: 2, name: 'B', status: 'done', bestScore: 90 },
      { id: 3, name: 'C', status: 'done', bestScore: 100 },
    ]);
    const result = getCompletionSummary(tmpDir);
    assert.equal(result.scores.avg, 90);
    assert.equal(result.scores.min, 80);
    assert.equal(result.scores.max, 100);
    assert.equal(result.designTasks.total, 1);
    assert.equal(result.designTasks.done, 1);
    assert.equal(result.logicTasks.total, 2);
    assert.equal(result.logicTasks.done, 2);
  });
});

// --- archiveTasks ---

describe('archiveTasks', () => {
  it('should return error when no tasks.json', () => {
    const result = archiveTasks(tmpDir);
    assert.equal(result.error, 'No tasks.json to archive');
  });

  it('should archive tasks.json and clean up', () => {
    seedTasks([
      { id: 1, name: 'A', status: 'done' },
    ]);
    // Create a context file
    const contextDir = path.join(tmpDir, '.fe-runtime', 'context');
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(path.join(contextDir, 'verify-result-1.json'), '{}');

    const result = archiveTasks(tmpDir);
    assert.equal(result.ok, true);
    assert.ok(result.archiveDir.startsWith('.fe-runtime/history/'));

    // tasks.json should be gone
    assert.equal(fs.existsSync(tasksPath(tmpDir)), false);

    // Context should be cleaned
    assert.equal(fs.readdirSync(contextDir).length, 0);

    // Archive should contain files
    const archivePath = path.join(tmpDir, result.archiveDir);
    assert.ok(fs.existsSync(path.join(archivePath, 'tasks.json')));
    assert.ok(fs.existsSync(path.join(archivePath, 'context', 'verify-result-1.json')));
  });

});
