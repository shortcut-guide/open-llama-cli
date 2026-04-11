// src/controller/multilineInput.ts
import * as readline from 'node:readline/promises';

export async function readMultiline(rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => {
    console.log("\n📝 複数行入力モード（/endで送信）\n");

    const lines: string[] = [];

    rl.on("line", (line) => {
      if (line.trim() === "/end") {
        rl.removeAllListeners("line");
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    });
  });
}
