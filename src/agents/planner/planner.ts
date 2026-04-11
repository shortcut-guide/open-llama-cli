import { callLLM, type Message } from '../../model/llm.js';
import type { FileAnalysis } from '../analyzer.js';
import { parsePlannerResponse } from './parsePlan.js';
import { buildPlannerPrompt } from './prompt.js';
import type { MacroPlan } from './types.js';

export type { MicroPlan, MacroPlan } from './types.js';

export async function runPlanner(params: {
  target: string;
  code: string;
  analysis: FileAnalysis;
  llmUrl: string;
}): Promise<MacroPlan> {
  const { target, code, analysis, llmUrl } = params;
  const prompt = buildPlannerPrompt(target, code, analysis);
  const messages: Message[] = [{ role: 'user', content: prompt }];

  const text = await callLLM(messages, {
    printStream: true,
    temperature: 0.2,
    maxTokens: 1500,
    label: '📋 Planner',
    llmUrl,
  });

  return parsePlannerResponse(text, target, analysis);
}
