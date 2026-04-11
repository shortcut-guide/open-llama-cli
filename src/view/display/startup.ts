// src/view/display/startup.ts
import chalk from 'chalk';

export function printBanner(): void {
  console.log(chalk.bold.cyan('\n🤖 AI Chat CLI — Multi-Agent + GSD Mode\n'));
}

export function printAutoWriteStatus(autoWrite: boolean): void {
  console.log(
    autoWrite
      ? chalk.green('  🟢 自動書き込み: ON')
      : chalk.gray('  ⚪ 自動書き込み: OFF（確認あり）')
  );
}

export function printWorkspaceInfo(workspaceRoot: string): void {
  console.log(chalk.gray(`  ワークスペース: ${workspaceRoot}`));
}

export function printHint(): void {
  console.log(
    chalk.gray(
      '  "/help" でコマンド一覧 | "/gsd:help" でGSDコマンド一覧 | "/agent <task>" でMulti-Agentモード\n'
    )
  );
}
