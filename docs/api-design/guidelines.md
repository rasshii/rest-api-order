# API の設計のガイドライン

注文の API の設計の規約を 1 か所に並べた索引。規約を決めた文書 (エンドポイント・表現・誤りの応答) は置き換えず、決めた文書を指して、規約ごとに守り方を書く。操作や表現を足すときと、見直しのときに、表を上から当てる。理由と選ばなかった案は、決めた文書に置く。この文書で決めた規約 (仕様の書き方) だけは、理由もここに書く。

守り方は 3 つ。1 つの規約を 2 つ以上で守るときは ` / ` で並べる。

- `lint: <規則>`: `npm run lint` (`redocly.yaml` の規則) が落とす。規則が働くことは、規則が見る場所と規則の assertion ごとに置いた落ちる例 (`test/fixtures/lint/` の、規則の名前の `/` を `-` にしたディレクトリ) が示す (`test/lint.test.ts`)
- `テスト: <ファイル> の「<it の名前>」`: `npm run test` が落とす
- `人が見る`: 道具では確かめない。見直しのときに人が確かめる

表に無い組み込みの規則 (operationId があること・タグに説明があることなど) は、`redocly.yaml` の土台の recommended-strict のまま当てる。落ちる例は持たない。

`test/guidelines.test.ts` が、表の `lint:` の規則と、落ちる例を置いた規則が 1 対 1 で、`テスト:` のファイルと it の名前があることを確かめる。

## 仕様の書き方

この文書で決めた規約。

| 規約 | 決めた文書 | 守り方 |
| --- | --- | --- |
| `servers` を書く。API を置く場所はまだ無いので `/` (省いたときの既定と同じ) にする | この文書 | lint: `no-empty-servers` / 人が見る |
| 認証の要らない操作には、操作ごとに `security: []` を書く。最上位には書かない | この文書 | lint: `security-defined` / lint: `rule/root-no-security` |
| 仕様の例は、置いた場所のスキーマに合わせる | この文書 | lint: `no-invalid-media-type-examples` / lint: `no-invalid-parameter-examples` / lint: `no-invalid-schema-examples` / テスト: `test/openapi.test.ts` の「仕様の名前付きの例が、置かれた場所のスキーマに合い、どれもどこかに置かれている」 |
| スキーマの例は `examples` に書き、`example` を使わない | この文書 | lint: `rule/schema-no-example` |
| 仕様の `title`・`summary`・`description` に、用語集 (`docs/glossary.yaml`) の使わない語を書かない | この文書 | lint: `rule/glossary-avoid` / テスト: `test/glossary.test.ts` の「docs/ の文書と仕様に、用語集の使わない語が無い」 |
| スキーマは、JSON Schema の draft-07 と 2020-12 で同じに働くキーワードだけで書く | この文書 | 人が見る |

- `no-empty-servers` は `servers` が空でないことだけを見るので、`/` にしたことは人が見る
- 認証の要らない操作の `security: []` を最上位に書くと、lint の `security-defined` は、後で足した操作に `security` が無くても落とさない (最上位の `security` があれば、操作ごとには確かめない)。そこで最上位の `security` を `rule/root-no-security` で落とし、操作ごとに書かせる。操作ごとに書けば、`security` を書き忘れた操作で落ちる。OpenAPI 3.1.2 で、操作の空の `security` は最上位の宣言を取り除き、最上位の一覧は不完全でよいとされるので、認証が要らないことを言い切れるのは操作ごとの書き方になる
- スキーマの `example` は、OpenAPI 3.1.2 で非推奨になり、JSON Schema の `examples` を使うよう求められている。このリポジトリのテストの検証器 (Ajv の JSON Schema 2020-12 の検証器) も、`example` を知らないキーワードとして誤りにする。パラメータ・ヘッダ・メディアタイプの `example` は非推奨でないので、この規約に入れない
- `title`・`summary`・`description` の語は lint が探すが、lint は `$ref` と並べた `description` と YAML のコメントを見ないので、テストが仕様のファイルの文字としても探す
- 2020-12 にしか無いキーワード (`prefixItems`・`unevaluatedProperties` など) は、仕様を読む道具の一部が検証しない。使うときは、道具ごとに確かめてから、この規約を直す

## エンドポイント

| 規約 | 決めた文書 | 守り方 |
| --- | --- | --- |
| パスのセグメントは小文字の英語にし、2 語以上なら `-` でつなぐ | `endpoints.md` の名前の決まり | 人が見る |
| コレクションは複数形にする | `endpoints.md` の名前の決まり | 人が見る |
| パスの変数の名前は、用語集の code にする | `endpoints.md` の名前の決まり | テスト: `test/operations.test.ts` の「パスの変数の名前が、用語集の code にある」 |
| 標準のメソッド (AIP-121 の取得・一覧・作成・更新・削除) で表せる操作では、パスに動詞を入れない | `endpoints.md` の名前の決まり | 人が見る |
| 基底のパスを付けず、1 周目は API の版をパスに入れない | `endpoints.md` の名前の決まり | 人が見る |
| 操作の名前 (operationId) は camelCase にし、対応表 (`operations.yaml`) と同じにする | `operations.yaml` | lint: `rule/operation-id-camel-case` / テスト: `test/openapi.test.ts` の「仕様の操作が、対応表の操作と、メソッド・パス・操作の名前の組で一致する」 |
| リソースを作る操作の 201 は、`Location` で作ったリソースの URL を返す | `endpoints.md` の一覧 | lint: `rule/created-has-location` |

