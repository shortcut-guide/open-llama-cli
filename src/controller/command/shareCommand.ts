// src/controller/command/shareCommand.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import chalk from 'chalk';

import type { CommandContext } from './types.js';
import { historyToMarkdown, historyToHtml } from '../../model/history/markdown.js';

const execFileAsync = promisify(execFile);

interface ShareOptions {
  format: 'markdown' | 'html';
  output: string | null;
  gist: boolean;
}

function parseShareOptions(trimmed: string): ShareOptions {
  const args = trimmed.slice('/share'.length).trim();
  const tokens = args.split(/\s+/);

  let format: 'markdown' | 'html' = 'markdown';
  let output: string | null = null;
  let gist = false;

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--format' && tokens[i + 1]) {
      const f = tokens[++i].toLowerCase();
      if (f === 'html') format = 'html';
      else format = 'markdown';
    } else if (tokens[i] === '--output' && tokens[i + 1]) {
      output = tokens[++i];
    } else if (tokens[i] === '--gist') {
      gist = true;
    }
  }

  return { format, output, gist };
}

export async function handleShareCommand(trimmed: string, ctx: CommandContext): Promise<boolean> {
  const opts = parseShareOptions(trimmed);
  const ext = opts.format === 'html' ? 'html' : 'md';
  const timestamp = Date.now();
  const defaultFileName = `session-${timestamp}.${ext}`;
  const outputPath = path.resolve(opts.output ?? defaultFileName);

  const content =
    opts.format === 'html'
      ? historyToHtml(ctx.history)
      : historyToMarkdown(ctx.history);

  try {
    await fs.writeFile(outputPath, content, 'utf-8');
    console.log(chalk.green(`\n  ✅ セッションを保存しました: ${outputPath}`));
  } catch (e: unknown) {
    console.error(chalk.red(`\n  ❌ ファイル保存に失敗しました: ${(e as Error).message}\n`));
    return true;
  }

  if (opts.gist) {
    console.log(chalk.yellow('\n  ⚠️  警告: Gistに公開されます。APIキーやパスワードなどの機密情報が含まれていないか確認してください。'));
    try {
      const { stdout } = await execFileAsync('gh', [
        'gist', 'create', outputPath,
        '--desc', `open-llama-cli session export`,
        '--web',
      ]);
      if (stdout.trim()) {
        console.log(chalk.cyan(`  🔗 Gist URL: ${stdout.trim()}`));
      }
    } catch (e: unknown) {
      const msg = (e as Error).message ?? String(e);
      if (msg.includes('not found') || msg.includes('ENOENT')) {
        console.error(chalk.red('  ❌ `gh` CLIが見つかりません。https://cli.github.com からインストールしてください。'));
      } else {
        console.error(chalk.red(`  ❌ Gistの作成に失敗しました: ${msg}`));
      }
    }
  }

  console.log('');
  return true;
}
