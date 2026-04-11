// src/controller/command/gsd/gsdCommand.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';

import { loadGsdCommand, resolveGsdContext } from '../../../model/gsd.js';
import { runGsdAgent } from '../../../model/agent/gsdAgent.js';
import { handleFileEditProposals } from '../../fileProposal.js';
import { saveHistory } from '../../../model/history.js';
import { getAutoWrite } from '../../state.js';
import { type CommandContext } from '../types.js';

import { parseGsdInput } from './parseGsdInput.js';
import { handleBuiltin } from './gsdBuiltin.js';
import { printResultSummary } from './gsdResultSummary.js';

export { parseGsdInput } from './parseGsdInput.js';
export type { ParsedGsdInput } from './parseGsdInput.js';

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
    await handleFileEditProposals(result.output, ctx.history, rl, getAutoWrite(), ['.planning/', 'phases/']);
  }

  return true;
}
