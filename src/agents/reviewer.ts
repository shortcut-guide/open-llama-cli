// src/agents/reviewer.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult, ReviewResult } from './types.js';

const REVIEWER_SYSTEM_PROMPT = `You are a strict and helpful senior code reviewer.

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

export async function runReviewerAgent(ctx: AgentContext): Promise<AgentResult> {
  const codeToReview = ctx.fixedCode ?? ctx.code ?? '';
  const taskDescription = ctx.gsdTask ? ctx.gsdTask.action : ctx.userTask;
  
  const messages: Message[] = [
    { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
    {
      role: 'user',
      content:`
## TASK
${taskDescription}

## CONTEXT
${ctx.sourceCode ?? 'N/A'}

## CODE TO REVIEW
${codeToReview}
`.trim(),
    },
  ];

  const raw = await callLLM(messages, { 
    printStream: false,
    llmUrl: ctx.llmUrl,
  });

  let reviewResult: ReviewResult;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON not found');
    reviewResult = JSON.parse(jsonMatch[0]);
    if (!reviewResult.hints) reviewResult.hints = [];
  } catch {
    reviewResult = { approved: false, issues: ['パース失敗'], suggestions: [], hints: [], raw };
  }

  if (reviewResult.approved) {
    console.log(chalk.green('\n  ✅ レビュー結果: 承認'));
  } else {
    console.log(chalk.red(`\n  ❌ レビュー結果: 要修正 (イテレーション ${ctx.iterationCount})`));
    reviewResult.issues?.forEach((i) => console.log(chalk.red(`    - ${i}`)));
    
    // 🔥 ヒントの全文をターミナルに表示するように修正
    if (reviewResult.hints && reviewResult.hints.length > 0) {
      console.log(chalk.cyan('    💡 ヒント (Code Snippets):'));
      reviewResult.hints.forEach((h) => {
        console.log(chalk.cyan('      ' + h.trim().split('\n').join('\n      ')));
      });
    }
  }

  return { agentName: 'Reviewer', output: JSON.stringify(reviewResult), messages: [...messages, { role: 'assistant', content: raw }] };
}

export function parseReviewResult(output: string): ReviewResult {
  try { return JSON.parse(output); } 
  catch { return { approved: false, issues: [], suggestions: [], hints: [], raw: output }; }
}