// src/agents/planner.ts

import { callLLM } from "../model/llm.js";
import { FunctionInfo } from "./analyzer.js";

export type MicroPlan = {
  file: string;
  responsibility: string;
  extractFrom: {
    functionName: string;
    startLine: number;
    endLine: number;
  };
  inputs: string[];
  outputs: string[];
  dependencies: string[];
};

export async function runMicroPlanner(params: {
  target: string;
  functionInfo: FunctionInfo;
  filePath: string;
  llmUrl: string;
}): Promise<MicroPlan> {
  const { target, functionInfo, filePath, llmUrl } = params;

  const prompt = buildPlannerPrompt(target, functionInfo, filePath);

  const messages = [{ role: "user", content: prompt }];

  const text: string = await callLLM(messages, {
    printStream: true,
    temperature: 0.2,
    maxTokens: 500,
    label: "📋 Planner",
  });

  try {
    const json = extractJSON(text);
    return json;
  } catch (e) {
    console.error("Planner parse error:", text);
    throw new Error("Planner failed to parse JSON");
  }
}

function buildPlannerPrompt(
  target: string,
  fn: FunctionInfo,
  filePath: string
): string {
  return `
You are a micro planner.

# CRITICAL RULES
- ONLY plan ONE file
- DO NOT create multiple files

# DIRECTORY & PATH RULES (STRICT)
- DO NOT force "src/components/" or any arbitrary directory.
- If the user specifies a target path in the prompt, USE THAT EXACT PATH.
- If refactoring in-place, the output "file" path MUST BE EXACTLY the same as the SOURCE FILE: "${filePath}"

# TARGET (USER REQUEST)
${target}

# SOURCE FILE
${filePath}

# FUNCTION TO REFACTOR
Name: ${fn.name}
Lines: ${fn.startLine}-${fn.endLine}
Description: ${fn.description}

# OUTPUT FORMAT (STRICT JSON)
{
  "file": "${filePath}",
  "responsibility": "single clear responsibility",
  "extractFrom": {
    "functionName": "${fn.name}",
    "startLine": ${fn.startLine},
    "endLine": ${fn.endLine}
  },
  "inputs": ["arg1"],
  "outputs": ["string"],
  "dependencies": ["react"]
}
`.trim();
}

function extractJSON(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON found");
  }
  return JSON.parse(text.slice(start, end + 1));
}