// src/agents/analyzer/parseOutput.ts

/**
 * LLMの余計な文字を削除してJSON抽出
 * Handles markdown code fences (```json ... ```) and bare JSON objects.
 */
export function extractJSON(text: string): unknown {
  // Handle markdown code fences first (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in LLM response");
  }
  const jsonString = text.slice(start, end + 1);
  return JSON.parse(jsonString);
}
