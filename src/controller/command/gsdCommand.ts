// src/controller/command/gsdCommand.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';

import { loadGsdCommand, resolveGsdContext, listGsdCommands } from '../../model/gsd.js';
import { runGsdAgent } from '../../model/agent/gsdAgent.js';
import { handleFileEditProposals } from '../fileProposal.js';
import { saveHistory } from '../../model/history.js';
import { formatStateDisplay, loadGsdState } from '../gsdState.js';
import { getAutoWrite } from '../state.js';
import { type CommandContext } from './types.js';

// ─── 入力パース ────────────────────────────────────────────────────────────

export interface ParsedGsdInput {
  name: string;                        // コマンド名 (例: "new-milestone")
  args: string;                        // コマンド名以降の引数文字列
  flags: Record<string, string | true>; // --flag または --key=value
}

/**
 * "/gsd:<name> [args] [--flags]" をパースする。
 *
 * 例:
 *   "/gsd:new-milestone v2.0 API統合 --auto"
 *   → { name: "new-milestone", args: "v2.0 API統合 --auto", flags: { auto: true } }
 */
export function parseGsdInput(input: string): ParsedGsdInput {
  // prefix "/gsd:" を除去
  const body = input.replace(/^\/gsd:/, '').trim();

  // 最初のトークンがコマンド名
  const spaceIdx = body.indexOf(' ');
  const name  = spaceIdx === -1 ? body : body.slice(0, spaceIdx);
  const rest  = spaceIdx === -1 ? '' : body.slice(spaceIdx + 1).trim();

  // フラグ抽出: "--force", "--wave=2", "--skip-research" など
  const flags: Record<string, string | true> = {};
  const flagRe = /--([a-z][\w-]*)(?:=(\S+))?/g;
  let m: RegExpExecArray | null;
  while ((m = flagRe.exec(rest)) !== null) {
    flags[m[1]] = m[2] ?? true;
  }

  return { name, args: rest, flags };
}

// ─── ヘルプ表示 ────────────────────────────────────────────────────────────

async function printGsdHelp(): Promise<void> {
  console.log(chalk.bold.cyan('\n📋 GSD コマンド一覧\n'));
  console.log(chalk.gray('  使い方: /gsd:<command> [args] [--flags]\n'));

  // 組み込みコマンド
  const builtins = [
    { name: 'help',   description: 'このヘルプを表示' },
    { name: 'status', description: 'ワークフロー状態を表示 (.planning/STATE.md)' },
    { name: 'list',   description: '利用可能なコマンド一覧を表示' },
  ];

  console.log(chalk.yellow('  [組み込み]'));
  for (const cmd of builtins) {
    console.log(`  ${chalk.cyan(`/gsd:${cmd.name.padEnd(20)}`)} ${chalk.gray(cmd.description)}`);
  }

  // 外部 TOML コマンド
  console.log(chalk.yellow('\n  [GSD ワークフロー]'));
  try {
    const cmds = await listGsdCommands();
    for (const cmd of cmds) {
      console.log(`  ${chalk.cyan(`/gsd:${cmd.name.padEnd(20)}`)} ${chalk.gray(cmd.description)}`);
    }
  } catch {
    console.log(chalk.gray('  （コマンド一覧の読み込みに失敗しました）'));
  }

  console.log();
}

// ─── 組み込みコマンド ──────────────────────────────────────────────────────

/**
 * 組み込みコマンドを処理する。
 * 該当すれば true、非該当なら false を返す。
 */
async function handleBuiltin(name: string): Promise<boolean> {
  switch (name) {
    case 'help':
      await printGsdHelp();
      return true;

    case 'status': {
      const display = await formatStateDisplay();
      const state   = await loadGsdState();
      console.log(chalk.bold.cyan('\n📊 GSD ワークフロー状態\n'));
      console.log(display);
      if (state.checkpointData) {
        console.log(chalk.gray(`\n  チェックポイント: ${JSON.stringify(state.checkpointData)}`));
      }
      console.log();
      return true;
    }

    case 'list': {
      console.log(chalk.bold.cyan('\n📂 利用可能な GSD コマンド\n'));
      try {
        const cmds = await listGsdCommands();
        for (const cmd of cmds) {
          console.log(`  ${chalk.cyan(cmd.name.padEnd(22))} ${chalk.gray(cmd.description)}`);
        }
      } catch {
        console.log(chalk.red('コマンド一覧の読み込みに失敗しました。'));
      }
      console.log();
      return true;
    }

    default:
      return false;
  }
}

