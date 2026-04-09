// src/agents/fixer.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult } from './types.js';

const FIXER_SYSTEM_PROMPT = `あなたはリファクタリング専門エンジニアです。

【ミッション】
Reviewer の priority_fixes を完全に解消した、複数ファイル構成のコードを出力する。

【必須アクション】
priority_fixes に記載された項目を1つ残らず修正すること。
修正後のファイル数は必ず5以上にすること。

【出力手順】
1. まず修正後のファイルツリーを出力
2. 変更があるファイルを全て出力（変更なしでも全ファイル出力）

【出力形式】
\`\`\`修正後のファイルツリー：
src/
├── types/index.ts
├── services/xxxService.ts
...
\`\`\`

\`\`\`file:src/types/index.ts
<完全なコード>
\`\`\`

【禁止】
- 指摘された問題を無視して元のコードを維持する
- ファイル数を減らす
- 分割済みコードを1ファイルに戻す

【ファイル名の修正】
priority_fixes にプレースホルダー名の指摘がある場合：
- 旧ファイルは削除し、新しい具体名のファイルとして出力する
- ファイルツリーも更新して出力する

【実装の充足】
- スタブ・空関数を実際の実装に置き換える
- TODO コメントは実際のコードに置き換える
- 型定義は実際のデータ構造で定義する

`;

export async function runFixerAgent(ctx: AgentContext): Promise<AgentResult> {
  console.log(chalk.bold.red('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.red('║  🔧 Fixer Agent                     ║'));
  console.log(chalk.bold.red('╚══════════════════════════════════════╝'));

  if (!ctx.reviewResult) {
    throw new Error('Fixer Agent requires reviewResult in context');
  }

  const issueList = ctx.priorityFixes?.map((i) => `- ${i}`).join('\n') ?? 'なし';
  const suggList = ctx.reviewResult.suggestions.map((s: string) => `- ${s}`).join('\n');
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

  const output = await callLLM(messages, { 
    printStream: true, 
    label: '🔧 Fixer',
    llmUrl: ctx.llmUrl,
  });

  return {
    agentName: 'Fixer',
    output,
    messages: [...messages, { role: 'assistant', content: output }],
  };
}
