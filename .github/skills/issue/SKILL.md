---
name: issue
description: |
  ユーザーからの指示内容を元に、GitHubリポジトリにissueを作成する。
  ユーザーからの命令にissue、イシューというキーワードが含まれている場合に発火する。
---

# issue

## When to Use (いつ使うべきか)
- issueを新規作成するとき

## Quick Start (処理フロー)

1. ユーザーからissueの`milestone`(e.g. `PHx.0`)を聞く (存在しない場合はなし)
1. ユーザーにissueの内容を聞く
3. issue内容を把握する
4. issue内容を元にissueタイトルを作成
5. issue内容を元に`Label`を推定 (GitHubで用意されているものを使用)
6. テンプレートmarkdownに沿うようにissueの本文をまとめる
7. ghコマンドを用いてissueをGitHubリポジトリに作成

## Guidelines (ガイドライン)
- issue新規作成時の`Assignees`にはユーザーだけを指定すること
- issueタイトルには内容に応じて以下のprefixをつけること
  - `feat`: 新規機能追加
  - `fix`: 既存機能修正 (バグ修正など)
  - `docs`: ドキュメント追加・編集
  - `style`: 空白・フォーマット・セミコロンなどの追加・修正 (静的解析反映)
  - `refactor`: 仕様に影響がないコード改善(リファクタ)
  - `perf`: パフォーマンス向上関連
  - `test`: テストコードの追加・修正・デバッグ関連
  - `chore`: ビルド・補助ツール・ライブラリ追加や更新

## Templates (実装テンプレート)
[issueテンプレート](./templates/issue.md)