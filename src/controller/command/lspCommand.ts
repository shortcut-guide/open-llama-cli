// src/controller/command/lspCommand.ts
import chalk from 'chalk';
import { getLspStatus, hasLspConfig } from '../../model/lsp/index.js';

export async function handleLspCommand(trimmed: string): Promise<boolean> {
  const args = trimmed.slice(4).trim(); // strip '/lsp'

  if (args === '' || args === 'status') {
    return showLspStatus();
  }

  console.log(chalk.yellow(`  ⚠️  不明なLSPサブコマンド: ${args}`));
  console.log(chalk.gray('  使用法: /lsp status'));
  return true;
}

function showLspStatus(): boolean {
  if (!hasLspConfig()) {
    console.log(chalk.gray('\n  ℹ️  LSPサーバーが設定されていません。\n'));
    console.log(chalk.gray('  以下のいずれかのファイルを作成して言語サーバーを設定できます:'));
    console.log(chalk.gray('    ~/.lcli/lsp-config.json   (ユーザーレベル設定)'));
    console.log(chalk.gray('    .github/lsp.json           (リポジトリレベル設定)'));
    console.log(chalk.cyan('\n  設定例:'));
    console.log(chalk.gray(JSON.stringify({
      servers: [
        {
          name: 'typescript',
          command: 'typescript-language-server',
          args: ['--stdio'],
          extensions: ['.ts', '.tsx', '.js', '.jsx'],
        },
      ],
    }, null, 2).split('\n').map(l => `    ${l}`).join('\n')));
    console.log('');
    return true;
  }

  const statuses = getLspStatus();
  console.log(chalk.cyan(`\n  🔌 LSPサーバー状態 (${statuses.length} 件設定済み)\n`));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));

  for (const s of statuses) {
    const indicator = s.running ? chalk.green('🟢 起動中') : chalk.red('🔴 停止中');
    const pid = s.running && s.pid ? chalk.gray(` [PID: ${s.pid}]`) : '';
    const exts = chalk.gray(s.extensions.join(', '));
    console.log(`  ${indicator}${pid}  ${chalk.white(s.name)}  (${exts})`);
    if (s.error) {
      console.log(chalk.red(`     ⚠ エラー: ${s.error}`));
    }
  }

  console.log('');
  return true;
}
