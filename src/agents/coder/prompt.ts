import type { ReviewResult } from '../types.js';

export const CODER_SYSTEM_PROMPT = `
You are an expert TypeScript Software Engineer.
Your mission is to execute the requested task perfectly and concisely.

# CRITICAL OUTPUT RULES
1. ALWAYS output the FULL content of the file — no truncation, no omissions.
2. NEVER use placeholders like "// ..." or "// existing code" or "// TODO".
3. If multiple files are involved, use multiple markdown code blocks.
4. Your output for each file MUST start exactly with: \`\`\`file:<target_path>
5. NEVER output an empty code fence. The file content MUST follow the opening marker on the next line.
6. A code block with no content (just the file marker and closing \`\`\`) is STRICTLY FORBIDDEN.

# TYPESCRIPT STRICT MODE RULES
7. NEVER use \`any\` type. Use proper interfaces, generics, or union types instead.
8. ALL local imports MUST include the \`.js\` extension (e.g., \`import { foo } from './foo.js'\`).
9. ALL exported functions MUST have explicit return type annotations.
10. ALL function parameters MUST be typed — no implicit \`any\`.
11. Prefer \`interface\` for object shapes; use \`type\` only for unions/intersections.
12. NEVER use \`as any\` or \`as unknown\` as a type escape hatch.
`.trim();

export function buildUserPrompt(params: {
  sourceCode?: string;
  targetPath: string;
  instructions: string;
}): string {
  const { sourceCode, targetPath, instructions } = params;

  return `
# SOURCE CONTEXT (read-only reference)
${sourceCode ?? 'N/A'}

# TASK INSTRUCTIONS (CRITICAL)
Target File: ${targetPath}
Instructions: ${instructions}

# REMINDERS
- Output the FULL, complete file content — no truncation.
- Local imports MUST end in \`.js\` (e.g., \`import { x } from './x.js'\`).
- No \`any\` types. Annotate all function return types and parameters.
- Your output MUST be a markdown code block starting exactly with: \`\`\`file:${targetPath}
`.trim();
}

export function buildRefixPrompt(params: {
  reviewResult: ReviewResult;
  targetPath: string;
}): string {
  const { reviewResult, targetPath } = params;

  const issueList = (reviewResult.issues ?? []).map((i) => `- ${i}`).join('\n');
  const hintList = reviewResult.hints.length > 0
    ? reviewResult.hints.map((h) => `- ${h}`).join('\n')
    : 'None';

  return `
# REFIX REQUIRED for \`${targetPath}\`

## Blocking Issues (MUST ALL be resolved)
${issueList || '- (none listed)'}

## Reviewer Hints (apply these exactly)
${hintList}

## Instructions
1. Fix EVERY issue listed above.
2. Apply each hint as-is — do not skip any.
3. Output the COMPLETE corrected file as a markdown code block starting with: \`\`\`file:${targetPath}
`.trim();
}
