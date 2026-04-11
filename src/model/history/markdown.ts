// src/model/history/markdown.ts
import type { Message } from '../llm/index.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderCodeBlocksHtml(text: string): string {
  // Replace ```lang\n...\n``` with <pre><code class="language-lang">...</code></pre>
  return text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = escapeHtml(code);
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    return `<pre><code${cls}>${escaped}</code></pre>`;
  });
}

function renderInlineHtml(text: string): string {
  // Escape first, then restore code blocks
  const escaped = escapeHtml(text);
  // Inline code
  return escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function historyToMarkdown(history: Message[]): string {
  const now = new Date().toISOString();
  const lines: string[] = [`# Chat Session Export`, ``, `_Generated: ${now}_`, ``];

  for (const msg of history) {
    if (msg.role === 'system') {
      lines.push(`> **📌 System**`);
      for (const line of msg.content.split('\n')) {
        lines.push(`> ${line}`);
      }
      lines.push('');
    } else if (msg.role === 'user') {
      lines.push(`## 👤 User`, ``);
      lines.push(msg.content);
      lines.push('');
    } else if (msg.role === 'assistant') {
      lines.push(`## 🤖 Assistant`, ``);
      lines.push(msg.content);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function historyToHtml(history: Message[]): string {
  const now = new Date().toISOString();
  const parts: string[] = [
    `<!DOCTYPE html>`,
    `<html lang="ja">`,
    `<head>`,
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<title>Chat Session Export</title>`,
    `<style>`,
    `  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #222; }`,
    `  .meta { color: #888; font-size: 0.9em; margin-bottom: 2rem; }`,
    `  .system { background: #f5f5f5; border-left: 4px solid #ccc; padding: 0.8rem 1rem; margin: 1rem 0; border-radius: 4px; }`,
    `  .user { background: #e8f4fd; border-left: 4px solid #4a90d9; padding: 0.8rem 1rem; margin: 1rem 0; border-radius: 4px; }`,
    `  .assistant { background: #f0faf0; border-left: 4px solid #5cb85c; padding: 0.8rem 1rem; margin: 1rem 0; border-radius: 4px; }`,
    `  .role { font-weight: bold; margin-bottom: 0.4rem; }`,
    `  pre { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 4px; overflow-x: auto; }`,
    `  code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-family: monospace; }`,
    `  pre code { background: none; padding: 0; }`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<h1>Chat Session Export</h1>`,
    `<p class="meta">Generated: ${escapeHtml(now)}</p>`,
  ];

  for (const msg of history) {
    if (msg.role === 'system') {
      const body = renderCodeBlocksHtml(msg.content);
      parts.push(`<div class="system"><div class="role">📌 System</div><div>${body}</div></div>`);
    } else if (msg.role === 'user') {
      const body = renderInlineHtml(msg.content).replace(/\n/g, '<br>');
      parts.push(`<div class="user"><div class="role">👤 User</div><div>${body}</div></div>`);
    } else if (msg.role === 'assistant') {
      const body = renderCodeBlocksHtml(msg.content).replace(/\n(?!<)/g, '<br>');
      parts.push(`<div class="assistant"><div class="role">🤖 Assistant</div><div>${body}</div></div>`);
    }
  }

  parts.push(`</body>`, `</html>`);
  return parts.join('\n');
}
