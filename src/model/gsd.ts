// src/model/gsd.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import TOML from '@iarna/toml';

// ─── 型定義 ────────────────────────────────────────────────────────────────

export interface GsdCommand {
  name: string;
  description: string;
  prompt: string;
}

export interface GsdContext {
  command: GsdCommand;
  resolvedPrompt: string;       // $ARGUMENTS 展開 + @path インライン展開済み
  contextFiles: Map<string, string>; // @path → file content
  planningRoot: string;         // <cwd>/.planning/
  gsdRoot: string;              // get-shit-done/ の絶対パス
}

// ─── パス解決 ──────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function resolveGsdRoot(): string {
  // 実行環境: dist/src/model/ → ../../.. = projectRoot
  const projectRoot = path.resolve(__dirname, '../../..');
  const candidate = path.join(projectRoot, 'get-shit-done');
  return candidate;
}

/**
 * コマンド定義 TOML のパスを返す。
 * 探索順:
 *   1. get-shit-done/commands/gsd/<name>.toml
 *   2. .gemini/commands/gsd/<name>.toml  (Gemini CLI 互換)
 */
async function findTomlPath(name: string, gsdRoot: string): Promise<string> {
  const candidates = [
    path.join(gsdRoot, 'commands', 'gsd', `${name}.toml`),
    path.join(process.cwd(), '.gemini', 'commands', 'gsd', `${name}.toml`),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error(
    `GSDコマンド "${name}" が見つかりません。\n` +
    `探索パス:\n${candidates.map((c) => `  ${c}`).join('\n')}`
  );
}

// ─── コマンドロード ────────────────────────────────────────────────────────

/**
 * TOML ファイルからコマンド定義を読み込む。
 */
export async function loadGsdCommand(name: string): Promise<GsdCommand> {
  const gsdRoot = resolveGsdRoot();
  const tomlPath = await findTomlPath(name, gsdRoot);
  const raw = await fs.readFile(tomlPath, 'utf-8');

  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(raw) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`TOML パースエラー (${tomlPath}): ${(e as Error).message}`);
  }

  const description = typeof parsed['description'] === 'string' ? parsed['description'] : '';
  const prompt      = typeof parsed['prompt']      === 'string' ? parsed['prompt']      : '';

  if (!prompt) {
    throw new Error(`"prompt" フィールドが空です: ${tomlPath}`);
  }

  return { name, description, prompt };
}

/**
 * 利用可能な GSD コマンド名の一覧を返す。
 */
