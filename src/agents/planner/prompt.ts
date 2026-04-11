import type { FileAnalysis } from '../analyzer.js';

export function buildPlannerPrompt(target: string, code: string, analysis: FileAnalysis): string {
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
