#!/usr/bin/env node
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { glob } from 'glob';
// ============================================================================
// 0. 環境変数ロード
// ============================================================================
async function loadEnvFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        content.split('\n').forEach((line) => {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('#'))
                return;
            const [key, ...values] = trimmedLine.split('=');
            if (key && values) {
                const value = values.join('=').trim().replace(/^["']|["']$/g, '');
                process.env[key.trim()] = value;
            }
        });
        console.log(chalk.gray(`  Loaded config from: ${filePath}`));
    }
    catch { }
}
async function initializeConfig() {
    await loadEnvFile(path.join(os.homedir(), '.lcli.env'));
    await loadEnvFile(path.join(process.cwd(), '.env'));
}
// ============================================================================
// 1. 設定
// ============================================================================
const getConfig = () => ({
    LLM_API_URL: process.env.LLM_API_URL || 'http://127.0.0.1:11434/v1/chat/completions',
    TEMPERATURE: parseFloat(process.env.TEMPERATURE || '0.7'),
    MAX_TOKENS: parseInt(process.env.MAX_TOKENS || '4096', 10),
    WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || process.cwd(),
    AUTO_WRITE_DEFAULT: process.env.AUTO_WRITE === 'true' || process.env.AUTO_WRITE === '1',
    SYSTEM_PROMPT: process.env.SYSTEM_PROMPT || 'あなたは優秀なAIアシスタントです。',
});
const HISTORY_FILE = path.join(process.cwd(), 'chat_history.json');
let WORKSPACE_ROOT = process.cwd();
let AUTO_WRITE = false;
const originalLineCountCache = new Map();
// ============================================================================
// Model: 履歴管理
// ============================================================================
async function loadHistory(systemPrompt) {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return [{ role: 'system', content: systemPrompt }];
    }
}
async function saveHistory(history) {
    try {
        await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    }
    catch {
        console.error(chalk.red('\n⚠️ 履歴の保存に失敗しました。'));
    }
}
// ============================================================================
// Model: ファイル操作
// ============================================================================
function resolveSafe(filePath) {
    const abs = path.isAbsolute(filePath)
        ? filePath
        : path.join(WORKSPACE_ROOT, filePath);
    const rel = path.relative(WORKSPACE_ROOT, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`ワークスペース外へのアクセスは禁止されています: ${abs}`);
    }
    return abs;
}
async function searchFiles(pattern, contentRegex) {
    const files = await glob(pattern, {
        cwd: WORKSPACE_ROOT,
        nodir: true,
        dot: false,
        ignore: ['node_modules/**', '.git/**', '*.json'],
    });
    if (!contentRegex)
        return files.map((f) => ({ filePath: f }));
    const re = new RegExp(contentRegex, 'gm');
    const results = [];
    for (const f of files) {
        try {
            const content = await fs.readFile(path.join(WORKSPACE_ROOT, f), 'utf-8');
            const matchedLines = [];
            content.split('\n').forEach((line, i) => {
                re.lastIndex = 0;
                if (re.test(line))
                    matchedLines.push(`  L${i + 1}: ${line.trim()}`);
            });
            if (matchedLines.length > 0)
                results.push({ filePath: f, matchedLines });
        }
        catch { }
    }
    return results;
}
async function readFileContent(filePath) {
    return fs.readFile(resolveSafe(filePath), 'utf-8');
}
async function writeFile(filePath, content) {
    const abs = resolveSafe(filePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf-8');
}
async function replaceLines(filePath, searchText, replaceText) {
    const content = await readFileContent(filePath);
    const lines = content.split('\n');
    const count = lines.filter((l) => l.includes(searchText)).length;
    const updated = lines.map((l) => l.includes(searchText) ? l.replace(searchText, replaceText) : l);
    await writeFile(filePath, updated.join('\n'));
    return count;
}
async function deleteFile(filePath) {
    await fs.rm(resolveSafe(filePath), { recursive: false });
}
// ============================================================================
// Model: LLM API
// ============================================================================
// async function callLLM(history: Message[]): Promise<string> {
//   const config = getConfig();
//   const response = await fetch(config.LLM_API_URL, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       messages: history,
//       temperature: config.TEMPERATURE,
//       max_tokens: config.MAX_TOKENS,
//       stream: false,
//     }),
//   });
//   if (!response.ok) {
//     throw new Error(`LLM API Error: ${response.status} ${await response.text()}`);
//   }
//   const data = (await response.json()) as {
//     choices: { message: { content: string } }[];
//   };
//   return data.choices[0]?.message?.content ?? '';
// }
// ============================================================================
// Model: LLM API (Streaming版)
// ============================================================================
async function callLLM(history) {
    const config = getConfig();
    const response = await fetch(config.LLM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: history,
            temperature: config.TEMPERATURE,
            max_tokens: config.MAX_TOKENS,
            stream: true, // ストリーミングを有効化
        }),
    });
    if (!response.ok) {
        throw new Error(`LLM API Error: ${response.status} ${await response.text()}`);
    }
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error('ReadableStream not supported.');
    const decoder = new TextDecoder();
    let fullContent = '';
    process.stdout.write(chalk.green('\nAI: '));
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        const chunk = decoder.decode(value, { stream: true });
        // OpenAI互換API（Llama.cpp / Ollama）のSSE形式をパース
        const lines = chunk.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]')
                    continue;
                try {
                    const json = JSON.parse(dataStr);
                    const content = json.choices[0]?.delta?.content || '';
                    if (content) {
                        fullContent += content;
                        process.stdout.write(content); // リアルタイムでターミナルに出力
                    }
                }
                catch (e) {
                    // パース失敗は無視（不完全なJSONチャンク対策）
                }
            }
        }
    }
    console.log('\n'); // 最後に改行
    return fullContent;
}
// ============================================================================
// Controller: ファイルブロック処理
// ============================================================================
function extractFileBlocks(message) {
    const FILE_BLOCK_RE = /```file:([^\n]+)\n([\s\S]*?)```/g;
    const results = [];
    let match;
    while ((match = FILE_BLOCK_RE.exec(message)) !== null) {
        results.push({ filePath: match[1].trim(), content: match[2] });
    }
    return results;
}
/**
 * 書き込み前サニティチェック。
 * - 空コンテンツをブロック
 * - 元ファイル行数の50%未満は警告 → 強制確認
 */
