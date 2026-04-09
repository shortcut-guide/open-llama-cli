// src/controller/systemCommands.ts
import chalk from 'chalk';

import { clearHistory } from '../../model/history.js';
import { getAutoWrite, setAutoWrite } from '../state.js';

export async function handleAutowriteCommand(trimmed: string): Promise<boolean> {
  const arg = trimmed.slice(10).trim().toLowerCase();
  if (arg === 'on') setAutoWrite(true);
  else if (arg === 'off') setAutoWrite(false);
  else setAutoWrite(!getAutoWrite());

  console.log(
    getAutoWrite()
      ? chalk.green('  🟢 自動書き込み: ON')
      : chalk.gray('  ⚪ 自動書き込み: OFF（確認あり）')
  );
  return true;
}

export async function handleClearCommand(): Promise<boolean> {
  try {
    await clearHistory();
    console.log(chalk.green('  ✅ 履歴をクリアしました。'));
  } catch {
    console.log(chalk.gray('  履歴ファイルが存在しません。'));
  }
  return true;
}

export function handleHelpCommand(): boolean {
  const autoStatus = getAutoWrite() ? chalk.green('ON') : chalk.gray('OFF');
  console.log(chalk.cyan(`
┌──────────────────────────────────────────────────────────────────┐
│  コマンド一覧                                                      │
├────────────────────────────────┬─────────────────────────────────┤
│  /agent gsd <subcmd> <args>    │ GSDモード (init|discuss|plan|...) │
│  /agent <task>                 │ Multi-Agent モードで実行         │
│  /autowrite [on|off]           │ 自動書き込みトグル               │
│  /search <glob>                │ globでファイル検索               │
│  /search <glob> --content <re> │ ファイル内容を正規表現検索       │
│  /read <path>                  │ ファイル表示 + 次発言へ注入      │
│  /write <path>                 │ 対話入力でファイル書き込み       │
│  /replace <path> <s> => <r>    │ 文字列置換                       │
│  /delete <path>                │ ファイル削除（確認あり）          │
│  /clear                        │ チャット履歴をクリア             │
│  /exit                         │ 終了                             │
└────────────────────────────────┴─────────────────────────────────┘
  自動書き込み現在: `) + autoStatus + '\n');
  return true;
}

export function handleExitCommand(): never {
  console.log(chalk.cyan('\n👋 終了します。\n'));
  process.exit(0);
}
