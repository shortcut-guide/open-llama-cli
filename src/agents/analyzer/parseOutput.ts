// src/agents/analyzer/parseOutput.ts

/**
 * LLMの余計な文字を削除してJSON抽出
 */
export function extractJSON(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON found");
  }
  const jsonString = text.slice(start, end + 1);
  return JSON.parse(jsonString);
}
