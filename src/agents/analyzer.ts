// src/agents/analyzer.ts

import { callLLM, type Message } from "../model/llm.js";

export type FunctionInfo = {
  name: string;
  startLine: number;
  endLine: number;
  description: string;
};

export type FileAnalysis = {
  path: string;
  exports: string[];
  dependencies: string[];
  functions: FunctionInfo[];
};

export async function runAnalyzer(params: {
  code: string;
  filePath: string;
  llmUrl: string;
}): Promise<FileAnalysis & { analysis?: string }> {
  const { code, filePath, llmUrl } = params;

  const prompt = code === 'N/A' 
    ? `Analyze the project goal for: ${filePath}. Provide a high-level technical summary.`
    : buildAnalyzerPrompt(code, filePath);

  const messages: Message[] = [
    { role: "user", content: prompt },
  ];

  const text: string = await callLLM(messages, {
    printStream: true,
    temperature: 0.1,
    maxTokens: 1000,
    label: "🔍 Researcher",
  });

  if (code === 'N/A') {
    return { path: filePath, exports: [], dependencies: [], functions: [], analysis: text };
  }

  try {
    const json = extractJSON(text);
    return json;
  } catch (e) {
    return { path: filePath, exports: [], dependencies: [], functions: [], analysis: text };
  }
}

/**
 * 🔥 超重要：動的に総行数をカウントしてアンカリングを防ぐプロンプト
 */
function buildAnalyzerPrompt(code: string, filePath: string): string {
  // TypeScript側で実際のコードの総行数を計算
  const totalLines = code.split('\n').length;

  return `
You are a static code analyzer.

# IMPORTANT RULES
- DO NOT explain
- DO NOT guess
- DO NOT refactor
- ONLY extract facts
- OUTPUT JSON ONLY
- CRITICAL: Count the EXACT start and end lines of each function based on the provided code. 
- The total length of this file is exactly ${totalLines} lines.

# TASK
Analyze the given TypeScript code and extract:

1. exported functions
2. imported dependencies
3. functions with EXACT line numbers and purpose

# OUTPUT FORMAT (STRICT JSON)
{
  "path": "${filePath}",
  "exports": ["functionName"],
  "dependencies": ["fs", "path"],
  "functions": [
    {
      "name": "functionName",
      "startLine": 1,
      "endLine": ${totalLines},
      "description": "short factual description"
    }
  ]
}

# CODE
${code}
`;
}

/**
 * LLMの余計な文字を削除してJSON抽出
 */
function extractJSON(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON found");
  }
  const jsonString = text.slice(start, end + 1);
  return JSON.parse(jsonString);
}