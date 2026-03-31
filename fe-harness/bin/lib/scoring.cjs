'use strict';

// Design task scoring dimensions and weights
const DESIGN_WEIGHTS = {
  layout: 2.0,
  spacing: 1.5,
  colors: 1.5,
  typography: 1.0,
  borders: 0.5,
  shadows: 0.5,
  icons_images: 1.0,
  completeness: 2.0,
};
const DESIGN_WEIGHT_SUM = Object.values(DESIGN_WEIGHTS).reduce((a, b) => a + b, 0);

const LOGIC_WEIGHTS = {
  correctness: 2.5,
  completeness: 2.0,
  error_handling: 1.5,
  code_quality: 1.5,
  type_safety: 1.0,
  integration: 1.5,
};
const LOGIC_WEIGHT_SUM = Object.values(LOGIC_WEIGHTS).reduce((a, b) => a + b, 0);

// Common key aliases: verifier agents sometimes output wrong key names.
// Map them to the canonical keys defined in DESIGN_WEIGHTS / LOGIC_WEIGHTS.
const KEY_ALIASES = {
  // colors
  color: 'colors',
  colour: 'colors',
  colour_s: 'colors',
  color_tokens: 'colors',
  color_accuracy: 'colors',
  // borders
  border: 'borders',
  border_radius: 'borders',
  // shadows
  shadow: 'shadows',
  // icons_images
  icons: 'icons_images',
  images: 'icons_images',
  // layout
  layout_structure: 'layout',
  layout_accuracy: 'layout',
  // spacing
  spacing_alignment: 'spacing',
  spacing_accuracy: 'spacing',
  // completeness
  component_completeness: 'completeness',
  // non-standard dimensions — map to closest canonical match
  responsive_behavior: 'layout',     // responsiveness is part of layout
  visual_fidelity: 'completeness',   // overall visual match → completeness
  interaction_states: null,           // no matching dimension — drop
  interaction: null,
};

/**
 * Normalise score keys to match the canonical weight definitions.
 * - Remap known aliases (e.g. "color" → "colors")
 * - Strip unknown keys with a warning
 * - Report missing dimensions so callers know something is off
 * @returns {{ normalised, warnings }}
 */
function normaliseScoreKeys(scores, type) {
  const weights = type === 'design' ? DESIGN_WEIGHTS : LOGIC_WEIGHTS;
  const validKeys = new Set(Object.keys(weights));
  const normalised = {};
  const warnings = [];

  for (const [key, value] of Object.entries(scores)) {
    if (validKeys.has(key)) {
      normalised[key] = value;
    } else if (key in KEY_ALIASES) {
      const mapped = KEY_ALIASES[key];
      if (mapped && validKeys.has(mapped)) {
        if (normalised[mapped] == null) {
          normalised[mapped] = value;
          warnings.push(`key "${key}" remapped to "${mapped}"`);
        } else {
          warnings.push(`key "${key}" dropped (canonical "${mapped}" already set)`);
        }
      } else {
        warnings.push(`key "${key}" dropped (not a valid ${type} dimension)`);
      }
    } else {
      warnings.push(`unknown key "${key}" dropped (not a valid ${type} dimension)`);
    }
  }

  // Check for missing dimensions — these will default to 0
  for (const dim of validKeys) {
    if (normalised[dim] == null) {
      warnings.push(`missing dimension "${dim}" — defaults to 0`);
    }
  }

  return { normalised, warnings };
}

/**
 * Calculate weighted score from dimension scores.
 * @param {Object} scores - { dimension: score(0-10) }
 * @param {'design'|'logic'} type
 * @param {Object} thresholds - { verifyThreshold, reviewThreshold, dimensionThreshold }
 * @returns {{ total_score, passed, failed_dimensions, weighted_scores, warnings }}
 */
function calculateScore(scores, type, thresholds) {
  const weights = type === 'design' ? DESIGN_WEIGHTS : LOGIC_WEIGHTS;
  const weightSum = type === 'design' ? DESIGN_WEIGHT_SUM : LOGIC_WEIGHT_SUM;
  const threshold = type === 'design' ? thresholds.verifyThreshold : thresholds.reviewThreshold;
  const dimThreshold = thresholds.dimensionThreshold;

  // Normalise keys before calculating
  const { normalised, warnings } = normaliseScoreKeys(scores, type);

  if (warnings.length > 0) {
    process.stderr.write(`[scoring] warnings for ${type} scores:\n`);
    for (const w of warnings) {
      process.stderr.write(`  - ${w}\n`);
    }
  }

  let weightedSum = 0;
  const weightedScores = {};
  const failedDimensions = [];

  for (const [dim, weight] of Object.entries(weights)) {
    const score = normalised[dim] != null ? Number(normalised[dim]) : 0;
    weightedScores[dim] = score * weight;
    weightedSum += score * weight;

    if (score < dimThreshold) {
      failedDimensions.push(dim);
    }
  }

  const totalScore = Math.round((weightedSum / (weightSum * 10)) * 100);
  const passed = totalScore >= threshold && failedDimensions.length === 0;

  return {
    total_score: totalScore,
    passed,
    failed_dimensions: failedDimensions,
    weighted_scores: weightedScores,
    warnings,
  };
}