const SANITY_RATIO = 0.5;
async function sanityCheckWrite(filePath, proposedContent, rl) {
    const proposedLines = proposedContent.trim().split('\n').length;
    if (proposedContent.trim().length === 0) {
        console.log(chalk.red(`  ⛔ [安全ガード] 提案内容が空です。書き込みをブロック: ${filePath}`));
        return false;
    }
    let originalLines = originalLineCountCache.get(filePath);
    if (originalLines === undefined) {
        try {
            const existing = await readFileContent(filePath);
            originalLines = existing.split('\n').length;
        }
        catch {
            return true;
        }
    }
    if (proposedLines < originalLines * SANITY_RATIO) {
        console.log(chalk.red(`\n  ⛔ [安全ガード] 行数が大幅に減少しています。` +
            `\n     元: ${originalLines}行 → 提案: ${proposedLines}行` +
            ` (${Math.round((proposedLines / originalLines) * 100)}%)`));
        console.log(chalk.yellow(`\n  提案内容の先頭20行:\n`));
        proposedContent.split('\n').slice(0, 20).forEach((l, i) => console.log(chalk.gray(`  ${String(i + 1).padStart(3)}: ${l}`)));
        const force = await rl.question(chalk.red(`\n  強制的に書き込みますか？ [yes で続行 / それ以外でキャンセル]: `));
        if (force.trim().toLowerCase() !== 'yes') {
            console.log(chalk.gray('  ✋ 書き込みをキャンセルしました。'));
            return false;
        }
    }
    return true;
}
/**
 * AIの返答からファイルブロックを取得し、空ブロックがあれば自動リトライする。
 *
 * リトライ戦略:
 *   空ブロック検知 → ファイルをチャンク分割して順番に出力させる
 *   チャンクを結合して最終ファイルを構築する
 */
