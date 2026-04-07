// src/orchestrator.ts
import chalk from 'chalk';
import { getConfig } from './config.js';
import { runPlannerAgent } from './agents/planner.js';
import { runCoderAgent } from './agents/coder.js';
import { runReviewerAgent, parseReviewResult } from './agents/reviewer.js';
import { runFixerAgent } from './agents/fixer.js';
import type { AgentContext } from './agents/types.js';

export interface OrchestratorResult {
  finalCode: string;
  plan: string;
  iterations: number;
  approved: boolean;
}

/**
 * タスク文字列からAgent実行モードを判断する
 * - "simple": Planner不要の単純質問
 * - "code": フルAgent pipeline
 */
function classifyTask(userTask: string): 'simple' | 'code' {
  const codeKeywords = [
    '実装', '作成', '修正', 'コード', 'バグ', 'リファクタリング',
    'create', 'implement', 'fix', 'refactor', 'build', 'write',
    'generate', 'update', 'add', 'delete', 'function', 'class',
    'ファイル', 'component', 'api', 'endpoint',
  ];
  const lower = userTask.toLowerCase();
  return codeKeywords.some((kw) => lower.includes(kw)) ? 'code' : 'simple';
}

function isGarbageCode(code: string): boolean {
  if (!code) return true;

  return (
    code.length < 80 || // 短すぎ
    code.includes("processInput") ||
    code.includes("validateInput") ||
    code.includes("main()") ||
    !code.includes("file:") // フォーマット違反
  );
}

export async function runOrchestrator(userTask: string): Promise<OrchestratorResult> {
  const config = getConfig();
  const mode = classifyTask(userTask);

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  🎯 Orchestrator                    ║'));
  console.log(chalk.bold.cyan(`╠══════════════════════════════════════╣`));
  console.log(chalk.bold.cyan(`║  Mode: ${mode.padEnd(29)}║`));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝'));

  const ctx: AgentContext = {
    userTask,
    iterationCount: 0,
  };

  // ─── Step 1: Planner ───────────────────────────────────────────
  const plannerResult = await runPlannerAgent(ctx);
  ctx.plan = plannerResult.output;

  // ─── Step 2: Coder ────────────────────────────────────────────
  const coderResult = await runCoderAgent(ctx);
  ctx.code = coderResult.output;

  if (isGarbageCode(ctx.code)) {
    console.log("⚠️ ダミーコード検知 → 再生成");

    const retry = await runCoderAgent({
      ...ctx,
      userTask: ctx.userTask + "\n\n具体的な実装をしろ。ダミーコード禁止。"
    });

    ctx.code = retry.output;
  }

  // ─── Step 3: Review → Fix loop ────────────────────────────────
  let approved = false;
  let finalCode = ctx.code;

  for (let i = 0; i < config.MAX_REVIEW_ITERATIONS; i++) {
    ctx.iterationCount = i + 1;

    const reviewerResult = await runReviewerAgent(ctx);
    const review = parseReviewResult(reviewerResult.output);

    // fallback
    if (!review.priority_fixes) {
      review.priority_fixes = review.issues.slice(0, 3);
    }

    ctx.reviewResult = review;

    if (review.approved) {
      approved = true;
      console.log(chalk.bold.green(`\n  ✅ 承認済み (イテレーション ${i + 1}/${config.MAX_REVIEW_ITERATIONS})`));
      break;
    }

    if (i < config.MAX_REVIEW_ITERATIONS - 1) {
      // Fixer で修正
      ctx.priorityFixes = review.priority_fixes;
      const fixerResult = await runFixerAgent(ctx);
      ctx.fixedCode = fixerResult.output;
      finalCode = fixerResult.output;

      if (isGarbageCode(finalCode)) {
        console.log("⚠️ 修正後もダミー → 再生成");

        const retry = await runCoderAgent({
          ...ctx,
          userTask: ctx.userTask + "\n\n必ず実用的なコードを出せ。ダミー禁止。"
        });

        finalCode = retry.output;
      }
    } else {
      // 最大イテレーション到達
      console.log(
        chalk.yellow(
          `\n  ⚠️ 最大イテレーション(${config.MAX_REVIEW_ITERATIONS})に達しました。最終コードを採用します。`
        )
      );
      finalCode = ctx.fixedCode ?? ctx.code ?? '';
    }
  }

  // ─── 完了サマリ ────────────────────────────────────────────────
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  📊 Orchestrator Summary            ║'));
  console.log(chalk.bold.cyan('╠══════════════════════════════════════╣'));
  console.log(chalk.bold.cyan(`║  Iterations : ${String(ctx.iterationCount).padEnd(22)}║`));
  console.log(chalk.bold.cyan(`║  Approved   : ${String(approved).padEnd(22)}║`));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝\n'));

  return {
    finalCode,
    plan: ctx.plan ?? '',
    iterations: ctx.iterationCount,
    approved,
  };
}
