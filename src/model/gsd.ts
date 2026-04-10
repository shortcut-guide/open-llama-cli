// src/model/gsd.ts
import * as fs from 'node:fs/promises';
import { type Dirent } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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
 *   1. get-shit-done/commands/gsd/<name>.toml  (GSD ネイティブ)
 *   2. <cwd>/.planning/commands/gsd/<name>.toml (プロジェクトローカル上書き)
 *   3. .gemini/commands/gsd/<name>.toml  (後方互換: Gemini CLI 共有インストール)
 *
 * NOTE: .gemini/ は Gemini CLI 専用スペース。GSD コマンドは get-shit-done/ に配置すること。
 */
async function findTomlPath(name: string, gsdRoot: string): Promise<string> {
  const candidates = [
    path.join(gsdRoot, 'commands', 'gsd', `${name}.toml`),
    path.join(process.cwd(), '.planning', 'commands', 'gsd', `${name}.toml`),
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
    path.join(process.cwd(), '.planning', 'commands', 'gsd'),
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
  const gsdToolsBin  = path.join(gsdRoot, 'bin', 'gsd-tools.cjs');
  const phaseNum     = extractPhaseNumberFromArgs(args);

  // 1. $ARGUMENTS 置換
  let withArgs = cmd.prompt.replace(/\$ARGUMENTS/g, args.trim());

  // 2. TOML に埋め込まれた古い .gemini/get-shit-done/ パスを実際の gsdRoot に修正
  withArgs = withArgs.replace(
    /['"](\/[^'"]*\/\.gemini\/get-shit-done\/bin\/gsd-tools\.cjs)['"]/g,
    `"${gsdToolsBin}"`
  );

  // 3. .planning/ の現在状態を末尾に付与（フェーズ固有ファイルも含む）
  const planningSnapshot = await buildPlanningSnapshot(planningRoot, phaseNum);

  // 4. gsd-tools.cjs init を事前実行してフェーズ情報を注入
  //    (プロンプト内のシェルコマンドを LLM が実行できないため、結果を直接提供)
  const initData = await preExecuteGsdToolsInit(gsdToolsBin, cmd.name, phaseNum);

  // 5. @path インライン展開
  const { expanded, files } = await resolveAtPaths(withArgs, gsdRoot);

  // 6. @path 展開後のコンテンツに残る .gemini/get-shit-done/ パスも修正
  let resolvedPrompt = expanded.replace(
    /["'`]?(\/[^"'`\s]*\/\.gemini\/get-shit-done\/bin\/gsd-tools\.cjs)["'`]?/g,
    `"${gsdToolsBin}"`
  );

  // 7. ノーシェル実行モードの宣言（先頭に配置して最優先指示とする）
  const noShellInstruction =
    '<execution_environment>\n' +
    'This workflow is running inside open-llama-cli — a pure LLM runtime with NO shell execution capability.\n\n' +
    'CRITICAL RULES:\n' +
    '1. DO NOT output bash/shell code blocks. You cannot execute them and they will confuse the user.\n' +
    '2. ALL gsd-tools.cjs command outputs have been pre-computed and are provided in <gsd_init_data> below.\n' +
    '   Treat those values as already-resolved variables (INIT, AGENT_SKILLS_*, etc.).\n' +
    '3. Skip every "Setup" / "MANDATORY FIRST STEP" bash execution block — the data is already available.\n' +
    '4. Proceed directly to the substantive workflow steps (questioning, analysis, file generation).\n' +
    '5. RUNTIME is "open-llama-cli". Ignore runtime-detection bash blocks.\n' +
    '</execution_environment>\n\n';

  resolvedPrompt = noShellInstruction + resolvedPrompt;

  if (planningSnapshot) {
    resolvedPrompt += `\n\n<current_planning_state>\n${planningSnapshot}\n</current_planning_state>`;
  }

  if (initData) {
    resolvedPrompt += `\n\n<gsd_init_data>\n` +
      `以下は gsd-tools.cjs init の実行済み結果です。ワークフロー内の bash セットアップブロックが取得するはずだったデータです。\n` +
      `変数として扱ってください: INIT, AGENT_SKILLS_RESEARCHER, AGENT_SKILLS_SYNTHESIZER, AGENT_SKILLS_ROADMAPPER など。\n` +
      `${initData}\n</gsd_init_data>`;
  }

  // 8. ファイル出力フォーマットの明示（ファイルを書くコマンド用）
  if (isFileWritingCommand(cmd.name)) {
    resolvedPrompt +=
      '\n\n<file_output_instruction>\n' +
      'このツールではシェルコマンドを実行できません。' +
      'CONTEXT.md / PLAN.md / SUMMARY.md などを作成・更新する場合は、' +
      '必ず以下の形式でファイル内容を出力してください。この形式以外ではディスクに書き込まれません。\n\n' +
      '```file:.planning/phases/{phase_dir}/{filename}\n' +
      '...ファイルの完全な内容...\n' +
      '```\n\n' +
      'PROJECT.md / REQUIREMENTS.md / ROADMAP.md などトップレベルファイルは:\n' +
      '```file:.planning/{filename}\n' +
      '...ファイルの完全な内容...\n' +
      '```\n\n' +
      'bashスクリプトや mkdir / cat コマンドは使わないでください。\n' +
      '</file_output_instruction>';
  }

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
 * 存在しないファイルはスキップ。phaseNum が指定されている場合はフェーズ固有ファイルも含む。
 */
async function buildPlanningSnapshot(planningRoot: string, phaseNum?: number | null): Promise<string> {
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

  // フェーズ番号が指定されている場合、フェーズ固有ファイルを追加
  if (phaseNum !== null && phaseNum !== undefined) {
    const phaseFiles = await loadPhaseFiles(planningRoot, phaseNum);
    parts.push(...phaseFiles);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 指定フェーズのディレクトリを探し、CONTEXT.md / RESEARCH.md / PLAN.md を読み込む。
 */
async function loadPhaseFiles(planningRoot: string, phaseNum: number): Promise<string[]> {
  const phasesDir = path.join(planningRoot, 'phases');
  const parts: string[] = [];

  let dirEntries: Dirent[] = [];
  try {
    dirEntries = await fs.readdir(phasesDir, { withFileTypes: true });
  } catch {
    return parts;
  }

  // ディレクトリのみを対象にし、フェーズ番号に一致するものを探す
  const paddedNum = String(phaseNum).padStart(2, '0');
  const phaseEntry = dirEntries.find(
    (e) =>
      e.isDirectory() &&
      (e.name === String(phaseNum) ||
        e.name.startsWith(`${phaseNum}-`) ||
        e.name.startsWith(`${paddedNum}-`) ||
        e.name === paddedNum)
  );

  if (!phaseEntry) return parts;

  const phaseDir = phaseEntry.name;
  const phaseRoot = path.join(phasesDir, phaseDir);
  const phaseTargets = [
    { pattern: `${paddedNum}-CONTEXT.md`, fallback: 'CONTEXT.md' },
    { pattern: `${paddedNum}-RESEARCH.md`, fallback: 'RESEARCH.md' },
    { pattern: 'PLAN.md' },
  ];

  for (const target of phaseTargets) {
    const candidates = [target.pattern, ...(target.fallback ? [target.fallback] : [])] as string[];
    for (const candidate of candidates) {
      const fullPath = path.join(phaseRoot, candidate);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        parts.push(`### phases/${phaseDir}/${candidate}\n${content}`);
        break;
      } catch {
        // try next candidate
      }
    }
  }

  return parts;
}

/**
 * gsd-tools.cjs init <command> <phaseNum> を同期実行し、JSON 文字列を返す。
 * 失敗した場合は null を返す（ブロックしない）。
 * init をサポートしないコマンド・失敗時はフォールバックとして find-phase を試みる。
 */
async function preExecuteGsdToolsInit(
  gsdToolsBin: string,
  commandName: string,
  phaseNum: number | null
): Promise<string | null> {
  const initCommands = new Set([
    'plan-phase', 'execute-phase', 'verify-work', 'new-milestone', 'new-project',
    'quick', 'resume', 'resume-work', 'map-codebase', 'progress', 'manager',
  ]);

  const phaseArg = phaseNum !== null ? [String(phaseNum)] : [];

  // まず init <commandName> <phase> を試みる
  if (initCommands.has(commandName)) {
    try {
      const result = execFileSync('node', [gsdToolsBin, 'init', commandName, ...phaseArg], {
        cwd: process.cwd(),
        timeout: 8000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return result.trim() || null;
    } catch {
      // fall through to find-phase
    }
  }

  // フェーズ番号があれば find-phase でフェーズ情報だけでも取得する
  if (phaseNum !== null) {
    try {
      const result = execFileSync('node', [gsdToolsBin, 'find-phase', String(phaseNum)], {
        cwd: process.cwd(),
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return result.trim() || null;
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * ファイルを書き出す可能性があるコマンドかどうか判定する。
 */
function isFileWritingCommand(commandName: string): boolean {
  const fileWriters = new Set([
    'discuss-phase', 'plan-phase', 'execute-phase', 'research-phase',
    'verify-work', 'new-milestone', 'new-project', 'complete-milestone',
    'fast', 'do', 'quick', 'audit-milestone', 'audit-uat',
  ]);
  return fileWriters.has(commandName);
}

/**
 * 引数文字列からフェーズ番号を抽出する。
 * 先頭の数値トークンをフェーズ番号として扱う。
 */
function extractPhaseNumberFromArgs(args: string): number | null {
  const m = args.match(/\b(\d+(?:\.\d+)?)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
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