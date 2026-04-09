// src/controller/extractFileBlocks.ts

export interface FileBlock {
  filePath: string;
  content: string;
}

const FILE_BLOCK_RE = /```file:([^\n]+)\n([\s\S]*?)```/g;

export function extractFileBlocks(message: string): FileBlock[] {
  const results: FileBlock[] = [];
  let match: RegExpExecArray | null;

  // RegExpをリセット（グローバルフラグのため毎回インスタンスを生成）
  const re = new RegExp(FILE_BLOCK_RE.source, 'g');
  while ((match = re.exec(message)) !== null) {
    results.push({ filePath: match[1].trim(), content: match[2] });
  }
  return results;
}
