// src/orchestrator.ts
import chalk from 'chalk';
import { getConfig } from './config.js';
import { runPlannerAgent } from './agents/planner.js';
import { runCoderAgent } from './agents/coder.js';
import { runReviewerAgent, parseReviewResult } from './agents/reviewer.js';
import { runFixerAgent } from './agents/fixer.js';
import type { AgentContext,TaskType } from './agents/types.js';

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
function resolveTaskType(userTask: string, explicit: TaskType | null): TaskType {
  // 明示指定があればそのまま使用
  if (explicit) {
    console.log(chalk.cyan(`  📌 TaskType: ${explicit} (明示指定)`));
    return explicit;
  }

  // 自動推定ロジック
  const lower = userTask.toLowerCase();

  const patterns: { type: TaskType; keywords: string[] }[] = [
    {
      type: 'FIX',
      keywords: ['バグ', '修正', 'エラー', 'fix', 'bug', 'error', 'broken', '直して']
    },
    {
      type: 'REFACTOR',
      keywords: ['リファクタ', 'リファクタリング', 'refactor', '整理', '改善', 'clean']
    },
    {
      type: 'EXTEND',
      keywords: ['追加', '拡張', 'add', 'extend', '機能追加', 'feature']
    },
    {
      type: 'ANALYZE',
      keywords: ['分析', 'レビュー', 'analyze', 'review', '確認', 'check']
    },
    {
      type: 'NEW',
      keywords: ['作成', '新規', '実装', 'create', 'implement', 'build', 'write', 'generate', 'new']
    },
  ];

  for (const pattern of patterns) {
    if (pattern.keywords.some((kw) => lower.includes(kw))) {
      console.log(chalk.gray(`  🤖 TaskType: ${pattern.type} (自動推定)`));
      return pattern.type;
    }
  }

  // デフォルト
  console.log(chalk.gray(`  🤖 TaskType: NEW (デフォルト)`));
  return 'NEW';
}

function isWeakOutput(code: string): boolean {
  return (
    code.length < 120 ||
    !code.includes("file:") ||
    code.includes("processInput") ||
    code.split("\n").length < 10
  );
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

export async function runOrchestrator(userTask: string, explicitType: TaskType | null = null): Promise<OrchestratorResult> {
  const config = getConfig();
  const taskType = resolveTaskType(userTask, explicitType);

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  🎯 Orchestrator                    ║'));
  console.log(chalk.bold.cyan(`╠══════════════════════════════════════╣`));
  console.log(chalk.bold.cyan(`║  Mode: ${taskType.padEnd(29)}║`));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝'));

  const ctx: AgentContext = {
    userTask,
    taskType,
    iterationCount: 0,
  };

  // ANALYZE モードはPlanner+Reviewerのみ（Coder/Fixer不要）
  if (taskType === 'ANALYZE') {
    const plannerResult = await runPlannerAgent(ctx);
    const reviewerResult = await runReviewerAgent({ ...ctx, code: userTask });
    return {
      finalCode: reviewerResult.output,
      plan: plannerResult.output,
      iterations: 0,
      approved: true,
    };
  }

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

    if (review.approved && isWeakOutput(ctx.code ?? "")) {
      console.log("⚠️ 弱いコード検知 → 強制リジェクト");

      review.approved = false;
      review.issues.push("コードが不十分またはダミー");
    }

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
