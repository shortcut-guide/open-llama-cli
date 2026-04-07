// src/agents/coder.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult } from './types.js';

const CODER_SYSTEM_PROMPT = `あなたは実装専用のエンジニアです。

【最重要ルール】
- コードのみ出力する
- ドキュメント・説明・文章は禁止
- README.md / architecture.md / plan.md の生成は禁止
- 必ず実行可能なコードを出す

【実装方針】
- シンプルに動くことを最優先
- 過剰な設計は禁止
- 最小構成で実装する
- 型は必要最低限でOK

【出力形式（厳守）】
必ず以下のみを出力：

\`\`\`file:パス/ファイル名
<完全なコード>
\`\`\`

例：
\`\`\`file:src/index.ts
console.log("hello")
\`\`\`

【禁止事項】
- Markdown文章の出力
- 解説
- 設計書
- requirements.txt
- .mdファイル全般

【必須】
- 最低1つ以上の実行可能ファイルを出力する
`;

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