- パスの形を lint (組み込みの `paths-kebab-case`) で守らないのは、`/orders/{orderId}:cancel` のようなカスタムメソッドの形も落とすため。標準のメソッドで表せない操作の形は、後の周回で比べて決める
- `rule/created-has-location` は、ヘッダの名前を `Location` の綴りどおりに探す。HTTP のヘッダの名前は大文字と小文字を区別しないが、仕様には `Location` と書く (`location` と書くと lint が落とす)

## 表現

| 規約 | 決めた文書 | 守り方 |
| --- | --- | --- |
| キーは camelCase にする (誤りの応答の拡張メンバーを含む、API のすべてのスキーマ) | `representation.md` のキー | lint: `rule/property-names-camel-case` |
| ドメインの値を運ぶキーは、語の用語集の code と同じ名前にする | `representation.md` のキー・`problems.md` の拡張メンバー | テスト: `test/representation.test.ts` の「キーの表の行はどれも形が合い、語は用語集にあり、配列でないキーは、その語の用語集の code と同じ。場所は、最上位か配列のキーの要素」 / テスト: `test/problems.test.ts` の「拡張メンバーの表の行はどれも決めた形で書かれ、問題の型の表の拡張メンバーはこの表にあり、語は用語集にあり、配列でないメンバーの名前は語の code と同じ」 / テスト: `test/openapi.test.ts` の「表現の決まりのキーの表と、リクエストと表現のスキーマが、キーの名前と場所と必須で一致する」 / 人が見る |
| 配列のキーは、要素の語の複数形の英語にする | `representation.md` のキー | 人が見る |
| 型と、スキーマで書ける範囲の正本は仕様のスキーマにし、表の型の列は要約にする | `representation.md` のキー | 人が見る |
| リクエストは表に無いキーを断り、応答には後からキーを足す | `representation.md` の形 | テスト: `test/openapi.test.ts` の「リクエストのスキーマは知らないキーを断り、表現のスキーマは知らないキーを通す」 |
| null を使わず、値が無いことはキーを省いて表す | `representation.md` の値の形 | テスト: `test/representation.test.ts` の「例に null が無い (配列の要素も含めて)」 / 人が見る |
| リクエストの本文は `application/json` で受け付け、応答のメディアタイプは `Accept` で選ぶ (受け入れないと 406、本文が違うと 415) | `representation.md` のメディアタイプ | 人が見る |

- ドメインの値を運ぶキーに当たらないのは、RFC 9457 が定める問題の詳細のメンバー (`type`・`title`・`status`・`detail`・`instance`) と、RFC 9457 の例にそろえたメンバー (`errors` と、その要素の `pointer`・`detail`)。問題の詳細の `status` は HTTP のステータスコードで、用語集の状態 (`status`、注文の状態) とは別のもの
- メディアタイプの決まりの正本は `representation.md`。`problems.md` の失敗の一覧は、その失敗をステータスコードと問題の型に写し、`endpoints.md` の一覧の失敗の列は、`problems.md` を要約する
- ドメインの値を運ぶキーの行で、テストが仕様のスキーマのキーと照らすのは、注文するのリクエストと注文の表現だけ。誤りの応答の拡張メンバーは、表と例のファイルを照らすだけなので、仕様の問題の詳細のスキーマのキーは人が見る
- 型の正本の行は、テストのコードやキーの表に範囲の値 (上限の 100・税率の 8 と 10) を書き写しても、どのテストも落ちない。値は仕様から読むことを、人が見る
- null の行のテストが見るのは例の値だけで、スキーマに null の型 (`type: [string, 'null']`) を書いても落ちない。スキーマは人が見る

## 誤りの応答

| 規約 | 決めた文書 | 守り方 |
| --- | --- | --- |
| 誤りの応答 (4xx も 5xx も) は、本文に `application/problem+json` の問題の詳細を返す | `problems.md` | lint: `rule/error-responses-have-content` / lint: `rule/error-responses-problem-json` / 人が見る |
| 失敗ごとのステータスコードと問題の型は、失敗の一覧と問題の型の表に従う | `problems.md` の失敗の一覧・問題の型 | テスト: `test/problems.test.ts` の「失敗の一覧の行とユースケースの別の流れの行はどれも決めた形で書かれ、別の流れはどれも失敗の一覧にちょうど 1 回あり、一覧の型とステータスコードの組は問題の型の表にあり、表の型はどれも一覧で使う」 / 人が見る |
| 問題の型の表と例は 1 対 1 にし、例は表の題と拡張メンバーに合わせる | `problems.md` の問題の型 | テスト: `test/problems.test.ts` の「問題の型の表の行はどれも決めた形で書かれ、例のファイルと 1 対 1 で、自前の型は /problems/ と kebab-case の相対 URI で重ならず、about:blank の題はステータスコードの名前」 / テスト: `test/problems.test.ts` の「例の type・title・status は表の行と同じで、例は行の拡張メンバーをすべて持ち、ほかには RFC 9457 の type・title・status・detail だけを持ち、null が無い」 |

- 誤りの応答の 2 つの規則は、ステータスコードのキー (`404`) と範囲のキー (`4XX`・`5XX`) の応答に当たり、`components/responses` に置いて `$ref` で指した応答にも当たる。`default` の応答は成功の応答も兼ねうるので当てない。`default` を使うときは人が見る
- 2 つの規則が見るのは、本文があることとメディアタイプのキーまでで、本文のスキーマが問題の詳細の形か (`Problem.yaml` を `allOf` に持つか) は見ない。スキーマの形は人が見る
- 失敗の一覧の行のテストが見るのは、`problems.md` の表どうしとユースケースの別の流れで、仕様の操作の応答のステータスコードを失敗の一覧と比べない。仕様の応答は人が見る
