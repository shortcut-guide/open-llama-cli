// src/controller/multilineInput/index.ts
import chalk from 'chalk';

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

        // ESC で始まり、Shift+Enter またはアロー入力になり得る場合は次のデータを待つ
        if (buf.startsWith('\x1b') && buf.length < 8) {
          const allSeqs = [...SHIFT_ENTER_SEQS, UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW];
          if (allSeqs.some(s => s.startsWith(buf))) return;
          // 不明なエスケープシーケンス → ESC をスキップ
          buf = buf.slice(1);
          continue;
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
    const lines: string[] = [];
    rl.on('line', (line) => {
      if (line.trim() === '/end') {
        rl.removeAllListeners('line');
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
