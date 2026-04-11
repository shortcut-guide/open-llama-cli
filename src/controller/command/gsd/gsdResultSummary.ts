// src/controller/command/gsd/gsdResultSummary.ts
import chalk from 'chalk';

export function printResultSummary(
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
