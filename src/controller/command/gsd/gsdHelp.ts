// src/controller/command/gsd/gsdHelp.ts
import chalk from 'chalk';
import { listGsdCommands } from '../../../model/gsd.js';

export async function printGsdHelp(): Promise<void> {
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
