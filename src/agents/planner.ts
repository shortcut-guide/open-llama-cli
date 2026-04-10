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
  const prompt = buildPlannerPrompt(target, code, analysis);
  const messages: Message[] = [{ role: "user", content: prompt }];

  const text: string = await callLLM(messages, {
    printStream: true,
    temperature: 0.2, 
    maxTokens: 1500,
    label: "📋 Planner",
    llmUrl: params.llmUrl,
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

function buildPlannerPrompt(target: string, code: string, analysis: FileAnalysis): string {
  const functionsJson = JSON.stringify(analysis.functions ?? [], null, 2);
  return `
You are an expert Software Architect.
Your task is to design a plan to achieve the following goal: ${target}

## Refactoring Rules (CRITICAL)
- "1機能1ファイル" means: EACH function, class, or component must go into its OWN separate file.
- Do NOT group multiple functions in a single file.
- Create EXACTLY one plan entry per output file.
- Use the "functions" list below to identify what to split.

## General Rules
- Design atomic tasks. Explicitly list which function is exported from which file.
- Ensure the 'extractFocus' describes the exact interface to prevent "undefined function" errors.

# SOURCE CODE CONTEXT
File: ${analysis.path}
${code}

# IDENTIFIED FUNCTIONS (split each into its own file)
${functionsJson}

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