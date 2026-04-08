// src/agents/reviewer.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult, ReviewResult } from './types.js';

const REVIEWER_SYSTEM_PROMPT = `あなたは極めて厳格かつ親切なシニアコードレビュアーです。

【承認条件 - すべてを満たさない限り approved=false】
1. 丸コピの絶対禁止（最重要）
   - サブコンポーネント（画像や情報）の抽出において、元コードが丸ごとコピーされていないか？
   - 例: 画像コンポの抽出なのに「price」や「review」などの無関係なコードが含まれていたら即FAIL。
   - 例: 情報コンポの抽出なのに「img」タグが含まれていたら即FAIL。

2. 統合タスクの正確性（メインコンポーネントの場合）
   - サブコンポーネントを \`import\` し、JSX内で \`<SubComponent />\` のように正しく呼び出しているか？
   - 元のインラインの長いUIが残ったままならFAIL。

【出力形式（JSON厳守）】
以下のフォーマットに従い記述してください。
※ Coderがそのままコピー＆ペーストして使える【完全な修正コード】を \`hints\` 配列に記述してください。「...」などの省略記号は絶対に使用しないでください（ハルシネーションの原因になります）。

\`\`\`json
{
  "approved": false,
  "issues": [
    "画像コンポーネントの抽出ですが、無関係な価格(price)や名前(name)、<Link>ラッパーが残っています（丸コピ状態です）。"
  ],
  "suggestions": [
    "画像とフォールバックのUIだけを残し、それ以外をすべて削除してください。"
  ],
  "hints": [
    "import React, { useState } from 'react';\\nimport { Product } from './types';\\n\\nexport default function ProductCardImage({ product }: { product: Product }) {\\n  const [imageError, setImageError] = useState(false);\\n\\n  return (\\n    <div className=\\"w-28 h-28 shrink-0\\">\\n      {product.imageUrl && !imageError ? (\\n        <img src={product.imageUrl} alt={product.name} onError={() => setImageError(true)} className=\\"object-cover w-full h-full rounded\\" />\\n      ) : (\\n        <div className=\\"w-full h-full bg-gray-200 rounded flex items-center justify-center text-gray-500\\">📦</div>\\n      )}\\n    </div>\\n  );\\n}\\n"
  ]
}
\`\`\``;

export async function runReviewerAgent(ctx: AgentContext): Promise<AgentResult> {
  const codeToReview = ctx.fixedCode ?? ctx.code ?? '';
  const messages: Message[] = [
    { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
    {
      role: 'user',
      content:`
## プラン (Target Path & Extract Focus)
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