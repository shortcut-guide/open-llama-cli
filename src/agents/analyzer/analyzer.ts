// src/agents/analyzer/analyzer.ts
import { callLLM, type Message } from '../../model/llm.js';
import { type FileAnalysis } from './types.js';
import { buildAnalyzerPrompt } from './prompt.js';
import { extractJSON } from './parseOutput.js';

export type { FunctionInfo, FileAnalysis } from './types.js';

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
    llmUrl: llmUrl,
  });

  if (code === 'N/A') {
    return { path: filePath, exports: [], dependencies: [], functions: [], analysis: text };
  }

  try {
    const json = extractJSON(text);
    return json as FileAnalysis;
  } catch (e) {
    return { path: filePath, exports: [], dependencies: [], functions: [], analysis: text };
  }
}