/**
 * Check for score regression.
 * @param {Object} current - { total_score, scores: { dim: score } }
 * @param {Object} best - { total_score, scores: { dim: score } }
 * @param {Object} thresholds - { scoreDropTolerance, dimensionThreshold }
 * @returns {{ regressed, reason, action }}
 */
function checkRegression(current, best, thresholds) {
  // Auto-calculate total_score from scores if not provided (defensive)
  const currentTotal = current.total_score != null
    ? current.total_score
    : (current.scores ? autoCalcTotal(current.scores) : 0);
  const bestTotal = best.total_score != null
    ? best.total_score
    : (best.scores ? autoCalcTotal(best.scores) : 0);

  const scoreDrop = bestTotal - currentTotal;
  const tolerance = thresholds.scoreDropTolerance;
  const dimThreshold = thresholds.dimensionThreshold;

  // Check total score drop
  if (scoreDrop > tolerance) {
    return {
      regressed: true,
      reason: `Total score dropped ${scoreDrop} points (${bestTotal} → ${currentTotal}), exceeds tolerance ${tolerance}`,
      action: 'rollback',
    };
  }

  // Check dimension regression: previously-passed dimension now fails
  if (current.scores && best.scores) {
    for (const [dim, bestScore] of Object.entries(best.scores)) {
      if (bestScore >= dimThreshold && current.scores[dim] < dimThreshold) {
        return {
          regressed: true,
          reason: `Dimension "${dim}" regressed from ${bestScore} to ${current.scores[dim]} (below threshold ${dimThreshold})`,
          action: 'rollback',
        };
      }
    }
  }

  return { regressed: false };
}

/**
 * Auto-calculate a rough total_score from raw dimension scores.
 * Used as fallback when total_score is not provided.
 */
function autoCalcTotal(scores) {
  const scoreKeys = Object.keys(scores);

  // Use unique keys to determine type:
  // - Design-only keys: layout, spacing, colors, typography, borders, shadows, icons_images
  // - Logic-only keys: correctness, error_handling, code_quality, type_safety, integration
  // - Shared key: completeness (exists in both)
  const designOnlyKeys = ['layout', 'spacing', 'colors', 'typography', 'borders', 'shadows', 'icons_images'];
  const logicOnlyKeys = ['correctness', 'error_handling', 'code_quality', 'type_safety', 'integration'];

  const hasDesignKey = designOnlyKeys.some(k => scoreKeys.includes(k));
  const hasLogicKey = logicOnlyKeys.some(k => scoreKeys.includes(k));

  // If both or neither unique keys found, count matches to break tie
  let isDesign;
  if (hasDesignKey && !hasLogicKey) {
    isDesign = true;
  } else if (hasLogicKey && !hasDesignKey) {
    isDesign = false;
  } else {
    // Ambiguous — count how many keys match each type
    const designMatches = Object.keys(DESIGN_WEIGHTS).filter(k => scoreKeys.includes(k)).length;
    const logicMatches = Object.keys(LOGIC_WEIGHTS).filter(k => scoreKeys.includes(k)).length;
    isDesign = designMatches >= logicMatches;
  }

  const weights = isDesign ? DESIGN_WEIGHTS : LOGIC_WEIGHTS;
  const weightSum = isDesign ? DESIGN_WEIGHT_SUM : LOGIC_WEIGHT_SUM;

  let weightedSum = 0;
  for (const [dim, weight] of Object.entries(weights)) {
    const score = scores[dim] != null ? Number(scores[dim]) : 0;
    weightedSum += score * weight;
  }
  return Math.round((weightedSum / (weightSum * 10)) * 100);
}

module.exports = {
  DESIGN_WEIGHTS,
  LOGIC_WEIGHTS,
  calculateScore,
  checkRegression,
  normaliseScoreKeys,
};
