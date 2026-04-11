// src/controller/chunkFetcher.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../../model/llm/index.js';

const RETRY_CHUNK_LINES = 20;
const MAX_RETRY = 5;

export async function fetchFileContentInChunks(
  filePath: string,
  originalContent: string,
  history: Message[]
): Promise<string> {
  const totalLines = originalContent.split('\n').length;
  let assembled = '';
  let startLine = 1;
  let retryCount = 0;

  console.log(chalk.yellow(`\n  🔄 チャンク分割モードで再取得します (${totalLines}行 / ${RETRY_CHUNK_LINES}行ずつ)\n`));

  while (startLine <= totalLines && retryCount < MAX_RETRY) {
    const endLine = Math.min(startLine + RETRY_CHUNK_LINES - 1, totalLines);
    const isLast = endLine >= totalLines;

    const chunkPrompt =
      `前回のリファクタリング済みコードを ${startLine}行目から${endLine}行目まで出力してください。` +
      `コードブロック（\`\`\`tsx や \`\`\`typescript）で囲んで出力してください。` +
      (isLast ? '（これが最終チャンクです）' : '');

    console.log(chalk.gray(`  📦 チャンク取得: L${startLine}-L${endLine}...`));

    const chunkHistory: Message[] = [
      ...history,
      { role: 'user', content: chunkPrompt },
    ];

    try {
      const chunkResponse = await callLLM(chunkHistory, { printStream: false });
      const codeMatch = chunkResponse.match(/```(?:tsx|typescript|ts)?\n?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1].trim().length > 0) {
        assembled += (assembled ? '\n' : '') + codeMatch[1].trimEnd();
        startLine = endLine + 1;
        retryCount = 0;
      } else {
        retryCount++;
        console.log(chalk.yellow(`  ⚠️  チャンク取得失敗 (${retryCount}/${MAX_RETRY})、リトライ...`));
      }
    } catch {
      retryCount++;
    }
  }

  return assembled;
}
