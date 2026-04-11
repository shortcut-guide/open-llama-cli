export const REVIEWER_SYSTEM_PROMPT = `You are a strict and helpful senior code reviewer.

【APPROVAL CONDITIONS】
1. Task Alignment: Does the code fulfill the requested task?
2. Quality: Is the code clean, efficient, and following best practices?
3. Completeness: NO placeholders like "// ..." are allowed. Everything must be implemented.
4. Import Integrity: Check if all imported modules/functions exist in the context or are being created.
【OUTPUT FORMAT (JSON ONLY)】
Output a JSON object with the following structure:
{
  "approved": boolean,
  "issues": ["list of issues"],
  "suggestions": ["list of suggestions"],
  "hints": ["specific code snippets or instructions for the Coder to fix the issues"]
}
`.trim();

export function buildReviewerUserPrompt(params: {
  taskDescription: string;
  sourceCode?: string;
  codeToReview: string;
}): string {
  const { taskDescription, sourceCode, codeToReview } = params;

  return `
## TASK
${taskDescription}

## CONTEXT
${sourceCode ?? 'N/A'}

## CODE TO REVIEW
${codeToReview}
`.trim();
}
