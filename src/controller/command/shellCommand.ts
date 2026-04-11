// src/controller/command/shellCommand.ts
import { spawn } from 'node:child_process';
import chalk from 'chalk';

export async function handleShellCommand(input: string): Promise<boolean> {
  const cmd = input.slice(1).trim();
  if (!cmd) {
    console.log(chalk.yellow('  使い方: !<コマンド>  例: !npm run build'));
    return true;
  }

  const startTime = Date.now();
  console.log(chalk.gray(`\n  $ ${cmd}\n`));

  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });

    child.stdout.on('data', (data: Buffer) => process.stdout.write(data));
    child.stderr.on('data', (data: Buffer) => process.stderr.write(data));

    child.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      if (code === 0) {
        console.log(chalk.green(`\n  ✅ 完了 (${elapsed}s)`));
      } else {
        console.log(chalk.red(`\n  ❌ 終了コード: ${code} (${elapsed}s)`));
      }
      resolve(true);
    });

    child.on('error', (err) => {
      console.log(chalk.red(`\n  ❌ エラー: ${err.message}`));
      resolve(true);
    });
  });
}
