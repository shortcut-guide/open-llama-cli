import type { ReviewResult } from '../types.js';

export const CODER_SYSTEM_PROMPT = `
You are an expert Software Engineer.
Your mission is to execute the requested task perfectly and concisely.

# CRITICAL RULES
1. ALWAYS output the FULL content of the file.
2. NEVER use placeholders like "// ..." or "// existing code".
3. If multiple files are involved, use multiple markdown code blocks.
4. Your output for each file MUST start exactly with: \`\`\`file:<target_path>
5. NEVER output an empty code fence. The file content MUST follow the opening marker on the next line.
6. A code block with no content (just the file marker and closing \`\`\`) is STRICTLY FORBIDDEN.
`.trim();

export function buildUserPrompt(params: {
  sourceCode?: string;
  targetPath: string;
  instructions: string;
}): string {
  const { sourceCode, targetPath, instructions } = params;

  return `
# CONTEXT
${sourceCode ?? 'N/A'}

# TASK INSTRUCTIONS (CRITICAL)
Target Files: ${targetPath}
Instructions: ${instructions}

Your output MUST be markdown code blocks starting with: \`\`\`file:<target_path>\`\`\`
`.trim();
}

export function buildRefixPrompt(params: {
  reviewResult: ReviewResult;
  targetPath: string;
}): string {
  const { reviewResult, targetPath } = params;

  let refixContent = `# REFIX REQUIRED\n[Issues]:\n${(reviewResult.issues ?? []).join('\n')}`;
  if (reviewResult.hints.length > 0) {
    refixContent += `\n\n# REVIEWER HINTS (USE THESE):\n${reviewResult.hints.join('\n')}`;
  }
  refixContent += `\n\nOutput ONLY the corrected markdown code block starting with \`\`\`file:${targetPath}\`\`\``;

  return refixContent;
}
