# 誤りの応答

注文の API が失敗を返すときのステータスコードと、本文の形 (問題の詳細、RFC 9457) の決まり。例は `examples/problems/` に置く。`test/problems.test.ts` が、問題の型の表と例が 1 対 1 で、例が表と拡張メンバーの決まりに合い、ユースケースの別の流れがどれも失敗の一覧にあることを確かめる。

## 失敗の一覧

1 周目の 2 つの操作 (注文する・注文を確かめる) と、操作の外の HTTP の層で起きる失敗。ユースケースの列は、`docs/requirements/use-cases.md` の別の流れを指す。

| 操作 | 失敗 | ユースケース | 問題の型 | ステータスコード |
| --- | --- | --- | --- | --- |
| 注文する | 注文明細が無いか 100 を超える、同じ商品の注文明細が 2 つ以上ある、数量が 1 より小さい、連絡先メールアドレスが無いか形が正しくない | 注文する 2a | `/problems/invalid-request` | 400 |
| 注文する | 本文が JSON として読めない、表現の決まりのキーの表で「入れる」としていないキーがある、値が `null` か型が合わない | なし | `/problems/invalid-request` | 400 |
| 注文する | 登録されていない商品がある | 注文する 3a | `/problems/unknown-product` | 400 |
| 注文する | 在庫が数量より少ない商品がある | 注文する 4a | `/problems/insufficient-inventory` | 400 |
| 注文する | 本文のメディアタイプが `application/json` でない | なし | `about:blank` | 415 |
| 注文を確かめる | その注文 ID の注文が無い | 注文を確かめる 2a | `/problems/order-not-found` | 404 |
| 両方 | `Accept` が `application/json` を受け入れない | なし | `about:blank` | 406 |
| 両方 | サーバーの予期しない誤り | なし | `/problems/internal-error` | 500 |
| 操作の外 | エンドポイントの一覧に無いパス | なし | `about:blank` | 404 |
| 操作の外 | パスは一覧にあるが、そのパスで受け付けないメソッド | なし | `about:blank` | 405 |

- 4xx は、リクエストの中身か、リクエストを送った時点の状態が原因で、クライアントが直すか待つかすれば通りうる失敗に使う。5xx は、サーバーの側が原因の失敗に使う
- 400 は、リクエストの中身の誤り (登録されていない商品を含む) と、注文を受け付けるのに要る在庫が足りない失敗に使う。どちらの失敗かは `type` で伝える
- 1 周目の 2 つの操作では 409 を使わない。対象のリソースの今の状態と衝突する失敗が無いため
- 1 つのリクエストに複数の失敗があるときは、パス・メソッド・`Accept`・`Content-Type`・本文の形 (ユースケースの手順 2)・商品 (手順 3)・在庫 (手順 4) の順に確かめ、最初に当たった失敗だけを返す。本文の形の誤りは、見つけたものをすべて `errors` に並べる
- 登録されていない商品と在庫が足りない商品は、当たった商品をすべて `productIds` に並べる
- パスの注文 ID は、サーバーが返した注文 ID と、文字列のまま比べる。大文字を含む注文 ID や、UUID の形でない注文 ID は、その注文 ID の注文が無いものとして扱う

## 問題の型

| 型 | ステータスコード | 題 | 使う場面 | 拡張メンバー | 例 |
| --- | --- | --- | --- | --- | --- |
| `/problems/invalid-request` | 400 | `Invalid request` | 本文が JSON として読めないか、形や値が表現の決まりとユースケースの手順 2 に合わない | `errors` | `invalid-request.json` |
| `/problems/unknown-product` | 400 | `Unknown product` | 登録されていない商品がある | `productIds` | `unknown-product.json` |
| `/problems/insufficient-inventory` | 400 | `Insufficient inventory` | 在庫が数量より少ない商品がある | `productIds` | `insufficient-inventory.json` |
| `/problems/order-not-found` | 404 | `Order not found` | その注文 ID の注文が無い | なし | `order-not-found.json` |
| `/problems/internal-error` | 500 | `Unexpected error` | サーバーの予期しない誤り | `trackingId` | `internal-error.json` |
| `about:blank` | 404 | `Not Found` | エンドポイントの一覧に無いパス | なし | `not-found.json` |
| `about:blank` | 405 | `Method Not Allowed` | パスは一覧にあるが、そのパスで受け付けないメソッド | なし | `method-not-allowed.json` |
| `about:blank` | 406 | `Not Acceptable` | `Accept` が `application/json` を受け入れない | なし | `not-acceptable.json` |
| `about:blank` | 415 | `Unsupported Media Type` | 本文のメディアタイプが `application/json` でない | なし | `unsupported-media-type.json` |

