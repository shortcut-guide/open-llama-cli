// src/controller/multilineInput/index.ts
import chalk from 'chalk';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const UP_ARROW   = '\x1b[A';
const DOWN_ARROW = '\x1b[B';
const LEFT_ARROW = '\x1b[D';
const RIGHT_ARROW = '\x1b[C';

/** Shift+Enter として認識するエスケープシーケンス（端末別） */
const SHIFT_ENTER_SEQS = [
  '\x1b\r',       // ESC + CR  (iTerm2 / meta+enter)
  '\x1b\n',       // ESC + LF
  '\x1b[13;2u',  // CSI 13;2u (Kitty keyboard protocol)
];

const PASTE_START = '\x1b[200~';
const PASTE_END   = '\x1b[201~';

/**
 * TTY raw モードで1行または複数行の入力を受け取る。
 * - Enter のみ → 送信
 * - Shift+Enter (ESC+CR, ESC+LF, CSI 13;2u) → 改行挿入
 * - ブラケットペースト → 複数行ペーストを正しく処理
 * - 非 TTY 環境 (CI/pipe) → readline でフォールバック
 */
export async function readUserInput(prompt: string, inputHistory: string[] = []): Promise<string> {
  if (!process.stdin.isTTY) {
    return readLineFallback(prompt);
  }

  return new Promise<string>((resolve) => {
    const lines: string[] = [''];
    let buf = '';
    let inPaste = false;

    // ── 履歴ナビゲーション状態 ──────────────────────────────────────
    let historyIdx = inputHistory.length; // 末尾+1を指すことで「未選択」
    let savedInput = '';                  // 履歴を遡る前の入力内容

    /** 現在行の表示を newText で置き換える（シングルライン時のみ） */
    const replaceCurrentLine = (newText: string) => {
      const current = lines[lines.length - 1];
      process.stdout.write('\b \b'.repeat(current.length));
      lines[lines.length - 1] = newText;
      process.stdout.write(newText);
    };

    process.stdout.write('\x1b[?2004h'); // bracketed paste on
    process.stdout.write(prompt);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const cleanup = () => {
      process.stdout.write('\x1b[?2004l'); // bracketed paste off
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
    };

    const appendNewline = () => {
      lines.push('');
      process.stdout.write('\n' + chalk.gray('  > '));
    };

    const onData = (chunk: string) => {
      buf += chunk;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (buf.length === 0) break;

        // ── ブラケットペースト開始 ────────────────────────────────────
        if (buf.startsWith(PASTE_START)) {
          inPaste = true;
          buf = buf.slice(PASTE_START.length);
          continue;
        }

        if (inPaste) {
          const endIdx = buf.indexOf(PASTE_END);
          const raw = endIdx === -1 ? buf : buf.slice(0, endIdx);
          const content = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const parts = content.split('\n');

          lines[lines.length - 1] += parts[0];
          process.stdout.write(parts[0]);
          for (let i = 1; i < parts.length; i++) {
            appendNewline();
            lines[lines.length - 1] = parts[i];
            process.stdout.write(parts[i]);
          }

          if (endIdx === -1) {
            buf = '';
            return; // 続きを待つ
          }
          buf = buf.slice(endIdx + PASTE_END.length);
          inPaste = false;
          continue;
        }

        // ── Shift+Enter シーケンス ────────────────────────────────────
        let shiftEnterHit = false;
        for (const seq of SHIFT_ENTER_SEQS) {
          if (buf.startsWith(seq)) {
            appendNewline();
            buf = buf.slice(seq.length);
            shiftEnterHit = true;
            break;
          }
        }
        if (shiftEnterHit) continue;

        // ── ↑↓ 矢印キー（履歴ナビゲーション）────────────────────────
        if (buf.startsWith(UP_ARROW) || buf.startsWith(DOWN_ARROW)) {
          if (lines.length === 1) {
            if (buf.startsWith(UP_ARROW)) {
              buf = buf.slice(UP_ARROW.length);
              if (historyIdx > 0) {
                if (historyIdx === inputHistory.length) {
                  savedInput = lines[0]; // 現在の入力を保存
                }
                historyIdx--;
                replaceCurrentLine(inputHistory[historyIdx]);
              }
            } else {
              buf = buf.slice(DOWN_ARROW.length);
              if (historyIdx < inputHistory.length) {
                historyIdx++;
                const next = historyIdx === inputHistory.length ? savedInput : inputHistory[historyIdx];
                replaceCurrentLine(next);
              }
            }
          } else {
            // マルチライン時は矢印キーをスキップ
            buf = buf.startsWith(UP_ARROW)
              ? buf.slice(UP_ARROW.length)
              : buf.slice(DOWN_ARROW.length);
          }
          continue;
        }

        // ── ←→ 矢印キー（無視）────────────────────────────────────────
        if (buf.startsWith(LEFT_ARROW) || buf.startsWith(RIGHT_ARROW)) {
          buf = buf.startsWith(LEFT_ARROW)
            ? buf.slice(LEFT_ARROW.length)
            : buf.slice(RIGHT_ARROW.length);
          continue;
        }

        // ESC シーケンス処理
        if (buf.startsWith('\x1b')) {
          const allSeqs = [...SHIFT_ENTER_SEQS, UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW];
          // 既知シーケンスのプレフィックスであれば次のデータを待つ
          if (buf.length < 8 && allSeqs.some(s => s.startsWith(buf))) return;

          // Delete キー (\x1b[3~) → 末尾 1 文字削除
          if (buf.startsWith('\x1b[3~')) {
            buf = buf.slice(4);
            const line = lines[lines.length - 1];
            if (line.length > 0) {
              lines[lines.length - 1] = line.slice(0, -1);
              process.stdout.write('\b \b');
            }
            continue;
          }

          // CSI シーケンス (\x1b[...) を丸ごとスキップ
          if (buf.length >= 2 && buf[1] === '[') {
            let i = 2;
            // パラメータバイト (0x20–0x3F) を読み飛ばす
            while (i < buf.length && buf.charCodeAt(i) >= 0x20 && buf.charCodeAt(i) <= 0x3F) i++;
            if (i >= buf.length) return; // シーケンス未完 → 待機
            buf = buf.slice(i + 1); // 終端バイトを含めてスキップ
            continue;
          }

          // SS3 シーケンス (\x1bO + 1 文字) をスキップ
          if (buf.length >= 2 && buf[1] === 'O') {
            if (buf.length < 3) return; // 待機
            buf = buf.slice(3);
            continue;
          }

          // ESC + 1 文字の 2 バイトシーケンスをスキップ
          if (buf.length >= 2) {
            buf = buf.slice(2);
            continue;
          }

          // ESC のみ受信 → 待機
          return;
        }

        const ch = buf[0];
        buf = buf.slice(1);

        // Enter → 送信
        if (ch === '\r' || ch === '\n') {
          process.stdout.write('\n');
          cleanup();
          resolve(lines.join('\n'));
          return;
        }

        // Ctrl+C
        if (ch === '\x03') {
          process.stdout.write('^C\n');
          cleanup();
          resolve('');
          return;
        }

        // Ctrl+D (EOF)
        if (ch === '\x04') {
          process.stdout.write('\n');
          cleanup();
          process.exit(0);
        }

        // Backspace
        if (ch === '\x7f' || ch === '\b') {
          const line = lines[lines.length - 1];
          if (line.length > 0) {
            lines[lines.length - 1] = line.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }

        // Ctrl+U – 現在行をクリア
        if (ch === '\x15') {
          const line = lines[lines.length - 1];
          process.stdout.write('\b \b'.repeat(line.length));
          lines[lines.length - 1] = '';
          continue;
        }

        // Ctrl+G – 外部エディタでプロンプトを編集
        if (ch === '\x07') {
          const tmpFile = path.join(os.tmpdir(), `lcli-prompt-${Date.now()}.txt`);
          const currentContent = lines.join('\n');
          try {
            fs.writeFileSync(tmpFile, currentContent, 'utf8');

            // ターミナルを通常モードに戻してエディタを起動
            process.stdout.write('\x1b[?2004l');
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', onData);

            const editorEnv = process.env.EDITOR || 'nano';
            const editorParts = editorEnv.split(/\s+/);
            const editorCmd = editorParts[0];
            const editorExtraArgs = editorParts.slice(1);
            // VS Code は --wait がないと即終了するため自動付与
            if ((editorCmd === 'code' || editorCmd.endsWith('/code')) && !editorExtraArgs.includes('--wait')) {
              editorExtraArgs.unshift('--wait');
            }

            spawnSync(editorCmd, [...editorExtraArgs, tmpFile], { stdio: 'inherit' });

            // 編集結果を読み込み（末尾の改行は除去）
            const newContent = fs.readFileSync(tmpFile, 'utf8').replace(/\n$/, '');
            fs.unlinkSync(tmpFile);

            // lines を新しい内容で置き換え
            const newLines = newContent.split('\n');
            lines.splice(0, lines.length, ...(newLines.length > 0 ? newLines : ['']));
          } catch {
            // エディタ起動失敗時は現在の入力を維持
          }

          // ターミナルを raw モードに戻し、プロンプトと内容を再描画
          process.stdout.write('\x1b[?2004h');
          process.stdin.setRawMode(true);
          process.stdin.on('data', onData);

          process.stdout.write(prompt + lines[0]);
          for (let i = 1; i < lines.length; i++) {
            process.stdout.write('\n' + chalk.gray('  > ') + lines[i]);
          }
          continue;
        }

        // その他の制御文字・不明エスケープをスキップ
        if (ch === '\x1b' || (ch < ' ' && ch !== '\t')) continue;

        // 通常文字
        lines[lines.length - 1] += ch;
        process.stdout.write(ch);
      }
    };

    process.stdin.on('data', onData);
  });
}

/** @deprecated agentCommand 向け後方互換。/end で送信する旧式のマルチライン入力 */
export async function readMultiline(rl: import('node:readline/promises').Interface): Promise<string> {
  return new Promise((resolve) => {
    console.log(chalk.gray("\n📝 複数行入力モード（/end で送信）\n"));
    // readUserInput の cleanup が stdin を pause するため、readline が
    // 'line' イベントを受け取れるよう resume する
    process.stdin.resume();
    const lines: string[] = [];
    rl.on('line', (line) => {
      if (line.trim() === '/end') {
        rl.removeAllListeners('line');
        process.stdin.pause();
        resolve(lines.join('\n'));
      } else {
        lines.push(line);
      }
    });
  });
}

/** 非 TTY 環境向けフォールバック */
async function readLineFallback(prompt: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
}