export async function listGsdCommands(): Promise<{ name: string; description: string }[]> {
  const results: { name: string; description: string }[] = [];

  const searchDirs = [
    path.join(resolveGsdRoot(), 'commands', 'gsd'),
    path.join(process.cwd(), '.gemini', 'commands', 'gsd'),
  ];

  const seen = new Set<string>();

  for (const dir of searchDirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.toml')) continue;
      const name = entry.replace(/\.toml$/, '');
      if (seen.has(name)) continue;
      seen.add(name);

      try {
        const cmd = await loadGsdCommand(name);
        results.push({ name, description: cmd.description });
      } catch {
        // 読み込み失敗はスキップ
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── @path コンテキスト解決 ────────────────────────────────────────────────

/**
 * プロンプト中の @/absolute/path または @relative/path を
 * 実ファイル内容でインライン展開する。
 *
 * 展開形式:
 *   <!-- @path: <resolved_path> -->
 *   <file content>
 *   <!-- end @path -->
 */
async function resolveAtPaths(
  prompt: string,
  gsdRoot: string
): Promise<{ expanded: string; files: Map<string, string> }> {
  // @/path または @word/path にマッチ（URLスキームは除外）
  const AT_PATH_RE = /@(\/[^\s]+|[\w.-]+\/[^\s]+)/g;
  const files = new Map<string, string>();
  let expanded = prompt;

  const matches = [...new Set(prompt.match(AT_PATH_RE) ?? [])];

  for (const match of matches) {
    const rawPath = match.slice(1); // @ を除去

    // 解決候補:
    //   1. 絶対パスそのまま
    //   2. ホームディレクトリ相対として解釈した絶対パスを gsdRoot 相対に読み替え
    //   3. gsdRoot 相対
    //   4. cwd 相対
    const candidates: string[] = [];

    if (path.isAbsolute(rawPath)) {
      // 絶対パスで書かれているが、実行環境が異なる場合のフォールバック:
      // パスの末尾部分を get-shit-done/ 以下で探す
      const afterGsd = rawPath.split('/get-shit-done/')[1];
      if (afterGsd) {
        candidates.push(path.join(gsdRoot, afterGsd));
      }
      candidates.push(rawPath);
    } else {
      candidates.push(path.join(gsdRoot, rawPath));
      candidates.push(path.join(process.cwd(), rawPath));
    }

    let content: string | null = null;
    let resolvedPath = '';

    for (const candidate of candidates) {
      try {
        content = await fs.readFile(candidate, 'utf-8');
        resolvedPath = candidate;
        break;
      } catch {
        // try next
      }
    }

    if (content === null) {
      // 読み込めない場合はプレースホルダーで代替（ブロックしない）
      content = `<!-- ⚠️ ファイルが見つかりませんでした: ${rawPath} -->`;
      resolvedPath = rawPath;
    }

    files.set(resolvedPath, content);

    const block =
      `<!-- @path: ${resolvedPath} -->\n${content}\n<!-- end @path -->`;

    expanded = expanded.split(match).join(block);
  }

  return { expanded, files };
}

// ─── コンテキスト組み立て ──────────────────────────────────────────────────

/**
 * コマンド定義 + 引数 + コンテキストファイルを組み立て、
 * LLM に渡す GsdContext を生成する。
 */
export async function resolveGsdContext(
  cmd: GsdCommand,
  args: string
): Promise<GsdContext> {
  const gsdRoot     = resolveGsdRoot();
  const planningRoot = path.join(process.cwd(), '.planning');

  // 1. $ARGUMENTS 置換
  const withArgs = cmd.prompt.replace(/\$ARGUMENTS/g, args.trim());

  // 2. .planning/ の現在状態を末尾に付与
  const planningSnapshot = await buildPlanningSnapshot(planningRoot);

  // 3. @path インライン展開
  const { expanded, files } = await resolveAtPaths(withArgs, gsdRoot);

  // 4. planningSnapshot を追記
  const resolvedPrompt = planningSnapshot
    ? `${expanded}\n\n<current_planning_state>\n${planningSnapshot}\n</current_planning_state>`
    : expanded;

  return {
    command: cmd,
    resolvedPrompt,
    contextFiles: files,
    planningRoot,
    gsdRoot,
  };
}

/**
 * .planning/ 配下の主要ファイルの内容をスナップショットとして返す。
 * 存在しないファイルはスキップ。
 */
async function buildPlanningSnapshot(planningRoot: string): Promise<string> {
  const targets = [
    'PROJECT.md',
    'REQUIREMENTS.md',
    'ROADMAP.md',
    'STATE.md',
  ];

  const parts: string[] = [];

  for (const name of targets) {
    const fullPath = path.join(planningRoot, name);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      parts.push(`### ${name}\n${content}`);
    } catch {
      // 存在しなければスキップ
    }
  }

  return parts.join('\n\n---\n\n');
}

// ─── .planning/ ファイル操作 ───────────────────────────────────────────────

/**
 * .planning/ 配下のファイルを安全に読む。
 * 存在しない場合は null を返す。
 */
export async function readPlanningFile(
  planningRoot: string,
  relative: string
): Promise<string | null> {
  const abs = resolvePlanningPath(planningRoot, relative);
  try {
    return await fs.readFile(abs, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * .planning/ 配下にファイルを書き込む。
 * 中間ディレクトリは自動生成。
 */
export async function writePlanningFile(
  planningRoot: string,
  relative: string,
  content: string
): Promise<void> {
  const abs = resolvePlanningPath(planningRoot, relative);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

/**
 * .planning/ 配下にファイルが存在するか確認する。
 */
export async function planningFileExists(
  planningRoot: string,
  relative: string
): Promise<boolean> {
  const abs = resolvePlanningPath(planningRoot, relative);
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * .planning/ 配下の指定ディレクトリのファイル一覧を返す。
 */
export async function listPlanningFiles(
  planningRoot: string,
  relativeDir: string = '.'
): Promise<string[]> {
  const abs = resolvePlanningPath(planningRoot, relativeDir);
  try {
    const entries = await fs.readdir(abs, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(planningRoot, path.join(e.path ?? abs, e.name)));
  } catch {
    return [];
  }
}

/**
 * パストラバーサル防止付き絶対パス解決。
 */
function resolvePlanningPath(planningRoot: string, relative: string): string {
  const abs = path.resolve(planningRoot, relative);
  const rel = path.relative(planningRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`.planning/ 外へのアクセスは禁止されています: ${abs}`);
  }
  return abs;
}

// ─── Pre-flight Gate 前提定義 ─────────────────────────────────────────────

export interface PreflightRequirement {
  file: string;         // planningRoot からの相対パス
  missingMessage: string; // ファイル不在時のエラーメッセージ
  suggestion: string;   // 解決策の提案コマンド
}

/**
 * コマンド名に対応する pre-flight 前提ファイル一覧を返す。
 */
export function getPreflightRequirements(commandName: string): PreflightRequirement[] {
  const map: Record<string, PreflightRequirement[]> = {
    'new-milestone': [
      {
        file: 'PROJECT.md',
        missingMessage: 'PROJECT.md が存在しません。先に new-project を実行してください。',
        suggestion: '/gsd:new-project',
      },
    ],
    'plan-phase': [
      {
        file: 'REQUIREMENTS.md',
        missingMessage: 'REQUIREMENTS.md が存在しません。',
        suggestion: '/gsd:new-project または /gsd:new-milestone',
      },
      {
        file: 'ROADMAP.md',
        missingMessage: 'ROADMAP.md が存在しません。',
        suggestion: '/gsd:new-project または /gsd:new-milestone',
      },
    ],
    'execute-phase': [
      // フェーズ番号が引数で決まるため動的チェックは gsdAgent 側で実施
    ],
    'verify-work': [
      // 同上
    ],
    'discuss-phase': [
      {
        file: 'ROADMAP.md',
        missingMessage: 'ROADMAP.md が存在しません。',
        suggestion: '/gsd:new-project または /gsd:new-milestone',
      },
    ],
    'complete-milestone': [
      {
        file: 'PROJECT.md',
        missingMessage: 'PROJECT.md が存在しません。',
        suggestion: '/gsd:new-project',
      },
    ],
    'next': [
      {
        file: 'STATE.md',
        missingMessage: 'STATE.md が存在しません。プロジェクトが初期化されていない可能性があります。',
        suggestion: '/gsd:new-project',
      },
    ],
  };

  return map[commandName] ?? [];
}