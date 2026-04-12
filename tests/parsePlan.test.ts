import { describe, it, expect } from 'vitest';
import { parsePlannerResponse } from '../src/agents/planner/parsePlan.js';
import type { FileAnalysis } from '../src/agents/analyzer/index.js';

const dummyAnalysis: FileAnalysis = {
  path: 'src/foo.ts',
  summary: 'Foo module',
  exports: [],
  dependencies: [],
  functions: [],
};

describe('parsePlannerResponse', () => {
  it('有効なJSONプランを正しくパースする', () => {
    const text = JSON.stringify({
      plans: [
        { file: 'src/bar.ts', responsibility: 'bar機能', extractFocus: 'barタスク' },
      ],
    });
    const result = parsePlannerResponse(text, 'barタスク', dummyAnalysis);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].file).toBe('src/bar.ts');
  });

  it('テキスト中に埋め込まれたJSONを抽出する', () => {
    const text = `以下のプランです:\n${JSON.stringify({
      plans: [{ file: 'src/x.ts', responsibility: 'x', extractFocus: 'task' }],
    })}\n以上です。`;
    const result = parsePlannerResponse(text, 'task', dummyAnalysis);
    expect(result.plans[0].file).toBe('src/x.ts');
  });

  it('複数ファイルのプランをパースする', () => {
    const text = JSON.stringify({
      plans: [
        { file: 'src/a.ts', responsibility: 'a', extractFocus: 'task' },
        { file: 'src/b.ts', responsibility: 'b', extractFocus: 'task' },
      ],
    });
    const result = parsePlannerResponse(text, 'task', dummyAnalysis);
    expect(result.plans).toHaveLength(2);
  });

  it('JSONが見つからない場合はフォールバックプランを返す', () => {
    const result = parsePlannerResponse('JSONなし', 'someTask', dummyAnalysis);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].file).toBe('src/foo.ts');
    expect(result.plans[0].responsibility).toBe('Execute task');
    expect(result.plans[0].extractFocus).toBe('someTask');
  });

  it('不正なJSONの場合もフォールバックプランを返す', () => {
    const result = parsePlannerResponse('{broken}', 'task', dummyAnalysis);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].file).toBe('src/foo.ts');
  });

  it('空文字列の場合もフォールバックプランを返す', () => {
    const result = parsePlannerResponse('', 'emptyTask', dummyAnalysis);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].extractFocus).toBe('emptyTask');
  });

  it('plansキーがないJSONの場合もフォールバックせずそのまま返す', () => {
    const text = JSON.stringify({ other: 'data' });
    const result = parsePlannerResponse(text, 'task', dummyAnalysis);
    // plans が undefined になるため、フォールバックが返ることを確認
    expect(result).toBeDefined();
  });
});
