// src/controller/command/gsd/gsdBuiltin.ts
import chalk from 'chalk';
import { listGsdCommands } from '../../../model/gsd/index.js';
import { formatStateDisplay, loadGsdState } from '../../gsdState.js';
import { printGsdHelp } from './gsdHelp.js';

/**
 * 組み込みコマンドを処理する。
 * 該当すれば true、非該当なら false を返す。
 */
export async function handleBuiltin(name: string): Promise<boolean> {
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
