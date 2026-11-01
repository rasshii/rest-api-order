# rest-api-order

[REST API 設計・実装ガイド](https://notes.rewheel.dev/docs/rest-api/) のサンプルリポジトリです。EC サイトの注文 API を、要件・ドメインモデル・OpenAPI の仕様・モックの順に作り、ガイドの第 2 部から TypeScript で実装します。

このリポジトリには、章ごとに tag を付けています。tag `rest-NN` は、第 NN 章まで読んだ時点のリポジトリです。

## 構成

| パス | 中身 |
| --- | --- |
| `docs/requirements/` | 要件 (ストーリーと受け入れ条件・ユースケース・機能でない要件・1 周目に入れないもの) |
| `docs/model/` | モデルの記録 (イベントストーミングのボードと、ホットスポットで決めたこと。ドメインモデルの集約・不変条件・クラス図) |
| `docs/api-design/` | API の設計の記録 (エンドポイントの一覧と、ユースケースから操作までの対応表) |
| `docs/glossary.yaml` | 用語集 (文書で使う語・コードの名前・使わない語) |
| `examples/domain/` | ドメインモデルの例 (消費税額の計算例) |
| `tools/echo-server/` | 受け取ったリクエストを、そのまま JSON で返すサーバー (第 2 章) |
| `tools/product-server/` | 商品を ID と名前だけで持つ、手書きのサーバー。リソースの URL と RPC 風の口 (`/rpc`) を持つ (第 3 章・第 7 章) |
| `test/acceptance.test.ts` | 受け入れ条件のテスト。中身は、注文の API を実装するときに書く |
| `test/requirements.test.ts` | 受け入れ条件の文書と、受け入れ条件のテストの名前がそろっていることを確かめるテスト |
| `test/glossary.test.ts` | `docs/` の文書に、用語集の使わない語が無いことを確かめるテスト |
| `test/tax-calculation.test.ts` | 消費税額の計算例が、ドメインモデルの求め方と合っていることを確かめるテスト |
| `test/operations.test.ts` | ユースケースから操作までの対応表が、要件・モデル・エンドポイントの文書と食い違わないことを確かめるテスト |
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
