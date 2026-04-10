
## 📋 まとめ

**open-llama-cli** は、ローカル/カスタムLLM APIと連携する **TypeScript製 CLIチャットツール** + **Multi-Agentオーケストレーター**。MVC構造を採用済み。

---

## アーキテクチャ全体図

```mermaid
flowchart TD
    subgraph Entry["src/index.ts (エントリーポイント)"]
        MAIN[main loop]
    end

    subgraph View["src/view/"]
        DISP[display.ts\nバナー/ステータス表示]
    end

    subgraph Controller["src/controller/"]
        CMD[command.ts\nコマンドルーター]
        STATE[state.ts\nAUTO_WRITE / pendingContext]
        subgraph Commands["command/"]
            AGENT_CMD[agentCommand.ts]
            FILE_CMD[fileCommands.ts]
            SYS_CMD[systemCommands.ts]
        end
        FP[fileProposal.ts\nAI返答→ファイル反映]
    end

    subgraph Model["src/model/"]
        LLM[llm.ts\ncallLLM / Message型]
        HIST[history.ts\nchat_history.json]
        FILE[file.ts\nFS操作 / resolveSafe]
    end

    subgraph Orchestrator["src/orchestrator.ts"]
        ORCH[runOrchestrator\nMacro Pipeline]
    end

    subgraph Agents["src/agents/"]
        ANA[analyzer.ts\nコード静的解析]
        PLAN[planner.ts\nアーキ設計図]
        CODER[coder.ts\nコード生成]
        REV[reviewer.ts\nレビュー/承認]
        FIX[fixer.ts]
        TYPES[types.ts\n共有型定義]
    end

    subgraph Config["src/config.ts"]
        CFG[getConfig\nLLM_API_URL, AUTO_WRITE...]
    end

    MAIN --> CMD
    MAIN --> LLM
    MAIN --> FP
    MAIN --> DISP
    CMD --> AGENT_CMD
    CMD --> FILE_CMD
    CMD --> SYS_CMD
    CMD --> STATE
    AGENT_CMD --> ORCH
    ORCH --> ANA
    ORCH --> PLAN
    ORCH --> CODER
    ORCH --> REV
    ORCH --> FIX
    ANA & PLAN & CODER & REV --> LLM
    FILE_CMD --> FILE
    FP --> FILE
    MAIN --> HIST
    CFG --> LLM
    CFG --> ORCH
```

---

## ファイル構成サマリー

| パス | 役割 | レイヤー |
|---|---|---|
| `src/index.ts` | エントリー・メインループ | - |
| `src/config.ts` | 環境変数読込・Config型 | Config |
| `src/model/llm.ts` | LLM API呼び出し（SSEストリーミング） | Model |
| `src/model/history.ts` | チャット履歴のJSON永続化 | Model |
| `src/model/file.ts` | FS操作・パス検証（resolveSafe） | Model |
| `src/view/display.ts` | CLI表示（chalk） | View |
| `src/controller/state.ts` | アプリ状態（AUTO_WRITE等） | Controller |
| `src/controller/command.ts` | コマンドルーター | Controller |
| `src/controller/command/agentCommand.ts` | `/agent` コマンド処理 | Controller |
| `src/controller/command/fileCommands.ts` | `/search /read /write /replace /delete` | Controller |
| `src/controller/command/systemCommands.ts` | `/help /clear /exit /autowrite` | Controller |
| `src/controller/fileProposal.ts` | AI返答の ` ```file:` ブロック検知・保存 | Controller |
| `src/orchestrator.ts` | Multi-Agentパイプライン制御 | Orchestrator |
| `src/agents/analyzer.ts` | コード静的解析Agent | Agent |
| `src/agents/planner.ts` | アーキテクチャ設計Agent | Agent |
| `src/agents/coder.ts` | コード生成Agent | Agent |
| `src/agents/reviewer.ts` | コードレビューAgent（承認/差し戻し） | Agent |
| `src/agents/fixer.ts` | 修正Agent | Agent |
| `src/agents/types.ts` | 共有型定義（TaskType, AgentContext等） | Shared |

---

## Multi-Agentパイプライン

```mermaid
sequenceDiagram
    participant U as User
    participant O as Orchestrator
    participant AN as Analyzer
    participant PL as Planner
    participant CO as Coder
    participant RE as Reviewer

    U->>O: /agent <task>
    O->>AN: runAnalyzer(code, filePath)
    AN-->>O: FileAnalysis (exports/deps/functions)
    O->>PL: runPlanner(task, code, analysis)
    PL-->>O: MacroPlan [MicroPlan...]

    loop ファイルごと
        O->>CO: runCoderAgent(plan)
        CO-->>O: generated code
        loop MAX_REVIEW_ITERATIONS
            O->>RE: runReviewerAgent(code)
            RE-->>O: ReviewResult {approved, issues, hints}
            alt approved
                O-->>O: ✅ break
            else rejected
                O->>CO: retry with hints
            end
        end
    end
    O-->>U: finalCode + summary
```

---

## 主要技術スタック

| 項目 | 詳細 |
|---|---|
| 言語 | TypeScript 5.x / ESM |
| ランタイム | Node.js |
| LLM通信 | SSEストリーミング（fetch API）|
| LLM エンドポイント | `phis.jp`（カスタム）/ `gemma.phis.jp` |
| CLI描画 | chalk 5.x |
| ファイル検索 | glob 10.x |
| 履歴永続化 | `chat_history.json`（CWD） |
| ビルド | `tsc` → `dist/` |
| MVC準拠度 | ✅ 高（model/view/controller 分離済み） |

---

## 改善・注意点

| 区分 | 内容 |
|---|---|
| ⚠️ セキュリティ | `resolveSafe()` でパストラバーサル対策済み。ただし `chat_history.json` がCWD直置きでリポジトリにコミットされている |
| ⚠️ 状態管理 | `state.ts` のグローバル変数がプロセス内共有。マルチセッション非対応 |
| ⚠️ エラーハンドリング | Reviewer JSONパース失敗時のフォールバックが雑（`approved: false` 固定） |
| 💡 拡張余地 | LLMエンドポイントがハードコード気味。`.env` で完全外部化推奨 |
| 💡 テスト | ユニットテスト皆無。agents/ は純粋関数が多くテスト追加しやすい |