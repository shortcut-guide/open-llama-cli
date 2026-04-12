// src/orchestrator.ts

import chalk from 'chalk';
import { getConfig } from '../config/index.js';

import { runAnalyzer } from '../agents/analyzer/index.js';
import { runPlanner } from '../agents/planner/index.js';
import { runCoderAgent } from '../agents/coder/index.js';
import { runReviewerAgent, parseReviewResult } from '../agents/reviewer/index.js';

import type { AgentContext, TaskType, ReviewResult, AgentRole } from '../agents/types.js';
import { extractFileBlocks } from '../controller/fileProposal/extractFileBlocks.js';

export interface OrchestratorResult {
  finalCode: string;
  iterations: number;
  approved: boolean;
}

/**
 * Gemmaエンドポイントが起動しているか確認する（タイムアウト付き）
 */
async function isGemmaAvailable(): Promise<boolean> {
  const config = getConfig();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(config.LLM_GEMMA_URL, {
      method: 'HEAD',
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    // 2xx〜4xx なら起動していると判断。5xx (502/503 等) は未起動とみなす
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

/**
 * エージェントの役割に基づいてLLM URLを解決する
 * gemmaAvailable=false の場合は analyzer/planner/coder も bonsai へフォールバック
 */
function resolveModelUrl(role: AgentRole, gemmaAvailable: boolean): string {
  const config = getConfig();
  switch (role) {
    case 'analyzer':
    case 'planner':
    case 'coder':
      return gemmaAvailable ? config.LLM_GEMMA_URL : config.LLM_BONSAI_URL;
    case 'reviewer':
    case 'fixer':
      return config.LLM_BONSAI_URL;
    default:
      return config.LLM_API_URL;
  }
}

/**
 * タスクタイプを解決する (明示指定がない場合はキーワードから推測)
 */
function resolveTaskType(userTask: string, explicit: TaskType | null): TaskType {
  if (explicit) return explicit;
  const lower = userTask.toLowerCase();
  if (lower.includes('gsd')) return 'gsd';
  if (lower.includes('リファクタ') || lower.includes('refactor') || lower.includes('分割')) return 'refactor';
  if (lower.includes('修正') || lower.includes('fix') || lower.includes('error')) return 'fix';
  if (lower.includes('分析') || lower.includes('analyze')) return 'analyze';
  return 'new';
}

/**
 * AIが生成したコードが実体のない「ゴミ」かどうかを判定
 */
function isGarbageCode(code: string): boolean {
  if (!code || code.length < 50) return true;
  if (code.includes('Sample Code') || code.includes('TODO: Implement')) return true;

  // ファイルブロックを解析して実コンテンツが存在するか確認
  const blocks = extractFileBlocks(code);
  if (blocks.length === 0) return true;
  const hasRealContent = blocks.some(b => b.content.trim().length > 30);
  return !hasRealContent;
}

/**
 * メインオーケストレーター
 * 全体フロー: Analyzer -> Planner -> (Coder -> Reviewer) x ファイル数
 */
export async function runOrchestrator(
  userTask: string,
  code: string,
  filePath: string,
  explicitType: TaskType | null = null
): Promise<OrchestratorResult> {
  const config = getConfig();
  const taskType = resolveTaskType(userTask, explicitType);

  if (!code.trim()) {
    throw new Error('ソースコードが空です。/read コマンドでファイルを読み込んでから実行してください。');
  }

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  🎯 Orchestrator (Macro Pipeline)   ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝'));

  // Gemmaが起動しているか確認し、未起動の場合はBonsaiにフォールバック
  const gemmaAvailable = await isGemmaAvailable();
  if (!gemmaAvailable) {
    console.log(chalk.yellow('  ⚠️  Gemma is not available — routing analyzer/planner/coder to Bonsai.'));
  }

  /**
   * Step 1: Analyzer (ソースコードの事実解析)
   */
  const analysis = await runAnalyzer({
    code,
    filePath,
    llmUrl: resolveModelUrl('analyzer', gemmaAvailable),
  });

  /**
   * Step 2: Architect Planner (複数ファイル分割の設計図作成)
   */
  console.log(chalk.yellow(`\n📋 Designing Architecture Plan for: ${filePath}`));
  const macroPlan = await runPlanner({
    target: userTask,
    code: code,
    analysis: analysis,
    llmUrl: resolveModelUrl('planner', gemmaAvailable),
  });

  let finalCode = '';
  let overallApproved = true;
  let totalIterations = 0;

  /**
   * Step 3: 設計された各ファイルごとに生成とレビューを実行
   */
  for (const plan of macroPlan.plans) {
    console.log(chalk.bold.magenta(`\n📦 Generating: ${plan.file}`));

    let ctx: AgentContext = {
      userTask,
      taskType,
      agentRole: 'coder',
      iterationCount: 0,
      plan: JSON.stringify(plan),
      sourceCode: code,
      sourcePath: analysis.path,
      llmUrl: resolveModelUrl('coder', gemmaAvailable),
    };

    let coderResult = await runCoderAgent(ctx);
    let codeOutput = coderResult.output;

    if (isGarbageCode(codeOutput)) {
      console.log(chalk.red('  ⚠️ 不完全なコードを検知。再生成を試みます...'));
      coderResult = await runCoderAgent({
        ...ctx,
        userTask: ctx.userTask + '\n\n指示に従い、実装のみを完全なファイル形式で出力してください。',
      });
      codeOutput = coderResult.output;
    }

    let localApproved = false;
    let currentReviewResult: ReviewResult | undefined;

    /**
     * Step 4: Review Loop (指摘 -> ヒント提示 -> 再生成)
     */
    for (let i = 0; i < config.MAX_REVIEW_ITERATIONS; i++) {
      totalIterations++;
      ctx.iterationCount = i;

      const reviewerResult = await runReviewerAgent({
        ...ctx,
        agentRole: 'reviewer',
        code: codeOutput,
        reviewResult: currentReviewResult,
        llmUrl: resolveModelUrl('reviewer', gemmaAvailable),
      });

      // レビューJSONの解析
      let review: ReviewResult;
      try {
        review = parseReviewResult(reviewerResult.output);
      } catch (e) {
        console.log(chalk.red('  ⚠️ レビューJSONの解析に失敗しました。パニック防止のためリトライします。'));
        review = { 
          approved: false, 
          issues: ['Reviewer JSON parse error'], 
          hints: [], 
          suggestions: [],
          raw: reviewerResult.output
        };
      }

      if (review.approved) {
        localApproved = true;
        console.log(chalk.green(`  ✅ Approved: ${plan.file.split('/').pop()}`));
        break;
      }

      if (i < config.MAX_REVIEW_ITERATIONS - 1) {
        console.log(chalk.yellow(`  🔧 再生成 (修正ループ ${i + 1}/${config.MAX_REVIEW_ITERATIONS})...`));
        
        const retryResult = await runCoderAgent({
          ...ctx,
          code: codeOutput,
          reviewResult: review,
        });

        codeOutput = retryResult.output;
        currentReviewResult = review;
      }
    }

    if (!localApproved) {
      overallApproved = false;
      console.log(chalk.red(`  ❌ 指定回数内に承認が得られませんでした: ${plan.file}`));
    }

    finalCode += '\n\n' + codeOutput;
  }

  /**
   * Step 5: サマリー出力
   */
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  📊 Orchestrator Summary            ║'));
  console.log(chalk.bold.cyan('╠══════════════════════════════════════╣'));
  console.log(chalk.bold.cyan(`║  Files Generated: ${String(macroPlan.plans.length).padEnd(18)}║`));
  console.log(chalk.bold.cyan(`║  Total Iterations: ${String(totalIterations).padEnd(17)}║`));
  console.log(chalk.bold.cyan(`║  Approved Overall: ${String(overallApproved).padEnd(17)}║`));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝\n'));

  return {
    finalCode,
    iterations: totalIterations,
    approved: overallApproved,
  };
}
