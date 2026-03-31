'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DESIGN_WEIGHTS, LOGIC_WEIGHTS, calculateScore, checkRegression } = require('../scoring.cjs');

const defaultThresholds = {
  verifyThreshold: 80,
  reviewThreshold: 80,
  dimensionThreshold: 6,
  scoreDropTolerance: 3,
};

// --- calculateScore ---

describe('calculateScore', () => {
  describe('design type', () => {
    it('should return 100 when all dimensions score 10', () => {
      const scores = {};
      for (const dim of Object.keys(DESIGN_WEIGHTS)) scores[dim] = 10;
      const result = calculateScore(scores, 'design', defaultThresholds);
      assert.equal(result.total_score, 100);
      assert.equal(result.passed, true);
      assert.deepEqual(result.failed_dimensions, []);
    });

    it('should return 0 when all dimensions score 0', () => {
      const scores = {};
      for (const dim of Object.keys(DESIGN_WEIGHTS)) scores[dim] = 0;
      const result = calculateScore(scores, 'design', defaultThresholds);
      assert.equal(result.total_score, 0);
      assert.equal(result.passed, false);
      assert.deepEqual(result.failed_dimensions, Object.keys(DESIGN_WEIGHTS));
    });

    it('should fail when total score is below verifyThreshold', () => {
      const scores = {};
      for (const dim of Object.keys(DESIGN_WEIGHTS)) scores[dim] = 7;
      const result = calculateScore(scores, 'design', defaultThresholds);
      assert.equal(result.total_score, 70);
      assert.equal(result.passed, false);
    });

    it('should fail when any dimension is below dimensionThreshold', () => {
      const scores = {};
      for (const dim of Object.keys(DESIGN_WEIGHTS)) scores[dim] = 10;
      scores.layout = 5; // below 6
      const result = calculateScore(scores, 'design', defaultThresholds);
      assert.equal(result.passed, false);
      assert.deepEqual(result.failed_dimensions, ['layout']);
    });

    it('should treat missing dimensions as 0', () => {
      const result = calculateScore({}, 'design', defaultThresholds);
      assert.equal(result.total_score, 0);
    });

    it('should calculate weighted scores correctly', () => {
      const scores = { layout: 8, spacing: 6, colors: 6, typography: 10, borders: 10, shadows: 10, icons_images: 10, completeness: 8 };
      const result = calculateScore(scores, 'design', defaultThresholds);
      // weighted sum = 8*2 + 6*1.5 + 6*1.5 + 10*1 + 10*0.5 + 10*0.5 + 10*1 + 8*2 = 16+9+9+10+5+5+10+16 = 80
      // total = round(80 / 100 * 100) = 80
      assert.equal(result.total_score, 80);
      assert.equal(result.passed, true);
      assert.equal(result.weighted_scores.layout, 16);
      assert.equal(result.weighted_scores.spacing, 9);
    });
  });

  describe('logic type', () => {
    it('should return 100 when all dimensions score 10', () => {
      const scores = {};
      for (const dim of Object.keys(LOGIC_WEIGHTS)) scores[dim] = 10;
      const result = calculateScore(scores, 'logic', defaultThresholds);
      assert.equal(result.total_score, 100);
      assert.equal(result.passed, true);
    });

    it('should use reviewThreshold for logic type', () => {
      const thresholds = { ...defaultThresholds, reviewThreshold: 90 };
      const scores = {};
      for (const dim of Object.keys(LOGIC_WEIGHTS)) scores[dim] = 8;
      const result = calculateScore(scores, 'logic', thresholds);
      assert.equal(result.total_score, 80);
      assert.equal(result.passed, false); // 80 < 90
    });
  });
});

// --- checkRegression ---

describe('checkRegression', () => {
  it('should detect total score regression exceeding tolerance', () => {
    const current = { total_score: 75, scores: {} };
    const best = { total_score: 80, scores: {} };
    const result = checkRegression(current, best, defaultThresholds);
    assert.equal(result.regressed, true);
    assert.equal(result.action, 'rollback');
    assert.ok(result.reason.includes('dropped 5'));
  });

  it('should allow score drop within tolerance', () => {
    const current = { total_score: 78, scores: {} };
    const best = { total_score: 80, scores: {} };
    const result = checkRegression(current, best, defaultThresholds);
    assert.equal(result.regressed, false);
  });

  it('should detect dimension regression (previously passed, now failed)', () => {
    const current = { total_score: 80, scores: { layout: 5 } };
    const best = { total_score: 80, scores: { layout: 8 } };
    const result = checkRegression(current, best, defaultThresholds);
    assert.equal(result.regressed, true);
    assert.ok(result.reason.includes('layout'));
  });

  it('should not regress if dimension was already below threshold', () => {
    const current = { total_score: 80, scores: { layout: 4 } };
    const best = { total_score: 80, scores: { layout: 5 } };
    const result = checkRegression(current, best, defaultThresholds);
    assert.equal(result.regressed, false);
  });

  it('should handle missing scores gracefully', () => {
    const current = { total_score: 80 };
    const best = { total_score: 80 };
    const result = checkRegression(current, best, defaultThresholds);
    assert.equal(result.regressed, false);
  });
});
