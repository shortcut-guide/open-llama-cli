// src/model/llm.ts
import chalk from 'chalk';
import { getConfig } from '../../config/index.js';

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
    llmUrl?: string;
  } = {}
): Promise<string> {
  const { printStream = true, label = 'AI' } = options;
  const config = getConfig();
  // システムプロンプトがある場合、履歴の先頭に挿入した新しい配列を作成
  const messages = options.systemPrompt 
    ? [{ role: 'system', content: options.systemPrompt }, ...history]
    : history;

  const url = options.llmUrl || config.LLM_API_URL;
  const isChatEndpoint = url.includes('/chat/completions');

  // /v1/completions は prompt 形式、/v1/chat/completions は messages 形式
  const body = isChatEndpoint
    ? {
        messages,
        temperature: options.temperature ?? config.TEMPERATURE,
        max_tokens: options.maxTokens ?? config.MAX_TOKENS,
        stream: true,
      }
    : {
        prompt: messages.map(m => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'}: ${m.content}`).join('\n') + '\nAssistant:',
        temperature: options.temperature ?? config.TEMPERATURE,
        max_tokens: options.maxTokens ?? config.MAX_TOKENS,
        stream: true,
      };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    const isHtml = contentType.includes('text/html') || body.trimStart().startsWith('<');
    const detail = isHtml
      ? `(HTMLレスポンス — エンドポイントが正常に応答していません)`
      : body.slice(0, 200);
    throw new Error(`LLM API Error: ${response.status} ${detail}\n  URL: ${url}`);
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
          // /chat/completions: delta.content, /completions: text
          const content = json.choices[0]?.delta?.content ?? json.choices[0]?.text ?? '';
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
