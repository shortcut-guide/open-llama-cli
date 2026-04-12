import { describe, it, expect } from 'vitest';
import { extractJSON } from '../src/agents/analyzer/parseOutput.js';

describe('extractJSON', () => {
  it('プレーンなJSONオブジェクトを抽出する', () => {
    const text = '{"key": "value", "num": 42}';
    expect(extractJSON(text)).toEqual({ key: 'value', num: 42 });
  });

  it('前後に余計なテキストがあるJSONを抽出する', () => {
    const text = 'ここから始まります {"key": "value"} ここで終わります';
    expect(extractJSON(text)).toEqual({ key: 'value' });
  });

  it('```json フェンスで囲まれたJSONを抽出する', () => {
    const text = '```json\n{"key": "value"}\n```';
    expect(extractJSON(text)).toEqual({ key: 'value' });
  });

  it('フェンス修飾子なしの ``` で囲まれたJSONを抽出する', () => {
    const text = '```\n{"key": "value"}\n```';
    expect(extractJSON(text)).toEqual({ key: 'value' });
  });

  it('ネストしたオブジェクトを正しくパースする', () => {
    const text = '{"a": {"b": [1, 2, 3]}}';
    expect(extractJSON(text)).toEqual({ a: { b: [1, 2, 3] } });
  });

  it('JSONが見つからない場合はエラーをスローする', () => {
    expect(() => extractJSON('JSONなし')).toThrow();
  });

  it('不正なJSONはエラーをスローする', () => {
    expect(() => extractJSON('{broken json')).toThrow();
  });

  it('空文字列はエラーをスローする', () => {
    expect(() => extractJSON('')).toThrow();
  });

  it('フェンスとプレーンJSONが共存する場合はフェンスを優先する', () => {
    const text = '{"bare": true}\n```json\n{"fenced": true}\n```';
    expect(extractJSON(text)).toEqual({ fenced: true });
  });
});
