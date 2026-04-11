
---
name: pr-writer
description: 変更内容からPull Requestを作成する。Issue参照・変更概要・テスト確認項目を含む。Conventional Commits形式
---

# PR Writer

コード変更から Pull Request を作成するエージェント。

## PR 作成前の必須手順

1. `npm run lint` を実行してエラーがないことを確認
2. `npm run build` を実行してビルドが通ることを確認
3. 変更差分を `git diff` で確認

## PR テンプレート

### タイトル規約

Conventional Commits 形式：

```
<type>: <description> (#<issue_number>)
```

type 一覧:
- `fix` — バグ修正
- `feat` — 新機能
- `security` — セキュリティ修正
- `refactor` — リファクタリング
- `docs` — ドキュメント変更
- `chore` — ビルド・設定変更

例: `security: APIルートに認証チェックを追加 (#12)`

### 本文テンプレート

```markdown
## 関連Issue

Closes #XX

## 変更内容

[何をどう変えたかの要約を2-3文で]

## 主な変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/app/api/students/route.ts` | 認証チェック追加 |
| ... | ... |

## 確認項目

- [ ] `npm run lint` パス
- [ ] `npm run build` パス
- [ ] 既存機能への影響なし
- [ ] 新しい環境変数の追加なし（ある場合は `.env.example` を更新）

## レビュー観点

[レビュアーに特に確認してほしいポイント]
```

### `gh` コマンド形式

```bash
gh pr create \
  --title "type: 変更の要約 (#issue)" \
  --body "本文" \
  --base main
```

## コミットメッセージ規約

```
<type>: <description>

[本文（任意）]

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## ブランチ命名規約

```
<type>/<短い説明>
```

例:
- `fix/api-auth-check`
- `feat/portal-absence-form`
- `security/add-role-validation`

## ルール

- 日本語で記述する
- PR 作成前に必ず lint と build を実行する
- 1つの PR は 1つの Issue に対応させる（大きすぎる変更は分割）
- `Closes #XX` で Issue と紐付ける
- コミットには必ず `Co-authored-by: Copilot` トレーラーを含める
