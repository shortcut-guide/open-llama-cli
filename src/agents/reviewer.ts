// src/agents/reviewer.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult, ReviewResult } from './types.js';

const REVIEWER_SYSTEM_PROMPT = `あなたは極めて厳格なシニアコードレビュアーです。
今回のタスクは「コードの抽出・リファクタリング」であり、「機能やデザインの変更」ではありません。

【承認条件 - すべてを満たさない限り approved=false】
1. パス一致チェック
   - 生成されたファイルのコードブロックのヘッダーパス（file:...）が、Planの Target Path と完全に一致しているか。

2. 構文・幻覚（ハルシネーション）チェック（最重要）
   - ReactからHTMLタグ（div, img等）やCSSクラス（flex, className等）をimportするような、あり得ない構文が存在しないか？（あれば即FAIL）
   - 未定義の変数が使用されていないか？

3. ロジックとイベントハンドラの欠落チェック
   - 元コードに存在した重要なイベントハンドラ（onError, onClick等）が勝手に削除されていないか？
   - Linkタグによるルーティングなど、主要な機能がdiv等に置き換えられ破壊されていないか？

4. UI/デザインの無断変更チェック
   - 抽出元のUIデザイン、CSSクラス（Tailwind等）、DOM構造を勝手に大幅変更していないか？（頼まれていない絵文字の追加などはFAIL）

【出力形式（JSON厳守）】
以下のフォーマットに従い、エラー内容は必ず「あなたの言葉で具体的に」記述してください。

\`\`\`json
{
  "approved": false,
  "issues": [
    "<Reactからの不正なimportがあります。divやclassNameはimportできません。>",
    "<onErrorハンドラが削除されており、エラー時のフォールバックが機能しません。>",
    "<Linkコンポーネントがdivに変更されており、ナビゲーションが破壊されています。>"
  ],
  "suggestions": []
}
\`\`\``;

export async function runReviewerAgent(ctx: AgentContext): Promise<AgentResult> {
  console.log(chalk.bold.yellow('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.yellow('║  🔍 Reviewer Agent (Strict Mode)    ║'));
  console.log(chalk.bold.yellow('╚══════════════════════════════════════╝'));

  const codeToReview = ctx.fixedCode ?? ctx.code ?? '';

  const messages: Message[] = [
    { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
    {
      role: 'user',
      content:`
## プラン (Target Path & Extract Info)
${ctx.plan}

## 元コード (Source Material)
${ctx.sourceCode ?? 'N/A'}

## レビュー対象コード
${codeToReview}
`.trim(),
    },
  ];

  const raw = await callLLM(messages, { printStream: false });

  let reviewResult: ReviewResult;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON not found');
    const parsed = JSON.parse(jsonMatch[0]);
    reviewResult = {
      approved: Boolean(parsed.approved),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      fileCount: parsed.file_count ?? 0,
      directoryCheck: parsed.directory_check ?? {},
      raw,
    };
  } catch {
    const lowerRaw = raw.toLowerCase();
    reviewResult = {
      approved: lowerRaw.includes('approved') || lowerRaw.includes('問題なし'),
      issues: ['レビュー結果のパースに失敗しました。手動確認を推奨します。'],
      suggestions: [],
      fileCount: 0,
      directoryCheck: {},
      raw,
    };
  }

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