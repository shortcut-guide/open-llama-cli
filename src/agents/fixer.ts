// src/agents/fixer.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult } from './types.js';

const FIXER_SYSTEM_PROMPT = `あなたはバグ修正専門エンジニアです。

【ルール】
- priority_fixes のみ修正する
- 不要な変更は禁止
- 設計は変えない
- 最小修正で動作させる

【出力形式】
\`\`\`file:filename.ts
<修正済みコード>
\`\`\`
`;

export async function runFixerAgent(ctx: AgentContext): Promise<AgentResult> {
  console.log(chalk.bold.red('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.red('║  🔧 Fixer Agent                     ║'));
  console.log(chalk.bold.red('╚══════════════════════════════════════╝'));

  if (!ctx.reviewResult) {
    throw new Error('Fixer Agent requires reviewResult in context');
  }

  const issueList = ctx.priorityFixes?.map((i) => `- ${i}`).join('\n') ?? 'なし';
  const suggList = ctx.reviewResult.suggestions.map((s) => `- ${s}`).join('\n');
  const codeToFix = ctx.fixedCode ?? ctx.code ?? '';

  const messages: Message[] = [
    { role: 'system', content: FIXER_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `以下のコードをReviewerの指摘に基づいて修正してください。\n\n` +
        `## 修正対象コード\n\`\`\`\n${codeToFix}\n\`\`\`\n\n` +
        `## 指摘された問題点\n${issueList}\n\n` +
        `## 改善提案\n${suggList || 'なし'}\n\n` +
        `全ての問題を修正した完全なコードを出力してください。`,
    },
  ];

  const output = await callLLM(messages, { printStream: true, label: '🔧 Fixer' });

  return {
    agentName: 'Fixer',
    output,
    messages: [...messages, { role: 'assistant', content: output }],
  };
}