- 誤りの応答の本文は、`Content-Type: application/problem+json` で返す。リクエストの `Accept` に `application/problem+json` が無くても、この形で返す。クライアントには、`Accept: application/json, application/problem+json` を送ることを勧める
- 本文には、`type`・`title`・`status` をいつも入れる。`type` が `about:blank` でも省かない。`status` は応答のステータスコードと同じ値にする
- `detail` は、題より詳しく言えることがあるときだけ入れる。クライアントは `detail` を読み取って処理を分けない。分けるときは `type` と拡張メンバーを使う
- `instance` は、1 周目は使わない
- 題と `detail` は英語で書く。`type` が `about:blank` の題は、RFC 9110 のステータスコードの名前と同じにする
- 自前の型は、`/problems/` に小文字の英語の kebab-case をつないだ相対 URI にする。型の識別子は、応答を返したオリジン (スキーム・ホスト・ポート) で解決した URI になる。1 周目のサーバーは、この URI に文書を置かない。問題の型の文書は、この表と、1 周目の API の仕様 (OpenAPI) に置く
- 汎用の失敗 (エンドポイントの一覧に無いパス・メソッド・`Accept`・`Content-Type`) には `about:blank` を使う。注文が無いことは、ユースケースの別の流れなので、自前の型にする
- 405 の応答には、そのパスで受け付けるメソッドを並べた `Allow` ヘッダを付ける。415 の応答には、`Accept: application/json` を付ける

## 拡張メンバー

| メンバー | 語 | 型 | 中身 |
| --- | --- | --- | --- |
| `errors` | なし | 配列 (1 つ以上) | 本文の誤りの 1 つずつ。要素は `pointer` と `detail` を持つ |
| `productIds` | 商品 ID | 配列 (1 つ以上) | 当たった商品の商品 ID。同じ商品 ID を 2 度入れない |
| `trackingId` | 追跡 ID | 文字列 | その 500 の応答の追跡 ID。同じ値をサーバーのログにも残す |

- ドメインの値を運ぶメンバーの名前は、表現の決まり (`representation.md`) のキーの節の箇条に従う
- ドメインの語でないメンバー (`errors` と、その要素の `pointer`・`detail`) は、RFC 9457 の例と同じ名前にする
- `pointer` は、リクエストの本文の中の誤りの位置を、JSON Pointer (RFC 6901) の文字列で表す。先頭に `#` を付けない。本文が JSON として読めないときは、本文全体を指す `""` にする。無いキーは、あるはずの位置を指す (`/contactEmail`)。注文明細が無いか 100 を超えるときは `/lines` を指す。同じ商品の注文明細が 2 つ以上あるときは、2 つ目からの注文明細の `productId` を指す
- 在庫が足りない商品の、在庫の数は返さない
- クライアントは、知らない拡張メンバーを無視する

## 選ばなかった案

| 案 | 選ばなかった理由 |
| --- | --- |
| 入力の誤りを 422 にする | 400 と 422 のどちらでも、クライアントはリクエストを直す。誤りの種類は `type` と `errors` で伝える |
| 在庫不足を 409 にする | 409 は、対象のリソースの今の状態との衝突を示す。在庫は 1 周目の API のリソースでなく、注文するの対象 (注文のコレクション) の状態でもない。状態が明示的に直されるまで送り直すべきでない失敗は、AIP も 400 に対応させている |
| 在庫不足を 422 にする | 本文の指示そのものは処理できる。Zalando の指針は 422 を使わない |
| 登録されていない商品を 404 にする | 注文するの対象のリソース (注文のコレクション) はある |
| 在庫不足の型を `/problems/out-of-stock` にする | 在庫の英語は、用語集の code (`Inventory`) にそろえる |
| 問題の型を絶対 URI にする | 型の URI を置けるホスト名 (API の持ち主が持つもの) がまだ無い。相対 URI は、応答を返したオリジンで解決されるので、同じオリジンの中では識別子が一定になる。オリジンが違えば (モックとサーバーなど)、解決した後の識別子も違う |
| 注文が無いことを `about:blank` の 404 にする | エンドポイントの一覧に無いパスの 404 や、中継の部品が返す 404 と区別できない |
| `pointer` を `#/lines/0/quantity` のように URI のフラグメントの形にする | `application/json` は、フラグメントの書き方を JSON Pointer と定めていない |
| 追跡 ID を `instance` に入れる | 参照できない URI の `instance` は、発生ごとの、クライアントには中身の分からない識別子として使える。ただし URI 参照なので、追跡 ID を URI の形に包む必要がある。追跡 ID は用語集の語なので、code の名前の拡張メンバーにする |
| 在庫不足で、在庫の数も返す | 1 周目は、誰でも注文するを呼べるので、在庫の数を誰にでも見せることになる。数は返した直後に変わりうる |
