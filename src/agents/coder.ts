// src/agents/coder.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult } from './types.js';

const CODER_SYSTEM_PROMPT = `あなたは優秀なTypeScriptエンジニアです。
Plannerが作成した実装計画に基づき、高品質なコードを生成します。

【コード生成ルール】
- TypeScriptの型安全性を徹底する
- 関数は単一責任原則に従う
- エラーハンドリングを適切に実装する
- コメントは日本語で記載する

【出力形式】
ファイルを生成・更新する場合は必ず以下の形式で出力：

\`\`\`file:パス/ファイル名.ts
// ファイルの内容（省略なし・完全なコード）
\`\`\`

複数ファイルがある場合は繰り返して出力してください。
コードは省略せず、完全なファイル内容を出力してください。`;

export async function runCoderAgent(ctx: AgentContext): Promise<AgentResult> {
  console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║  💻 Coder Agent                     ║'));
  console.log(chalk.bold.blue('╚══════════════════════════════════════╝'));

  const userContent = ctx.plan
    ? `以下の実装計画に基づいてコードを生成してください：\n\n## 実装計画\n${ctx.plan}\n\n## 元のタスク\n${ctx.userTask}`
    : `以下のタスクを実装してください：\n\n${ctx.userTask}`;

  const messages: Message[] = [
    { role: 'system', content: CODER_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  // Reviewer からのフィードバックがある場合は追記
  if (ctx.reviewResult && !ctx.reviewResult.approved) {
    const issueList = ctx.reviewResult.issues.map((i) => `- ${i}`).join('\n');
    const suggList = ctx.reviewResult.suggestions.map((s) => `- ${s}`).join('\n');
    messages.push({
      role: 'assistant',
      content: ctx.code ?? '',
    });
    messages.push({
      role: 'user',
      content:
        `Reviewerから以下のフィードバックがありました。修正して再生成してください：\n\n` +
        `## 問題点\n${issueList}\n\n## 改善提案\n${suggList}`,
    });
  }

  const output = await callLLM(messages, { printStream: true, label: '💻 Coder' });

  return {
    agentName: 'Coder',
    output,
    messages: [...messages, { role: 'assistant', content: output }],
  };
}
