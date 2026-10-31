# rest-api-order

[REST API 設計・実装ガイド](https://notes.rewheel.dev/docs/rest-api/) のサンプルリポジトリです。EC サイトの注文 API を、要件・ドメインモデル・OpenAPI の仕様・モックの順に作り、ガイドの第 2 部から TypeScript で実装します。

このリポジトリには、章ごとに tag を付けています。tag `rest-NN` は、第 NN 章まで読んだ時点のリポジトリです。

## 構成

| パス | 中身 |
| --- | --- |
| `tools/echo-server/` | 受け取ったリクエストを、そのまま JSON で返すサーバー (第 2 章) |
| `test/snippets/` | 記事に載せた curl とコマンドと、その結果の期待値 |
| `test/snippets.test.ts` | `test/snippets/` の curl とコマンドを実行し、出力を期待値と比べるテスト |
| `test/support/` | 上のテストが使う、実行と比較の処理 |
| `test/harness.test.ts` | 実行と比較の処理のテスト (`test/fixtures/` の試しのファイルを使う) |

## 動かすのに要るもの

- Node.js 26 (`.nvmrc` に書いてあります)
- curl
- bash と find (テストが使います)。macOS と Linux のシェルで動かします。Windows では WSL の中で動かしてください

## 動かし方

```bash
npm ci

# 型の検査とテスト
npm run verify
```

テストは、記事と同じポートでサーバーを起動します。同じポートで別のサーバーが動いていると、テストは失敗にして止まります。

## ライセンス

[MIT](LICENSE)
