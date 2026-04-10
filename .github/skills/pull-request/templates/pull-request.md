# プルリクエストタイトル

## 概要
プルリクエストの説明を7行程度にまとめる。

一文ごとに改行を入れること。

|ファイルパス       |状態      |修正概要              |備考                |
|-------------------|----------|----------------------|--------------------|
|`sample/sample.ts` |`created` |演算ロジックを新規追加|特になし            |
|`sample/sample1.ts`|`updated` |処理をリファクタリング|あとで動作テスト予定|
|`sample/sample2.ts`|`deleted` |不要なため削除        |特になし            |
|`sample/sample3.ts`|`renamed` |ファイル名・ディレクトリパスの変更|特になし|

## 動作確認方法
- ブランチをチェックアウト
- Docker環境を構築し、以下のコマンドを実行

(コマンド例)
docker exec -it sample vendor/bin/phpunit

## 関連issueやプルリクエスト

closes: [#1](https://www.example.com)
closes: [#2](https://www.example.com)

## 懸念事項
- ある場合はここに箇条書きで記載

## 参考ドキュメント
- [参考1](https://www.example.com)

---
Created By AI agents.