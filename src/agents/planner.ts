// src/agents/planner.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult } from './types.js';

const PLANNER_SYSTEM_PROMPT = `あなたはソフトウェアアーキテクトです。
ユーザーのタスクを受け取り、実装計画を立案します。

【出力形式】
必ず以下のMarkdown形式で出力してください：

## 目的
（タスクの目的を1〜2文で）

## 実装ステップ
1. （ステップ1）
2. （ステップ2）
...

## 対象ファイル
- path/to/file.ts: （変更内容の概要）

## 注意事項
- （考慮すべき技術的な注意点）

コードは書かないでください。計画のみを出力してください。`;

export async function runPlannerAgent(ctx: AgentContext): Promise<AgentResult> {
  console.log(chalk.bold.magenta('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.magenta('║  📋 Planner Agent                   ║'));
  console.log(chalk.bold.magenta('╚══════════════════════════════════════╝'));

  const messages: Message[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `以下のタスクの実装計画を立案してください：\n\n${ctx.userTask}`,
    },
  ];

  const output = await callLLM(messages, { printStream: true, label: '📋 Planner' });

  return {
    agentName: 'Planner',
    output,
    messages: [...messages, { role: 'assistant', content: output }],
  };
}
