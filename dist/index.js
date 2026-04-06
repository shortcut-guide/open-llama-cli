#!/usr/bin/env node
import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
// ============================================================================
// 1. 設定と定数
// ============================================================================
const LLM_API_URL = process.env.LLM_API_URL || 'http://127.0.0.1:11434/v1/chat/completions';
const TEMPERATURE = parseFloat(process.env.TEMPERATURE || '0.7');
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '4096', 10);
const HISTORY_FILE = path.join(process.cwd(), 'chat_history.json');
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();
// AUTO_WRITE=true で確認なし即時書き込み（.env または /autowrite コマンドで切替可）
let AUTO_WRITE = process.env.AUTO_WRITE === 'true' || process.env.AUTO_WRITE === '1';
const BASE_SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'あなたは優秀なAIアシスタントです。';
const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

【重要指令】
ファイルを新規作成または上書き更新する場合は、必ず以下の専用マークダウン形式で出力してください：

\`\`\`file:保存先のファイルパス
ここにファイルの中身全体を記述
\`\`\`

注意: 複数のファイルを変更する場合は、このブロックを複数回出力してください。
`;
// ============================================================================
// 2. Model: 履歴管理
// ============================================================================
async function loadHistory() {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return [{ role: 'system', content: SYSTEM_PROMPT }];
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
// 3. Model: ファイル操作
// ============================================================================
/**
 * ワークスペース内パスを解決（外部パスへのアクセスを防止）
 */
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
/**
 * ファイル検索 — glob パターン + オプションで内容の正規表現マッチ
 */
async function searchFiles(pattern, contentRegex) {
    const files = await glob(pattern, {
        cwd: WORKSPACE_ROOT,
        nodir: true,
        dot: false,
        ignore: ['node_modules/**', '.git/**', '*.json'],
    });
    if (!contentRegex) {
        return files.map((f) => ({ filePath: f }));
    }
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
        catch {
            /* バイナリや読めないファイルはスキップ */
        }
    }
    return results;
}
/**
 * ファイル内容を読み込む
 */
async function readFile(filePath) {
    return fs.readFile(resolveSafe(filePath), 'utf-8');
}
/**
 * ファイルを上書き保存（ディレクトリも自動生成）
 */
