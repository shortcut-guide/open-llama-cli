// src/agents/analyzer/analyzer.ts
import { callLLM, type Message } from '../../model/llm/index.js';
import { type FileAnalysis, isFileAnalysis } from './types.js';
import { buildAnalyzerPrompt } from './prompt.js';
import { extractJSON } from './parseOutput.js';
import { getLspDiagnosticsForFile, hasLspConfig, type LspDiagnostic } from '../../model/lsp/index.js';

export type { FunctionInfo, FileAnalysis } from './types.js';

function formatLspDiagnostics(diags: LspDiagnostic[]): string {
  if (diags.length === 0) return '';
  const lines = diags.map(d => {
    const src = d.source ? `[${d.source}] ` : '';
    return `  ${d.severity.toUpperCase()} L${d.line}:${d.character} — ${src}${d.message}`;
  });
  return `\n# LSP DIAGNOSTICS (real-time language server data)\n${lines.join('\n')}\n`;
}

export async function runAnalyzer(params: {
  code: string;
  filePath: string;
  llmUrl: string;
}): Promise<FileAnalysis & { analysis?: string; lspDiagnostics?: LspDiagnostic[] }> {
  const { code, filePath, llmUrl } = params;

  // Fetch LSP diagnostics if available (non-blocking; empty array on failure)
  const lspDiagnostics = hasLspConfig()
    ? await getLspDiagnosticsForFile(filePath)
    : [];

  const lspSection = formatLspDiagnostics(lspDiagnostics);

  const prompt = code === 'N/A'
    ? `Analyze the project goal for: ${filePath}. Provide a high-level technical summary.${lspSection}`
    : buildAnalyzerPrompt(code, filePath) + lspSection;

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
    return { path: filePath, exports: [], dependencies: [], functions: [], analysis: text, lspDiagnostics };
  }

  try {
    const json = extractJSON(text);
    if (!isFileAnalysis(json)) {
      throw new Error("Parsed JSON does not match FileAnalysis shape");
    }
    return { ...json, lspDiagnostics };
  } catch (e) {
    console.error('[analyzer] parse failed:', e instanceof Error ? e.message : e);
    return { path: filePath, exports: [], dependencies: [], functions: [], analysis: text, lspDiagnostics };
  }
}

