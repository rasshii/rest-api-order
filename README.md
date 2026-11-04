# rest-api-order

[REST API 設計・実装ガイド](https://notes.rewheel.dev/docs/rest-api/) のサンプルリポジトリです。EC サイトの注文 API を、要件・ドメインモデル・OpenAPI の仕様・モックの順に作り、ガイドの第 2 部から TypeScript で実装します。

このリポジトリには、章ごとに tag を付けています。tag `rest-NN` は、第 NN 章まで読んだ時点のリポジトリです。

## 構成

| パス | 中身 |
| --- | --- |
| `docs/requirements/` | 要件 (ストーリーと受け入れ条件・ユースケース・機能でない要件・1 周目に入れないもの) |
| `docs/model/` | モデルの記録 (イベントストーミングのボードと、ホットスポットで決めたこと。ドメインモデルの集約・不変条件・クラス図) |
| `docs/api-design/` | API の設計の記録 (エンドポイントの一覧と、ユースケースから操作までの対応表、JSON の表現の決まり、誤りの応答の決まり、それらの規約の守り方を並べたガイドライン) |
| `docs/glossary.yaml` | 用語集 (文書で使う語・コードの名前・使わない語) |
| `openapi/` | 注文 API の仕様 (OpenAPI 3.1)。`docs/api-design/` の決まりを写したもの。入口の `openapi.yaml` から、パスごとの `paths/` と部品の `components/` を指す。ほかの道具には `npm run bundle` で `dist/openapi.yaml` に束ねて渡す |
| `redocly.yaml` | 仕様の lint (Redocly CLI) の規則 |
| `examples/domain/` | ドメインモデルの例 (消費税額の計算例) |
| `examples/orders/` | 注文の表現の例 (注文するのリクエストと、注文の表現) |
| `examples/problems/` | 誤りの応答の本文の例 (問題の型の表の行ごとに 1 つ) |
| `tools/echo-server/` | 受け取ったリクエストを、そのまま JSON で返すサーバー (第 2 章) |
| `tools/product-server/` | 商品を ID と名前だけで持つ、手書きのサーバー。リソースの URL と RPC 風の口 (`/rpc`) を持つ (第 3 章・第 7 章) |
| `tools/swagger-ui/` | 注文 API の仕様を Swagger UI で読むための配信のサーバー (第 11 章) |
| `test/acceptance.test.ts` | 受け入れ条件のテスト。中身は、注文の API を実装するときに書く |
| `test/requirements.test.ts` | 受け入れ条件の文書と、受け入れ条件のテストの名前がそろっていることを確かめるテスト |
| `test/glossary.test.ts` | `docs/` の文書と仕様に、用語集の使わない語が無く、lint の規則が用語集の使わない語をどれも探すことを確かめるテスト |
| `test/tax-calculation.test.ts` | 消費税額の計算例が、ドメインモデルの求め方と合っていることを確かめるテスト |
| `test/operations.test.ts` | ユースケースから操作までの対応表が、要件・モデル・エンドポイントの文書と食い違わないことを確かめるテスト |
| `test/representation.test.ts` | 注文の表現の例が、表現の決まりのキーの表と値の形と注文明細の決まりに合い、ドメインモデルの計算例と同じ金額を持つことを確かめるテスト |
| `test/problems.test.ts` | 誤りの応答の問題の型の表と例が 1 対 1 で、例が表と拡張メンバーの決まりに合い、ユースケースの別の流れがどれも失敗の一覧にあることを確かめるテスト |
| `test/openapi.test.ts` | 仕様の操作・キー・名前付きの例が、対応表・表現の決まり・例のファイルと食い違わず、名前付きの例が仕様のスキーマに合うことを確かめるテスト |
| `test/lint.test.ts` | lint の規則が、規則の名前のディレクトリに置いた落ちる例 (`test/fixtures/lint/`) でその規則だけを報告し、土台の仕様には何も報告しないことを確かめるテスト |
| `test/guidelines.test.ts` | ガイドラインの守り方の列が、lint の落ちる例と、実在するテストを指すことを確かめるテスト |
| `test/snippets/` | 記事に載せた curl とコマンドと、その結果の期待値 |
| `test/snippets.test.ts` | `test/snippets/` の curl とコマンドを実行し、出力を期待値と比べるテスト |
| `test/support/` | 上のテストが使う処理 (記事の例の実行と比較、仕様の読み込みとスキーマでの検証) |
| `test/harness.test.ts` | 実行と比較の処理のテスト (`test/fixtures/` の試しのファイルを使う) |

## 動かすのに要るもの

- Node.js 26 (`.nvmrc` に書いてあります)
- curl
- bash と find (テストが使います)。macOS と Linux のシェルで動かします。Windows では WSL の中で動かしてください

## 動かし方

```bash
npm ci

# 型の検査とテストと仕様の lint
npm run verify

# 仕様の lint だけを回す
npm run lint

# 分けた仕様を dist/openapi.yaml に束ねる
npm run bundle

# 仕様を Swagger UI で読む (http://localhost:3903)。起動の前に束ねる
npm run docs:swagger

# 仕様の文書 (Redoc) を dist/docs/index.html に作る
npm run docs:build
```

`openapi/` の仕様を直したら、`npm run bundle` を回してから Swagger UI を読み込み直してください。`dist/` はリポジトリに置かない、束ねた出力の置き場です。

テストは、記事と同じポートでサーバーを起動します。同じポートで別のサーバーが動いていると、テストは失敗にして止まります。

## ライセンス

[MIT](LICENSE)