const RETRY_CHUNK_LINES = 20; // 1回のリトライで要求する行数
const MAX_RETRY = 5; // 最大リトライ回数
async function fetchFileContentInChunks(filePath, originalContent, history) {
    const totalLines = originalContent.split('\n').length;
    let assembled = '';
    let startLine = 1;
    let retryCount = 0;
    console.log(chalk.yellow(`\n  🔄 チャンク分割モードで再取得します (${totalLines}行 / ${RETRY_CHUNK_LINES}行ずつ)\n`));
    while (startLine <= totalLines && retryCount < MAX_RETRY) {
        const endLine = Math.min(startLine + RETRY_CHUNK_LINES - 1, totalLines);
        const isLast = endLine >= totalLines;
        const chunkPrompt = `前回のリファクタリング済みコードを ${startLine}行目から${endLine}行目まで出力してください。` +
            `コードブロック（\`\`\`tsx や \`\`\`typescript）で囲んで出力してください。` +
            (isLast ? '（これが最終チャンクです）' : '');
        console.log(chalk.gray(`  📦 チャンク取得: L${startLine}-L${endLine}...`));
        const chunkHistory = [
            ...history,
            { role: 'user', content: chunkPrompt },
        ];
        try {
            const chunkResponse = await callLLM(chunkHistory);
            // コードブロック内容を抽出
            const codeMatch = chunkResponse.match(/```(?:tsx|typescript|ts)?\n?([\s\S]*?)```/);
            if (codeMatch && codeMatch[1].trim().length > 0) {
                assembled += (assembled ? '\n' : '') + codeMatch[1].trimEnd();
                startLine = endLine + 1;
                retryCount = 0;
            }
            else {
                retryCount++;
                console.log(chalk.yellow(`  ⚠️  チャンク取得失敗 (${retryCount}/${MAX_RETRY})、リトライ...`));
            }
        }
        catch {
            retryCount++;
        }
    }
    return assembled;
}
async function handleFileEditProposals(assistantMessage, history, rl) {
    const proposals = extractFileBlocks(assistantMessage);
    if (proposals.length === 0)
        return;
    console.log(chalk.yellow(`\n📝 ${proposals.length}件のファイルブロックを検知:\n`));
    // 空ブロックを検知してチャンクリトライで補完する
    const resolvedProposals = [];
    for (const p of proposals) {
        const lines = p.content.trim().split('\n').length;
        const isEmpty = p.content.trim().length === 0;
        const isTooShort = (originalLineCountCache.get(p.filePath) ?? 0) > 0 &&
            lines < (originalLineCountCache.get(p.filePath) ?? 0) * SANITY_RATIO;
        if (isEmpty || isTooShort) {
            console.log(chalk.yellow(`  ⚠️  [${p.filePath}] 内容が不十分 (${isEmpty ? '空' : lines + '行'})。チャンクリトライを開始します...`));
            // 元ファイルを読み込んでチャンク要求のベースにする
            let originalContent = '';
            try {
                originalContent = await readFileContent(p.filePath);
            }
            catch { }
            const recovered = await fetchFileContentInChunks(p.filePath, originalContent, history);
            if (recovered.trim().length > 0) {
                console.log(chalk.green(`  ✅ チャンク結合完了: ${recovered.split('\n').length}行`));
                resolvedProposals.push({ filePath: p.filePath, content: recovered });
            }
            else {
                console.log(chalk.red(`  ❌ チャンク取得に失敗しました。スキップ: ${p.filePath}`));
            }
        }
        else {
            console.log(chalk.cyan(`  [${p.filePath}]`) + chalk.gray(` (${lines}行)`));
            resolvedProposals.push(p);
        }
    }
    if (resolvedProposals.length === 0)
        return;
    if (AUTO_WRITE) {
        for (const p of resolvedProposals) {
            const ok = await sanityCheckWrite(p.filePath, p.content, rl);
            if (!ok)
                continue;
            try {
                await writeFile(p.filePath, p.content);
                console.log(chalk.green(`  ✅ 自動保存: ${p.filePath}`));
            }
            catch (e) {
                console.error(chalk.red(`  ❌ 保存失敗 [${p.filePath}]: ${e.message}`));
            }
        }
        return;
    }
    const answer = await rl.question(chalk.yellow('\n適用しますか？ [y=全件 / N=スキップ / 番号=選択]: '));
    const trimmedAns = answer.trim().toLowerCase();
    if (trimmedAns === 'y' || trimmedAns === 'yes') {
        for (const p of resolvedProposals) {
            const ok = await sanityCheckWrite(p.filePath, p.content, rl);
            if (!ok)
                continue;
            try {
                await writeFile(p.filePath, p.content);
                console.log(chalk.green(`  ✅ 保存: ${p.filePath}`));
            }
            catch (e) {
                console.error(chalk.red(`  ❌ 保存失敗: ${e.message}`));
            }
        }
    }
    else if (/^\d+$/.test(trimmedAns)) {
        const idx = parseInt(trimmedAns, 10) - 1;
        if (idx >= 0 && idx < resolvedProposals.length) {
            const p = resolvedProposals[idx];
            const ok = await sanityCheckWrite(p.filePath, p.content, rl);
            if (ok) {
                try {
                    await writeFile(p.filePath, p.content);
                    console.log(chalk.green(`  ✅ 保存: ${p.filePath}`));
                }
                catch (e) {
                    console.error(chalk.red(`  ❌ 保存失敗: ${e.message}`));
                }
            }
        }
        else {
            console.log(chalk.red('  ❌ 無効な番号です。'));
        }
    }
    else {
        console.log(chalk.gray('  スキップしました。'));
    }
}
// ============================================================================
// Controller: コマンドディスパッチ
// ============================================================================
let pendingFileContext = null;
async function handleCommand(userInput, rl) {
    const trimmed = userInput.trim();
    if (trimmed.startsWith('/autowrite')) {
        const arg = trimmed.slice(10).trim().toLowerCase();
        if (arg === 'on')
            AUTO_WRITE = true;
        else if (arg === 'off')
            AUTO_WRITE = false;
        else
            AUTO_WRITE = !AUTO_WRITE;
        console.log(AUTO_WRITE
            ? chalk.green('  🟢 自動書き込み: ON')
            : chalk.gray('  ⚪ 自動書き込み: OFF（確認あり）'));
        return true;
    }
    if (trimmed.startsWith('/search ')) {
        const args = trimmed.slice(8).trim();
        const contentMatch = args.match(/--content\s+(.+)$/);
        const contentRegex = contentMatch ? contentMatch[1].trim() : undefined;
        const pattern = contentRegex ? args.replace(/--content\s+.+$/, '').trim() : args;
        console.log(chalk.blue(`\n🔍 検索中: ${pattern}${contentRegex ? ` (内容: ${contentRegex})` : ''}\n`));
        const results = await searchFiles(pattern, contentRegex);
        if (results.length === 0) {
            console.log(chalk.gray('  一致するファイルが見つかりませんでした。'));
        }
        else {
            results.forEach((r) => {
                console.log(chalk.cyan(`  📄 ${r.filePath}`));
                r.matchedLines?.forEach((l) => console.log(chalk.gray(l)));
            });
            console.log(chalk.gray(`\n  ${results.length}件`));
        }
        return true;
    }
    if (trimmed.startsWith('/read ')) {
        const filePath = trimmed.slice(6).trim();
        try {
            const content = await readFileContent(filePath);
            const lines = content.split('\n');
            originalLineCountCache.set(filePath, lines.length);
            console.log(chalk.blue(`\n📖 ${filePath} (${lines.length}行)\n`));
            lines.forEach((line, i) => console.log(chalk.gray(`${String(i + 1).padStart(4)}: `) + line));
            // ファイル全文をpendingに保持（historyへの偽ターン挿入はしない）
            pendingFileContext =
                `対象ファイル: \`${filePath}\` (${lines.length}行)\n\n` +
                    "```\n" + content + "\n```\n\n" +
                    `上記ファイルに対して次の指示を実行してください。` +
                    `必ず \`\`\`file:${filePath}\`\`\` 形式でファイル全体を省略なく出力してください。`;
            console.log(chalk.gray(`\n  ℹ️  コンテキストを保持しました (${lines.length}行)。続けてタスクを入力してください。\n`));
        }
        catch (e) {
            console.error(chalk.red(`  ❌ 読み込み失敗: ${e.message}`));
        }
        return true;
    }
    if (trimmed.startsWith('/write ')) {
        const filePath = trimmed.slice(7).trim();
        console.log(chalk.yellow(`\n✏️  ${filePath} の内容を入力（"EOF" で終了）:\n`));
        const lines = [];
        while (true) {
            const line = await rl.question('');
            if (line === 'EOF')
                break;
            lines.push(line);
        }
        await writeFile(filePath, lines.join('\n'));
        console.log(chalk.green(`  ✅ 保存しました: ${filePath}`));
        return true;
    }
    if (trimmed.startsWith('/replace ')) {
        const rest = trimmed.slice(9).trim();
        const sepIdx = rest.indexOf(' ');
        if (sepIdx === -1) {
            console.error(chalk.red('  使用法: /replace <filePath> <search> => <replace>'));
            return true;
        }
        const filePath = rest.slice(0, sepIdx).trim();
        const expr = rest.slice(sepIdx + 1).trim();
        const arrowIdx = expr.indexOf('=>');
        if (arrowIdx === -1) {
            console.error(chalk.red('  使用法: /replace <filePath> <search> => <replace>'));
            return true;
        }
        const searchText = expr.slice(0, arrowIdx).trim();
        const replaceText = expr.slice(arrowIdx + 2).trim();
        try {
            const count = await replaceLines(filePath, searchText, replaceText);
            console.log(chalk.green(`  ✅ ${count}箇所を置換しました: ${filePath}`));
        }
        catch (e) {
            console.error(chalk.red(`  ❌ 置換失敗: ${e.message}`));
        }
        return true;
    }
    if (trimmed.startsWith('/delete ')) {
        const filePath = trimmed.slice(8).trim();
        const confirm = await rl.question(chalk.red(`\n⚠️  ${filePath} を削除しますか？ [y/N]: `));
        if (confirm.trim().toLowerCase() === 'y') {
            try {
                await deleteFile(filePath);
                console.log(chalk.green(`  ✅ 削除しました: ${filePath}`));
            }
            catch (e) {
                console.error(chalk.red(`  ❌ 削除失敗: ${e.message}`));
            }
        }
        else {
            console.log(chalk.gray('  キャンセルしました。'));
        }
        return true;
    }
    if (trimmed === '/clear') {
        try {
            await fs.unlink(HISTORY_FILE);
            console.log(chalk.green('  ✅ 履歴をクリアしました。'));
        }
        catch {
            console.log(chalk.gray('  履歴ファイルが存在しません。'));
        }
        return true;
    }
    if (trimmed === '/help') {
        const autoStatus = AUTO_WRITE ? chalk.green('ON') : chalk.gray('OFF');
        console.log(chalk.cyan(`
┌──────────────────────────────────────────────────────────────────┐
│  コマンド一覧                                                      │
├────────────────────────────────┬─────────────────────────────────┤
│  /autowrite [on|off]           │ 自動書き込みトグル               │
│  /search <glob>                │ globでファイル検索               │
│  /search <glob> --content <re> │ ファイル内容を正規表現検索       │
│  /read <path>                  │ ファイル表示 + 次発言へ注入      │
│  /write <path>                 │ 対話入力でファイル書き込み       │
│  /replace <path> <s> => <r>    │ 文字列置換                       │
│  /delete <path>                │ ファイル削除（確認あり）          │
│  /clear                      │ チャット履歴をクリア             │
│  /exit                         │ 終了                             │
└────────────────────────────────┴─────────────────────────────────┘
  自動書き込み現在: `) + autoStatus + '\n');
        return true;
    }
    if (trimmed === '/exit' || trimmed === '/quit') {
        console.log(chalk.cyan('\n👋 終了します。\n'));
        process.exit(0);
    }
    return false;
}
// ============================================================================
// View
// ============================================================================
function printAutoWriteStatus() {
    console.log(AUTO_WRITE
        ? chalk.green('  🟢 自動書き込み: ON')
        : chalk.gray('  ⚪ 自動書き込み: OFF（確認あり）'));
}
// ============================================================================
// Controller: メインループ
// ============================================================================
async function main() {
    await initializeConfig();
    const config = getConfig();
    WORKSPACE_ROOT = config.WORKSPACE_ROOT;
    AUTO_WRITE = config.AUTO_WRITE_DEFAULT;
    const fullSystemPrompt = `${config.SYSTEM_PROMPT}
【重要指令】
ファイルを新規作成または上書き更新する場合は、必ず以下の専用マークダウン形式で出力してください：

\`\`\`file:保存先のファイルパス
ここにファイルの中身全体を記述
\`\`\`

【絶対禁止事項】
- \`// ...\` \`// existing code\` \`// ... (existing props)\` などの省略表現を禁止します
- ファイルブロック内は必ずファイル全体を省略なく完全に記述してください
- 差分・パッチ形式での出力は禁止です。常に完全なファイル内容を出力してください

注意: 複数のファイルを変更する場合は、このブロックを複数回出力してください。
`;
    const rl = readline.createInterface({ input, output });
    console.log(chalk.bold.cyan('\n🤖 AI Chat CLI\n'));
    console.log(chalk.gray(`  ワークスペース: ${config.WORKSPACE_ROOT}`));
    printAutoWriteStatus();
    console.log(chalk.gray('  "/help" でコマンド一覧 | "/autowrite" で自動書き込み切替\n'));
    const history = await loadHistory(fullSystemPrompt);
    while (true) {
        const userInput = await rl.question(chalk.blue('You: '));
        if (!userInput.trim())
            continue;
        const handled = await handleCommand(userInput, rl);
        if (handled)
            continue;
        let messageContent = userInput;
        if (pendingFileContext) {
            messageContent = `${pendingFileContext}\n\n指示: ${userInput}`;
            pendingFileContext = null;
        }
        history.push({ role: 'user', content: messageContent });
        try {
            const assistantMessage = await callLLM(history);
            history.push({ role: 'assistant', content: assistantMessage });
            await saveHistory(history);
            await handleFileEditProposals(assistantMessage, history, rl);
        }
        catch (e) {
            console.error(chalk.red(`\n❌ LLMエラー: ${e.message}\n`));
        }
    }
}
main().catch((e) => {
    console.error(chalk.red('Fatal:'), e);
    process.exit(1);
});
