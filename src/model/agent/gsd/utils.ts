// src/model/agent/gsd/utils.ts
import chalk from 'chalk';

export function extractPhaseNumber(args: string): number | null {
  const m = args.match(/\b(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}

export function buildRetryPrompt(iteration: number): string {
  return (
    `[Retry ${iteration}] 前回の出力が不完全でした。\n` +
    `指示に従い、完全な内容を再出力してください。省略・placeholder は禁止です。`
  );
}

export function isTerminalCommand(name: string): boolean {
  return ['complete-milestone', 'cleanup'].includes(name);
}

export function printRevisionHeader(name: string, i: number, max: number): void {
  if (i === 0) {
    console.log(chalk.bold.cyan(`\n╔══════════════════════════════════╗`));
    console.log(chalk.bold.cyan(`║  🚀 GSD: ${name.padEnd(22)}║`));
    console.log(chalk.bold.cyan(`╚══════════════════════════════════╝`));
  } else {
    console.log(chalk.yellow(`\n🔄 リトライ ${i}/${max - 1}...`));
  }
}
