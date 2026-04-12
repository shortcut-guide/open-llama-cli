import { describe, it, expect } from 'vitest';
import {
  parseReviewerResponse,
  parseReviewResult,
} from '../src/agents/reviewer/parseReview.js';

describe('parseReviewerResponse', () => {
  it('承認済みのレビュー結果をパースする', () => {
    const raw = JSON.stringify({
      approved: true,
      issues: [],
      suggestions: ['コメントを追加'],
      hints: ['型を明示'],
    });
    const result = parseReviewerResponse(raw);
    expect(result.approved).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual(['コメントを追加']);
    expect(result.hints).toEqual(['型を明示']);
  });

  it('否認のレビュー結果をパースする', () => {
    const raw = JSON.stringify({
      approved: false,
      issues: ['バグあり'],
      suggestions: [],
      hints: [],
    });
    const result = parseReviewerResponse(raw);
    expect(result.approved).toBe(false);
    expect(result.issues).toEqual(['バグあり']);
  });

  it('テキスト中に埋め込まれたJSONを抽出する', () => {
    const raw = `レビュー結果:\n${JSON.stringify({ approved: true, issues: [], suggestions: [], hints: [] })}\n終わり`;
    const result = parseReviewerResponse(raw);
    expect(result.approved).toBe(true);
  });

  it('パース失敗時は approved=false でフォールバックする', () => {
    const result = parseReviewerResponse('壊れたJSON {{{');
    expect(result.approved).toBe(false);
    expect(result.issues).toEqual(['パース失敗']);
    expect(result.raw).toBe('壊れたJSON {{{');
  });

  it('オプションフィールドがなくても正規化される', () => {
    const raw = JSON.stringify({ approved: true });
    const result = parseReviewerResponse(raw);
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.hints).toEqual([]);
  });
});

describe('parseReviewResult', () => {
  it('有効なJSONをパースする', () => {
    const output = JSON.stringify({
      approved: true,
      issues: [],
      suggestions: ['改善案'],
      hints: [],
    });
    const result = parseReviewResult(output);
    expect(result.approved).toBe(true);
    expect(result.suggestions).toEqual(['改善案']);
  });

  it('パース失敗時は approved=false で空配列を返す', () => {
    const result = parseReviewResult('not json');
    expect(result.approved).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });

  it('rawフィールドが保持される', () => {
    const output = JSON.stringify({ approved: true, issues: [], suggestions: [], hints: [] });
    const result = parseReviewResult(output);
    expect(result.raw).toBe(output);
  });

  it('approved が文字列 "true" の場合は false として扱われる', () => {
    const output = JSON.stringify({ approved: 'true', issues: [], suggestions: [], hints: [] });
    const result = parseReviewResult(output);
    expect(result.approved).toBe(false);
  });
});
