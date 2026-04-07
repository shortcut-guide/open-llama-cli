// src/agents/fixer.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult } from './types.js';

const FIXER_SYSTEM_PROMPT = `あなたはデバッグの専門家です。
Reviewerが指摘した問題点を修正し、改善されたコードを出力します。

【修正ルール】
- Reviewerの指摘を全て対応する
- 修正以外の箇所は変更しない
- 修正理由をコメントで明記する

【出力形式】
修正後のファイルを必ず以下の形式で出力：

\`\`\`file:パス/ファイル名.ts
// 修正後の完全なコード（省略なし）
\`\`\`

複数ファイルがある場合は繰り返して出力してください。`;

export async function runFixerAgent(ctx: AgentContext): Promise<AgentResult> {
  console.log(chalk.bold.red('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.red('║  🔧 Fixer Agent                     ║'));
  console.log(chalk.bold.red('╚══════════════════════════════════════╝'));

  if (!ctx.reviewResult) {
    throw new Error('Fixer Agent requires reviewResult in context');
  }

  const issueList = ctx.reviewResult.issues.map((i) => `- ${i}`).join('\n');
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
