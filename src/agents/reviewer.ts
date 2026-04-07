// src/agents/reviewer.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult, ReviewResult } from './types.js';

const REVIEWER_SYSTEM_PROMPT = `あなたはシニアエンジニアのコードレビュアーです。
生成されたコードをレビューし、品質を評価します。

【レビュー観点】
- 型安全性（TypeScript）
- バグ・ロジックエラーの有無
- セキュリティリスク
- パフォーマンス問題
- コードの可読性・保守性
- エラーハンドリングの適切さ

【出力形式】
必ず以下のJSON形式のみで出力してください（前後にテキスト不要）：

{
  "approved": true または false,
  "issues": ["問題点1", "問題点2"],
  "suggestions": ["改善提案1", "改善提案2"]
}

問題がない場合: approved=true, issues=[], suggestions=[]
問題がある場合: approved=false, issues に具体的な問題を記載`;

export async function runReviewerAgent(ctx: AgentContext): Promise<AgentResult> {
  console.log(chalk.bold.yellow('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.yellow('║  🔍 Reviewer Agent                  ║'));
  console.log(chalk.bold.yellow('╚══════════════════════════════════════╝'));

  const codeToReview = ctx.fixedCode ?? ctx.code ?? '';

  const messages: Message[] = [
    { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `以下のコードをレビューしてください：\n\n` +
        `## タスク概要\n${ctx.userTask}\n\n` +
        (ctx.plan ? `## 実装計画\n${ctx.plan}\n\n` : '') +
        `## レビュー対象コード\n\`\`\`\n${codeToReview}\n\`\`\``,
    },
  ];

  const raw = await callLLM(messages, { printStream: false });

  // JSONパース（LLMが余分なテキストを含む場合に対応）
  let reviewResult: ReviewResult;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON not found');
    const parsed = JSON.parse(jsonMatch[0]);
    reviewResult = {
      approved: Boolean(parsed.approved),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      raw,
    };
  } catch {
    // パース失敗時はテキスト内容から承認判断
    const lowerRaw = raw.toLowerCase();
    reviewResult = {
      approved: lowerRaw.includes('approved') || lowerRaw.includes('問題なし'),
      issues: ['レビュー結果のパースに失敗しました。手動確認を推奨します。'],
      suggestions: [],
      raw,
    };
  }

  // レビュー結果を表示
  if (reviewResult.approved) {
    console.log(chalk.green('\n  ✅ レビュー結果: 承認'));
  } else {
    console.log(chalk.red(`\n  ❌ レビュー結果: 要修正 (イテレーション ${ctx.iterationCount})`));
    if (reviewResult.issues.length > 0) {
      console.log(chalk.red('  問題点:'));
      reviewResult.issues.forEach((i) => console.log(chalk.red(`    - ${i}`)));
    }
    if (reviewResult.suggestions.length > 0) {
      console.log(chalk.yellow('  改善提案:'));
      reviewResult.suggestions.forEach((s) => console.log(chalk.yellow(`    - ${s}`)));
    }
  }

  return {
    agentName: 'Reviewer',
    output: JSON.stringify(reviewResult),
    messages: [...messages, { role: 'assistant', content: raw }],
  };
}

export function parseReviewResult(output: string): ReviewResult {
  try {
    return JSON.parse(output);
  } catch {
    return { approved: false, issues: ['parse error'], suggestions: [], raw: output };
  }
}
