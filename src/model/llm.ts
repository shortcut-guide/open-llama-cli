// src/model/llm.ts
import chalk from 'chalk';
import { getConfig } from '../config.js';

export type Message = { role: string; content: string };

/**
 * LLM API呼び出し（ストリーミング）
 * printStream=false の場合はサイレント実行（Agent内部通信用）
 */
export async function callLLM(
  history: Message[],
  options: { 
    printStream?: boolean;
    label?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  } = {}
): Promise<string> {
  const { printStream = true, label = 'AI' } = options;
  const config = getConfig();
  // システムプロンプトがある場合、履歴の先頭に挿入した新しい配列を作成
  const messages = options.systemPrompt 
    ? [{ role: 'system', content: options.systemPrompt }, ...history]
    : history;

  const response = await fetch(config.LLM_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: history,
      temperature: options.temperature ?? config.TEMPERATURE,
      max_tokens: options.maxTokens ?? config.MAX_TOKENS,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API Error: ${response.status} ${await response.text()}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('ReadableStream not supported.');

  const decoder = new TextDecoder();
  let fullContent = '';

  if (printStream) {
    process.stdout.write(chalk.green(`\n${label}: `));
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const json = JSON.parse(dataStr);
          const content = json.choices[0]?.delta?.content || '';
          if (content) {
            fullContent += content;
            if (printStream) process.stdout.write(content);
          }
        } catch {
          // 不完全なJSONチャンク対策
        }
      }
    }
  }

  if (printStream) console.log('\n');
  return fullContent;
}
