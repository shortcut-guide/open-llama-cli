import type { FileAnalysis } from '../analyzer/index.js';
import type { MacroPlan } from './types.js';

export function parsePlannerResponse(text: string, target: string, analysis: FileAnalysis): MacroPlan {
  try {
    const json = extractPlannerJSON(text);
    return json as MacroPlan;
  } catch {
    return buildFallbackPlan(target, analysis);
  }
}

function extractPlannerJSON(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('JSON not found');
  }

  return JSON.parse(jsonMatch[0]);
}

function buildFallbackPlan(target: string, analysis: FileAnalysis): MacroPlan {
  return {
    plans: [{
      file: analysis.path,
      responsibility: 'Execute task',
      extractFocus: target,
    }],
  };
}
