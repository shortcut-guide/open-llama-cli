import type { ReviewResult } from '../types.js';

function normalizeReviewResult(value: Partial<ReviewResult>, raw?: string): ReviewResult {
  return {
    approved: value.approved === true,
    issues: value.issues ?? [],
    suggestions: value.suggestions ?? [],
    hints: value.hints ?? [],
    raw: value.raw ?? raw,
  };
}

export function parseReviewerResponse(raw: string): ReviewResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON not found');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ReviewResult>;
    return normalizeReviewResult(parsed, raw);
  } catch {
    return {
      approved: false,
      issues: ['パース失敗'],
      suggestions: [],
      hints: [],
      raw,
    };
  }
}

export function parseReviewResult(output: string): ReviewResult {
  try {
    const parsed = JSON.parse(output) as Partial<ReviewResult>;
    return normalizeReviewResult(parsed, output);
  } catch {
    return {
      approved: false,
      issues: [],
      suggestions: [],
      hints: [],
      raw: output,
    };
  }
}
