// src/controller/command/gsd/parseGsdInput.ts

export interface ParsedGsdInput {
  name: string;                         // コマンド名 (例: "new-milestone")
  args: string;                         // コマンド名以降の引数文字列
  flags: Record<string, string | true>; // --flag または --key=value
}

/**
 * "/gsd:<name> [args] [--flags]" をパースする。
 *
 * 例:
 *   "/gsd:new-milestone v2.0 API統合 --auto"
 *   → { name: "new-milestone", args: "v2.0 API統合 --auto", flags: { auto: true } }
 */
export function parseGsdInput(input: string): ParsedGsdInput {
  // prefix "/gsd:" を除去
  const body = input.replace(/^\/gsd:/, '').trim();

  // 最初のトークンがコマンド名
  const spaceIdx = body.indexOf(' ');
  const name  = spaceIdx === -1 ? body : body.slice(0, spaceIdx);
  const rest  = spaceIdx === -1 ? '' : body.slice(spaceIdx + 1).trim();

  // フラグ抽出: "--force", "--wave=2", "--skip-research" など
  const flags: Record<string, string | true> = {};
  const flagRe = /--([a-z][\w-]*)(?:=(\S+))?/g;
  let m: RegExpExecArray | null;
  while ((m = flagRe.exec(rest)) !== null) {
    flags[m[1]] = m[2] ?? true;
  }

  return { name, args: rest, flags };
}
