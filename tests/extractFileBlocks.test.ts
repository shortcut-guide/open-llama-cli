import { describe, it, expect } from 'vitest';
import { extractFileBlocks } from '../src/controller/fileProposal/extractFileBlocks.js';

describe('extractFileBlocks', () => {
  it('単一のファイルブロックを抽出する', () => {
    const message = '```file:src/foo.ts\nconsole.log("hello");\n```';
    const blocks = extractFileBlocks(message);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].filePath).toBe('src/foo.ts');
    expect(blocks[0].content).toBe('console.log("hello");\n');
  });

  it('複数のファイルブロックを抽出する', () => {
    const message = [
      '```file:src/a.ts\nconst a = 1;\n```',
      '```file:src/b.ts\nconst b = 2;\n```',
    ].join('\n');
    const blocks = extractFileBlocks(message);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].filePath).toBe('src/a.ts');
    expect(blocks[1].filePath).toBe('src/b.ts');
  });

  it('ファイルブロックがない場合は空配列を返す', () => {
    const blocks = extractFileBlocks('普通のテキスト');
    expect(blocks).toEqual([]);
  });

  it('ファイルパスの前後スペースをトリムする', () => {
    const message = '```file:  src/foo.ts  \ncontent\n```';
    const blocks = extractFileBlocks(message);
    expect(blocks[0].filePath).toBe('src/foo.ts');
  });

  it('コンテンツが複数行のブロックを正しく抽出する', () => {
    const content = 'line1\nline2\nline3\n';
    const message = `\`\`\`file:src/multi.ts\n${content}\`\`\``;
    const blocks = extractFileBlocks(message);
    expect(blocks[0].content).toBe(content);
  });

  it('周囲のテキストを無視してブロックだけ抽出する', () => {
    const message = '前のテキスト\n```file:src/x.ts\ncode\n```\n後のテキスト';
    const blocks = extractFileBlocks(message);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].filePath).toBe('src/x.ts');
  });

  it('同じファイル名が複数あっても全て返す', () => {
    const message = [
      '```file:src/foo.ts\nv1\n```',
      '```file:src/foo.ts\nv2\n```',
    ].join('\n');
    const blocks = extractFileBlocks(message);
    expect(blocks).toHaveLength(2);
  });

  it('空コンテンツのブロックを抽出する', () => {
    const message = '```file:src/empty.ts\n```';
    const blocks = extractFileBlocks(message);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('');
  });
});
