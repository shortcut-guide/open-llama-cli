// src/model/gsd/context.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { type GsdCommand, type GsdContext } from './types.js';
import { resolveGsdRoot } from './paths.js';
import { buildPlanningSnapshot } from './planning.js';
import {
  preExecuteGsdToolsInit,
  isFileWritingCommand,
  extractPhaseNumberFromArgs,
} from './preflight.js';

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

    const candidates: string[] = [];

    if (path.isAbsolute(rawPath)) {
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

/**
 * コマンド定義 + 引数 + コンテキストファイルを組み立て、
 * LLM に渡す GsdContext を生成する。
 */
export async function resolveGsdContext(
  cmd: GsdCommand,
  args: string
): Promise<GsdContext> {
  const gsdRoot      = resolveGsdRoot();
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
      'このツールではシェルコマンドを実行できません。ファイルを作成・更新する場合は、\n' +
      '必ず以下の形式でファイル内容を出力してください。この形式以外ではディスクに書き込まれません。\n\n' +
      '【プランニングファイル (.planning/ 以下)】\n' +
      'CONTEXT.md / PLAN.md / SUMMARY.md など .planning/ 配下のファイル:\n' +
      '```file:.planning/phases/{phase_dir}/{filename}\n' +
      '...ファイルの完全な内容...\n' +
      '```\n\n' +
      'PROJECT.md / REQUIREMENTS.md / ROADMAP.md などトップレベルファイルは:\n' +
      '```file:.planning/{filename}\n' +
      '...ファイルの完全な内容...\n' +
      '```\n\n' +
      '【実装ファイル (ソースコード・設定ファイルなど)】\n' +
      'プロジェクトのソースコードや設定ファイルはプロジェクトルートからの相対パスで指定:\n' +
      '```file:src/path/to/file.ts\n' +
      '...ファイルの完全な内容...\n' +
      '```\n\n' +
      'bashスクリプトや mkdir / cat コマンドは使わないでください。\n' +
      '</file_output_instruction>';
  }

  // 9. execute-phase 専用: インライン実行の強制指示
  if (cmd.name === 'execute-phase') {
    resolvedPrompt +=
      '\n\n<execute_phase_inline_instruction>\n' +
      'CRITICAL: open-llama-cli ではサブエージェントの生成やスポーニングはできません。\n' +
      '「Spawning agents...」「Task(...)」などのサブエージェント呼び出しを記述しないでください。\n\n' +
      '## あなたの役割: 実装者（コードを書く人）\n\n' +
      '以下の手順で、このターン内で全タスクを完全に実装してください:\n\n' +
      '1. <current_planning_state> に含まれる対象フェーズの PLAN.md を読む\n' +
      '2. PLAN.md の各タスクを順番に実行し、**実際のソースコードや設定ファイルを生成する**\n' +
      '3. 各実装ファイルを必ず ```file:src/path/to/file.ts``` 形式で出力する\n' +
      '4. 全タスク完了後に SUMMARY.md を ```file:.planning/phases/{phase_dir}/{plan}-SUMMARY.md``` 形式で出力する\n\n' +
      '## 厳守事項（違反すると失敗と見なされます）\n\n' +
      '❌ 絶対にやってはいけないこと:\n' +
      '- 新しい PLAN.md を作成する（PLAN.md は既に存在します。再作成は禁止）\n' +
      '- 実装計画・やること一覧・説明文だけを出力して終わる\n' +
      '- 「実装します」「これらのファイルを作成します」だけ書いて実際のコードを出さない\n' +
      '- bash/shell コマンドブロックを出力する（実行されません）\n\n' +
      '✅ 必ずやること:\n' +
      '- 実際のファイル内容（完全なソースコード）を ```file:パス``` 形式で出力する\n' +
      '- PLAN.md に記載された全タスクをこの1ターンで完了させる\n' +
      '- 少なくとも1つ以上の実装ファイル（.planning/ 以外）を出力する\n\n' +
      'SUMMARY.md の前に必ず実装ファイルを出力すること。実装ファイルが0件のまま終わるのは失敗です。\n' +
      '</execute_phase_inline_instruction>';
  }

  return {
    command: cmd,
    resolvedPrompt,
    contextFiles: files,
    planningRoot,
    gsdRoot,
  };
}