// ─── メインハンドラ ────────────────────────────────────────────────────────

/**
 * "/gsd:*" コマンドのエントリーポイント。
 * command.ts の handleCommand から呼び出される。
 */
export async function handleGsdCommand(
  userInput: string,
  rl: readline.Interface,
  ctx: CommandContext
): Promise<boolean> {
  const parsed = parseGsdInput(userInput);
  const { name, args } = parsed;

  if (!name) {
    console.log(chalk.red('\n❌ コマンド名が指定されていません。"/gsd:help" でコマンド一覧を確認できます。\n'));
    return true;
  }

  // 組み込みコマンド処理
  const handledByBuiltin = await handleBuiltin(name);
  if (handledByBuiltin) return true;

  // ── TOML コマンド実行 ───────────────────────────────────────────────────
  let cmd;
  try {
    cmd = await loadGsdCommand(name);
  } catch (e) {
    console.log(chalk.red(`\n❌ ${(e as Error).message}`));
    console.log(chalk.gray('  "/gsd:list" で利用可能なコマンドを確認できます。\n'));
    return true;
  }

  // コンテキスト組み立て
  let gsdContext;
  try {
    gsdContext = await resolveGsdContext(cmd, args);
  } catch (e) {
    console.log(chalk.red(`\n❌ コンテキスト解決エラー: ${(e as Error).message}\n`));
    return true;
  }

  // Agent 実行
  let result;
  try {
    result = await runGsdAgent({
      context:  gsdContext,
      rl,
      history:  ctx.history,
      args,
    });
  } catch (e) {
    console.log(chalk.red(`\n❌ GSD Agent エラー: ${(e as Error).message}\n`));
    return true;
  }

  // 結果サマリー表示
  printResultSummary(name, result.gateReached, result.planningWrites);

  if (!result.output) return true;

  // 履歴に追加
  ctx.history.push({ role: 'user',      content: `[GSD:${name}] ${args}` });
  ctx.history.push({ role: 'assistant', content: result.output });
  await saveHistory(ctx.history);

  // .planning/ 以外のファイルブロックは既存の fileProposal に委譲
  if (result.gateReached !== 'aborted') {
    await handleFileEditProposals(result.output, ctx.history, rl, getAutoWrite());
  }

  return true;
}

// ─── ユーティリティ ────────────────────────────────────────────────────────

function printResultSummary(
  name: string,
  gate: string,
  writes: string[]
): void {
  const gateIcon: Record<string, string> = {
    done:      chalk.green('✅ 完了'),
    escalated: chalk.yellow('⚡ エスカレーション'),
    aborted:   chalk.red('🛑 中断'),
  };

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════╗'));
  console.log(chalk.bold.cyan(`║  📊 GSD:${name.slice(0, 22).padEnd(22)}║`));
  console.log(chalk.bold.cyan('╠══════════════════════════════════╣'));
  console.log(chalk.bold.cyan(`║  結果: ${(gateIcon[gate] ?? gate).padEnd(27)}${chalk.bold.cyan('║')}`));

  if (writes.length > 0) {
    console.log(chalk.bold.cyan(`║  .planning/ 書き込み: ${String(writes.length).padEnd(11)}║`));
    for (const w of writes.slice(0, 3)) {
      console.log(chalk.cyan(`║    - ${w.slice(0, 29).padEnd(29)}║`));
    }
    if (writes.length > 3) {
      console.log(chalk.cyan(`║    ... 他 ${String(writes.length - 3).padEnd(22)}║`));
    }
  }

  console.log(chalk.bold.cyan('╚══════════════════════════════════╝\n'));
}