async function writeFile(filePath, content) {
    const abs = resolveSafe(filePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf-8');
}
/**
 * ファイルの文字列を置換して保存
 */
async function replaceLines(filePath, searchText, replaceText) {
    const content = await readFile(filePath);
    const lines = content.split('\n');
    const count = lines.filter((l) => l.includes(searchText)).length;
    const updated = lines.map((l) => l.includes(searchText) ? l.replace(searchText, replaceText) : l);
    await writeFile(filePath, updated.join('\n'));
    return count;
}
/**
 * ファイル削除（ワークスペース外は禁止）
 */
async function deleteFile(filePath) {
    await fs.rm(resolveSafe(filePath), { recursive: false });
}
// ============================================================================
// 4. Model: LLM API
// ============================================================================
async function callLLM(history) {
    const response = await fetch(LLM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: history,
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
            stream: false,
        }),
    });
    if (!response.ok) {
        throw new Error(`LLM API Error: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json());
    return data.choices[0]?.message?.content ?? '';
}
// ============================================================================
// 5. Controller: チャット返答からのファイル自動反映
// ============================================================================
/**
 * ```file:path ブロックを抽出
 */
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
 * AUTO_WRITE=true  → 確認なしで全件即時書き込み
 * AUTO_WRITE=false → y/N/番号 で選択
 */
async function handleFileEditProposals(assistantMessage, rl) {
    const proposals = extractFileBlocks(assistantMessage);
    if (proposals.length === 0)
        return;
    console.log(chalk.yellow(`\n📝 ${proposals.length}件のファイルブロックを検知:\n`));
    proposals.forEach((p, i) => console.log(chalk.cyan(`  [${i + 1}] ${p.filePath}`)));
    // ── 自動書き込みモード ──────────────────────────────────────────────────
    if (AUTO_WRITE) {
        for (const p of proposals) {
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
    // ── 手動確認モード ──────────────────────────────────────────────────────
    const answer = await rl.question(chalk.yellow('\n適用しますか？ [y=全件 / N=スキップ / 番号=選択]: '));
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === 'y' || trimmed === 'yes') {
        for (const p of proposals) {
            try {
                await writeFile(p.filePath, p.content);
                console.log(chalk.green(`  ✅ 保存: ${p.filePath}`));
            }
            catch (e) {
                console.error(chalk.red(`  ❌ 保存失敗: ${e.message}`));
            }
        }
    }
    else if (/^\d+$/.test(trimmed)) {
        const idx = parseInt(trimmed, 10) - 1;
        if (idx >= 0 && idx < proposals.length) {
            try {
                await writeFile(proposals[idx].filePath, proposals[idx].content);
                console.log(chalk.green(`  ✅ 保存: ${proposals[idx].filePath}`));
            }
            catch (e) {
                console.error(chalk.red(`  ❌ 保存失敗: ${e.message}`));
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
// 6. Controller: コマンドディスパッチ
// ============================================================================
async function handleCommand(userInput, rl) {
    const trimmed = userInput.trim();
    // ─── /autowrite [on|off] ────────────────────────────────────────────────
    if (trimmed.startsWith('/autowrite')) {
        const arg = trimmed.slice(10).trim().toLowerCase();
        if (arg === 'on') {
            AUTO_WRITE = true;
        }
        else if (arg === 'off') {
            AUTO_WRITE = false;
        }
        else {
            AUTO_WRITE = !AUTO_WRITE;
        }
        console.log(AUTO_WRITE
            ? chalk.green('  🟢 自動書き込み: ON（AIの返答を即時ファイルへ反映）')
            : chalk.gray('  ⚪ 自動書き込み: OFF（確認プロンプトあり）'));
        return true;
    }
    // ─── /search <glob> [--content <regex>] ─────────────────────────────────
    if (trimmed.startsWith('/search ')) {
        const args = trimmed.slice(8).trim();
        const contentMatch = args.match(/--content\s+(.+)$/);
        const contentRegex = contentMatch ? contentMatch[1].trim() : undefined;
        const pattern = contentRegex
            ? args.replace(/--content\s+.+$/, '').trim()
            : args;
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
    // ─── /read <filePath> ────────────────────────────────────────────────────
    if (trimmed.startsWith('/read ')) {
        const filePath = trimmed.slice(6).trim();
        try {
            const content = await readFile(filePath);
            const lines = content.split('\n');
            console.log(chalk.blue(`\n📖 ${filePath} (${lines.length}行)\n`));
            lines.forEach((line, i) => console.log(chalk.gray(`${String(i + 1).padStart(4)}: `) + line));
        }
        catch (e) {
            console.error(chalk.red(`  ❌ 読み込み失敗: ${e.message}`));
        }
        return true;
    }
    // ─── /write <filePath> ───────────────────────────────────────────────────
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
    // ─── /replace <filePath> <search> => <replace> ───────────────────────────
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
    // ─── /delete <filePath> ──────────────────────────────────────────────────
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
    // ─── /history ────────────────────────────────────────────────────────────
    if (trimmed === '/history') {
        try {
            await fs.unlink(HISTORY_FILE);
            console.log(chalk.green('  ✅ 履歴をクリアしました。'));
        }
        catch {
            console.log(chalk.gray('  履歴ファイルが存在しません。'));
        }
        return true;
    }
    // ─── /help ───────────────────────────────────────────────────────────────
    if (trimmed === '/help') {
        const autoStatus = AUTO_WRITE ? chalk.green('ON') : chalk.gray('OFF');
        console.log(chalk.cyan(`
┌──────────────────────────────────────────────────────────────────┐
│  コマンド一覧                                                      │
├────────────────────────────────┬─────────────────────────────────┤
│  /autowrite [on|off]           │ 自動書き込みトグル               │
│  /search <glob>                │ globでファイル検索               │
│  /search <glob> --content <re> │ ファイル内容を正規表現検索       │
│  /read <path>                  │ ファイル内容を行番号付きで表示   │
│  /write <path>                 │ 対話入力でファイル書き込み       │
│  /replace <path> <s> => <r>    │ 文字列置換                       │
│  /delete <path>                │ ファイル削除（確認あり）          │
│  /history                      │ チャット履歴をクリア             │
│  /exit                         │ 終了                             │
└────────────────────────────────┴─────────────────────────────────┘
  自動書き込み現在: `) + autoStatus + '\n');
        return true;
    }
    // ─── /exit ───────────────────────────────────────────────────────────────
    if (trimmed === '/exit' || trimmed === '/quit') {
        console.log(chalk.cyan('\n👋 終了します。\n'));
        process.exit(0);
    }
    return false;
}
// ============================================================================
// 7. View
// ============================================================================
function printAutoWriteStatus() {
    console.log(AUTO_WRITE
        ? chalk.green('  🟢 自動書き込み: ON')
        : chalk.gray('  ⚪ 自動書き込み: OFF（確認あり）'));
}
// ============================================================================
// 8. Controller: メインループ
// ============================================================================
async function main() {
    const rl = readline.createInterface({ input, output });
    console.log(chalk.bold.cyan('\n🤖 AI Chat CLI\n'));
    console.log(chalk.gray(`  ワークスペース: ${WORKSPACE_ROOT}`));
    printAutoWriteStatus();
    console.log(chalk.gray('  "/help" でコマンド一覧 | "/autowrite" で自動書き込み切替\n'));
    const history = await loadHistory();
    while (true) {
        const userInput = await rl.question(chalk.blue('You: '));
        if (!userInput.trim())
            continue;
        const handled = await handleCommand(userInput, rl);
        if (handled)
            continue;
        history.push({ role: 'user', content: userInput });
        try {
            const assistantMessage = await callLLM(history);
            console.log(chalk.green('\nAI: ') + assistantMessage + '\n');
            history.push({ role: 'assistant', content: assistantMessage });
            await saveHistory(history);
            // ファイルブロックを自動 or 確認付きで反映
            await handleFileEditProposals(assistantMessage, rl);
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
