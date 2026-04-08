// src/agents/coder.ts
import chalk from 'chalk';
import fs from 'fs';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult, TaskType } from './types.js';

const CODER_SYSTEM_PROMPT = `
You are a precise and conservative Refactoring Engineer.
Your mission is to extract code and make it standalone WITHOUT changing its original behavior or design.

# CRITICAL PROHIBITIONS (NEVER DO THESE)
- DO NOT invent or hallucinate imports (e.g., importing HTML tags like 'div' or 'className' from 'react').
- DO NOT change the UI, styling, CSS classes, or add emojis unless explicitly requested.
- DO NOT remove DOM wrapper elements (like <Link>) or event handlers (like onError, onClick).
- DO NOT break existing functionality.
`.trim();

export async function runCoderAgent(ctx: AgentContext): Promise<AgentResult> {
  const taskType: TaskType = ctx.taskType ?? 'refactor';

  let confirmedSourcePath = 'Not Specified';
  if (ctx.sourcePath && fs.existsSync(ctx.sourcePath)) {
    confirmedSourcePath = ctx.sourcePath;
  } else if (ctx.userTask) {
    const match = ctx.userTask.match(/(?:\/Users|\/home|\.\/|\/)\S+\.tsx?/);
    if (match && fs.existsSync(match[0])) {
      confirmedSourcePath = match[0];
    }
  }

  let targetPath: string = 'unknown_file.tsx';
  try {
    const planObj = typeof ctx.plan === 'string' && ctx.plan.trim().startsWith('{') 
      ? JSON.parse(ctx.plan) 
      : ctx.plan;
    targetPath = (typeof planObj === 'object' && planObj !== null && 'file' in planObj) 
      ? String(planObj.file) 
      : String(planObj);
  } catch {
    targetPath = String(ctx.plan);
  }
  
  if (!targetPath || targetPath === 'undefined') targetPath = 'unknown_file.tsx';

  console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║  💻 Coder Agent (Conservative Mode) ║'));
  console.log(chalk.bold.blue('╠══════════════════════════════════════╣'));
  console.log(chalk.bold.blue(`║  Source: ${confirmedSourcePath.split('/').pop()?.padEnd(27) ?? 'Unknown'}║`));
  console.log(chalk.bold.blue(`║  Target: ${targetPath.padEnd(27)}║`));
  console.log(chalk.bold.blue('╚══════════════════════════════════════╝'));

  function buildUserPrompt(ctx: AgentContext, target: string, source: string): string {
    return `
# ABSOLUTE TRUTH
- SOURCE FILE: ${source}
- TARGET PATH: ${target}

# TASK: SAFE EXTRACTION
Extract the provided SOURCE CONTENT into a fully functional file at TARGET PATH.
Keep the exact same visual design, UI elements, and interactions.

# SOURCE CONTENT (RAW EXTRACT)
${ctx.sourceCode ?? 'N/A'}

# REFACTORING REQUIREMENTS (CRITICAL)
1. PRESERVE ALL functionality. Keep all 'onError', 'onClick', '<Link>' tags exactly as they operate.
2. DO NOT hallucinate imports. 'react' only exports hooks and standard React APIs. 
3. Define proper TypeScript interfaces/types for all Props.
4. Add missing legitimate imports (like 'next/link').

# OUTPUT FORMAT
Your output MUST start exactly with: \`\`\`file:${target}\`\`\`
`.trim();
  }

  const messages: Message[] = [
    { role: 'user', content: buildUserPrompt(ctx, targetPath, confirmedSourcePath) },
  ];

  if (ctx.reviewResult && !ctx.reviewResult.approved) {
    messages.push({ role: 'assistant', content: ctx.code ?? '' });
    messages.push({
      role: 'user',
      content: `
# REFIX REQUIRED
Reviewer rejected your code for these reasons:
${ctx.reviewResult.issues.join('\n')}

# STRICT INSTRUCTION
- Header MUST be: \`\`\`file:${targetPath}\`\`\`
- FIX the hallucinated imports, missing event handlers, or broken UI structures.
`.trim()
    });
  }

  const output = await callLLM(messages, {
    printStream: true,
    label: '💻 Coder',
    systemPrompt: CODER_SYSTEM_PROMPT,
    temperature: 0.0, // 幻覚（ハルシネーション）を防ぐため、揺らぎを完全にゼロにする
  });

  return {
    agentName: 'Coder',
    output,
    messages: [
      { role: 'system', content: CODER_SYSTEM_PROMPT },
      ...messages,
      { role: 'assistant', content: output }
    ],
  };
}