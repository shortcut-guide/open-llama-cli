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

function extractJsonCandidate(raw: string): string | null {
  // 1. Markdown code block: ```json ... ``` or ``` ... ```
  const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1];

  // 2. Find the last complete JSON object by scanning from the last closing brace
  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace === -1) return null;

  // Walk backward to find a matching opening brace, tracking nesting
  let depth = 0;
  for (let i = lastBrace; i >= 0; i--) {
    if (raw[i] === '}') depth++;
    else if (raw[i] === '{') {
      depth--;
      if (depth === 0) return raw.slice(i, lastBrace + 1);
    }
  }

  return null;
}

export function parseReviewerResponse(raw: string): ReviewResult {
  const candidate = extractJsonCandidate(raw);

  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as Partial<ReviewResult>;
      if (typeof parsed === 'object' && parsed !== null && 'approved' in parsed) {
        return normalizeReviewResult(parsed, raw);
      }
    } catch {
      // fall through to failure
    }
  }

  // Log the raw response to aid debugging
  console.error('[parseReviewerResponse] Failed to parse reviewer JSON. Raw output (truncated):');
  console.error(raw.slice(0, 500));

  return {
    approved: false,
    issues: ['パース失敗'],
    suggestions: [],
    hints: [],
    raw,
  };
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
