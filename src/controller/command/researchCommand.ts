// src/controller/command/researchCommand.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';

import { runResearchAgent } from '../../agents/researchAgent.js';

interface ResearchOptions {
  query: string;
  output: string | null;
}

function parseResearchOptions(trimmed: string): ResearchOptions {
  const args = trimmed.slice('/research'.length).trim();
  const tokens = args.split(/\s+/);

  let output: string | null = null;
  const queryParts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--output' && tokens[i + 1]) {
      output = tokens[++i];
    } else if (tokens[i]) {
      queryParts.push(tokens[i]);
    }
  }

  return { query: queryParts.join(' '), output };
}

export async function handleResearchCommand(trimmed: string): Promise<boolean> {
  const opts = parseResearchOptions(trimmed);

  if (!opts.query) {
    console.log(chalk.yellow('\n  使い方: /research <クエリ> [--output <ファイルパス>]\n'));
    console.log(chalk.gray('  例: /research "TypeScript CLI readline"'));
    console.log(chalk.gray('  例: /research "streaming LLM SSE" --output research.md\n'));
    return true;
  }

  try {
    const result = await runResearchAgent(opts.query);

    if (opts.output) {
      const outputPath = path.resolve(opts.output);
      await fs.writeFile(outputPath, result.report, 'utf-8');
      console.log(chalk.green(`\n  ✅ 調査レポートを保存しました: ${outputPath}\n`));
    } else {
      console.log(chalk.gray(`\n  ℹ️  --output <path> を指定するとMarkdownファイルに保存できます。\n`));
    }

    console.log(chalk.cyan(`  📊 検索結果: リポジトリ ${result.repoCount}件 / コード ${result.codeCount}件\n`));
  } catch (e: unknown) {
    console.error(chalk.red(`\n  ❌ 調査に失敗しました: ${(e as Error).message}\n`));
  }

  return true;
}
