// src/agents/planner.ts
import { callLLM, type Message } from "../model/llm.js";
import { FileAnalysis } from "./analyzer.js";

export type MicroPlan = {
  file: string;
  responsibility: string;
  extractFocus: string;
};

export type MacroPlan = {
  plans: MicroPlan[];
};

export async function runPlanner(params: {
  target: string;
  code: string;
  analysis: FileAnalysis;
  llmUrl: string;
}): Promise<MacroPlan> {
  const { target, code, analysis } = params;
  const prompt = buildPlannerPrompt(target, code, analysis.path);
  const messages: Message[] = [{ role: "user", content: prompt }];

  const text: string = await callLLM(messages, {
    printStream: true,
    temperature: 0.2, 
    maxTokens: 1500,
    label: "📋 Planner",
  });

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("JSON not found");
  } catch (e) {
    // If JSON fails, maybe it returned XML or plain text. 
    // For now, let's keep it simple and try to return a dummy plan if it's GSD-like.
    return {
      plans: [{
        file: analysis.path,
        responsibility: "Execute task",
        extractFocus: target
      }]
    };
  }
}

function buildPlannerPrompt(target: string, code: string, filePath: string): string {
  return `
You are an expert Software Architect.
Your task is to design a plan to achieve the following goal: ${target}

Design atomic tasks. For refactoring:
- Explicitly list which functions should be exported from which files.
- Ensure the 'action' describes the exact interface to prevent "undefined function" errors during review.

# SOURCE CODE CONTEXT
File: ${filePath}
${code}

# OUTPUT FORMAT (STRICT JSON)
{
  "plans": [
    {
      "file": "path/to/file",
      "responsibility": "What this file/task is for",
      "extractFocus": "Detailed instructions for the Executor"
    }
  ]
}
`.trim();
}