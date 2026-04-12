import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSafe } from '../src/model/file/security.js';
import { setWorkspaceRoot, getWorkspaceRoot } from '../src/model/file/workspace.js';
import * as path from 'node:path';

const WORKSPACE = '/tmp/test-workspace';
let originalRoot: string;

beforeEach(() => {
  originalRoot = getWorkspaceRoot();
  setWorkspaceRoot(WORKSPACE);
});

afterEach(() => {
  setWorkspaceRoot(originalRoot);
});

describe('resolveSafe', () => {
  it('ワークスペース内の相対パスを解決する', () => {
    const result = resolveSafe('src/foo.ts');
    expect(result).toBe(path.join(WORKSPACE, 'src/foo.ts'));
  });

  it('ワークスペース内の絶対パスをそのまま返す', () => {
    const absPath = path.join(WORKSPACE, 'src/bar.ts');
    const result = resolveSafe(absPath);
    expect(result).toBe(absPath);
  });

  it('ルート直下のファイルを解決する', () => {
    const result = resolveSafe('README.md');
    expect(result).toBe(path.join(WORKSPACE, 'README.md'));
  });

  it('パストラバーサル攻撃をブロックする (../)', () => {
    expect(() => resolveSafe('../etc/passwd')).toThrow(
      'ワークスペース外へのアクセスは禁止されています'
    );
  });

  it('深いパストラバーサルをブロックする', () => {
    expect(() => resolveSafe('../../root/.ssh/id_rsa')).toThrow(
      'ワークスペース外へのアクセスは禁止されています'
    );
  });

  it('ワークスペース外の絶対パスをブロックする', () => {
    expect(() => resolveSafe('/etc/passwd')).toThrow(
      'ワークスペース外へのアクセスは禁止されています'
    );
  });

  it('深くネストしたパスを正しく解決する', () => {
    const result = resolveSafe('a/b/c/d.ts');
    expect(result).toBe(path.join(WORKSPACE, 'a/b/c/d.ts'));
  });

  it('. (カレントディレクトリ) はワークスペースルートに解決される', () => {
    const result = resolveSafe('.');
    expect(result).toBe(WORKSPACE);
  });
});
