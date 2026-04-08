// src/agents/planner.ts
import { callLLM, type Message } from "../model/llm.js";
import { FileAnalysis } from "./analyzer.js";

export type MicroPlan = {
  file: string;
  responsibility: string;
  extractFocus: string;
};

export type MacroPlan = {
  plans: MicroPlan[];
};

export async function runPlanner(params: {
  target: string;
  code: string;
  analysis: FileAnalysis;
  llmUrl: string;
}): Promise<MacroPlan> {
  const { target, code, analysis } = params;
  const prompt = buildPlannerPrompt(target, code, analysis.path);
  const messages: Message[] = [{ role: "user", content: prompt }];

  const text: string = await callLLM(messages, {
    printStream: true,
    temperature: 0.2, 
    maxTokens: 1500,
    label: "📋 Architect Planner",
  });

  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return JSON.parse(text.substring(start, end + 1));
  } catch (e) {
    throw new Error("Planner failed to parse JSON");
  }
}

function buildPlannerPrompt(target: string, code: string, filePath: string): string {
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
  const fileName = filePath.split('/').pop()?.split('.')[0] || 'Component';

  return `
You are an expert Frontend Architect.
Your task is to design a granular file structure for a React component refactoring.

# ARCHITECTURE RULES (CRITICAL)
1. **Strict Imports**: ALL sub-components and the main wrapper MUST import shared types (e.g., \`import { Product } from './types'\`). Tell the Coder NEVER to duplicate type definitions.
2. **Sub-components**: Must be strictly atomic. Tell the Coder to ignore outer layout wrappers or \`if/else\` branches from the parent, and extract ONLY the raw JSX elements needed.
3. **Main Wrapper**: Must import the sub-components, pass necessary props, and DELETE the old inline UI.

# OUTPUT FORMAT (STRICT JSON)
{
  "plans": [
    {
      "file": "${dirPath}/${fileName}/types.ts",
      "responsibility": "Type definitions",
      "extractFocus": "Extract ONLY types/interfaces. DELETE all React components."
    },
    {
      "file": "${dirPath}/${fileName}/${fileName}Image.tsx",
      "responsibility": "Image display",
      "extractFocus": "Import types from './types'. DO NOT define types here. Extract ONLY the <img> and fallback JSX. Ignore layout if/else branches. DELETE price, name, and reviews."
    },
    {
      "file": "${dirPath}/${fileName}/${fileName}Info.tsx",
      "responsibility": "Text/data display",
      "extractFocus": "Import types from './types'. DO NOT define types here. Extract ONLY name, price, and reviews. DELETE <img> and imageError state."
    },
    {
      "file": "${dirPath}/${fileName}/${fileName}.tsx",
      "responsibility": "Main wrapper component",
      "extractFocus": "Import types and sub-components. Keep the \`layout === 'horizontal'\` logic, but REPLACE the inline image and info with <${fileName}Image /> and <${fileName}Info />."
    }
  ]
}

# USER REQUEST
${target}

# SOURCE CODE
${code}
`.trim();
}