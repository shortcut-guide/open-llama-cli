// src/agents/researchAgent.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import chalk from 'chalk';

import { callLLM } from '../model/llm/index.js';
import { getConfig } from '../config/index.js';

const execFileAsync = promisify(execFile);

const MAX_REPOS = 5;
const MAX_CODE = 8;

export interface ResearchResult {
  query: string;
  report: string;
  repoCount: number;
  codeCount: number;
}

interface GhRepo {
  name?: string;
  fullName?: string;
  description?: string;
  url?: string;
  stargazerCount?: number;
  language?: string;
}

interface GhCodeItem {
  repository?: { nameWithOwner?: string; url?: string };
  path?: string;
  url?: string;
}

async function searchRepos(query: string): Promise<GhRepo[]> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'search', 'repos', query,
      '--limit', String(MAX_REPOS),
      '--json', 'name,description,url,stargazerCount,language',
    ]);
    return JSON.parse(stdout) as GhRepo[];
  } catch {
    return [];
  }
}

async function searchCode(query: string): Promise<GhCodeItem[]> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'search', 'code', query,
      '--limit', String(MAX_CODE),
      '--json', 'repository,path,url',
    ]);
    return JSON.parse(stdout) as GhCodeItem[];
  } catch {
    return [];
  }
}

function buildSearchContext(repos: GhRepo[], codeItems: GhCodeItem[]): string {
  const lines: string[] = [];

  if (repos.length > 0) {
    lines.push('## GitHub リポジトリ検索結果\n');
    for (const r of repos) {
      const stars = r.stargazerCount !== undefined ? ` ⭐${r.stargazerCount}` : '';
      const lang = r.language ? ` [${r.language}]` : '';
      lines.push(`### ${r.name}${lang}${stars}`);
      if (r.description) lines.push(`> ${r.description}`);
      if (r.url) lines.push(`URL: ${r.url}`);
      lines.push('');
    }
  }

  if (codeItems.length > 0) {
    lines.push('## GitHub コード検索結果\n');
    for (const c of codeItems) {
      const repo = c.repository?.nameWithOwner ?? '';
      const filePath = c.path ?? '';
      lines.push(`- **${repo}** / \`${filePath}\``);
      if (c.url) lines.push(`  ${c.url}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function runResearchAgent(query: string): Promise<ResearchResult> {
  const config = getConfig();

  console.log(chalk.cyan(`\n  🔍 GitHub検索中: "${query}"...`));

  const [repos, codeItems] = await Promise.all([
    searchRepos(query),
    searchCode(query),
  ]);

  const repoCount = repos.length;
  const codeCount = codeItems.length;

  if (repoCount === 0 && codeCount === 0) {
    console.log(chalk.yellow('  ⚠️  検索結果が見つかりませんでした。gh CLIが認証済みか確認してください。'));
    return {
      query,
      report: `# 調査レポート: ${query}\n\n検索結果が見つかりませんでした。`,
      repoCount: 0,
      codeCount: 0,
    };
  }

  console.log(chalk.gray(`  リポジトリ: ${repoCount}件 / コード: ${codeCount}件`));
  console.log(chalk.cyan('  🤖 LLMで分析中...\n'));

  const searchContext = buildSearchContext(repos, codeItems);

  const prompt = `以下はGitHub上の "${query}" に関する検索結果です。
これらの実装パターン・ライブラリ・アーキテクチャを分析し、
実装に役立つ調査レポートをMarkdown形式で作成してください。

レポートには以下を含めてください:
1. 概要・主要な実装アプローチ
2. よく使われるライブラリ・ツール
3. ベストプラクティス・パターン
4. 参考リポジトリ一覧（URL付き）
5. 実装時の注意点・懸念事項

---

${searchContext}`;

  const report = await callLLM(
    [{ role: 'user', content: prompt }],
    {
      printStream: true,
      label: '📋 Research',
      temperature: 0.3,
      llmUrl: config.LLM_API_URL,
    }
  );

  const header = `# 調査レポート: ${query}\n\n` +
    `> 検索ソース: GitHub リポジトリ ${repoCount}件 / コード ${codeCount}件\n\n`;

  return {
    query,
    report: header + report,
    repoCount,
    codeCount,
  };
}
