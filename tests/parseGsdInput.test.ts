import { describe, it, expect } from 'vitest';
import { parseGsdInput } from '../src/controller/command/gsd/parseGsdInput.js';

describe('parseGsdInput', () => {
  it('コマンド名のみをパースする', () => {
    const result = parseGsdInput('/gsd:status');
    expect(result.name).toBe('status');
    expect(result.args).toBe('');
    expect(result.flags).toEqual({});
  });

  it('コマンド名と引数をパースする', () => {
    const result = parseGsdInput('/gsd:new-milestone v2.0 API統合');
    expect(result.name).toBe('new-milestone');
    expect(result.args).toBe('v2.0 API統合');
  });

  it('--flag 形式のフラグをパースする', () => {
    const result = parseGsdInput('/gsd:start --auto');
    expect(result.flags['auto']).toBe(true);
  });

  it('--key=value 形式のフラグをパースする', () => {
    const result = parseGsdInput('/gsd:wave --wave=3');
    expect(result.flags['wave']).toBe('3');
  });

  it('複数のフラグをパースする', () => {
    const result = parseGsdInput('/gsd:deploy --force --env=prod');
    expect(result.flags['force']).toBe(true);
    expect(result.flags['env']).toBe('prod');
  });

  it('引数とフラグが混在する場合をパースする', () => {
    const result = parseGsdInput('/gsd:new-milestone v2.0 API統合 --auto');
    expect(result.name).toBe('new-milestone');
    expect(result.args).toBe('v2.0 API統合 --auto');
    expect(result.flags['auto']).toBe(true);
  });

  it('ハイフン付きフラグ名をパースする', () => {
    const result = parseGsdInput('/gsd:run --skip-research');
    expect(result.flags['skip-research']).toBe(true);
  });

  it('/gsd: プレフィックスなしでも動作する', () => {
    const result = parseGsdInput('status');
    expect(result.name).toBe('status');
    expect(result.args).toBe('');
  });

  it('空文字列はname=""・args=""・flags={}を返す', () => {
    const result = parseGsdInput('');
    expect(result.name).toBe('');
    expect(result.args).toBe('');
    expect(result.flags).toEqual({});
  });
});
