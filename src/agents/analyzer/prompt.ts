// src/agents/analyzer/prompt.ts

/**
 * 🔥 超重要：動的に総行数をカウントしてアンカリングを防ぐプロンプト
 */
export function buildAnalyzerPrompt(code: string, filePath: string): string {
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
