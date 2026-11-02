/*
 * 注文 API の仕様 (openapi/openapi.yaml) が、対応表・表現の決まり・例のファイルと食い違わないことを確かめる。
 * 仕様はこれらを写したものなので、片方だけを直すと、仕様と文書が別のことを言うようになるため。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadSpec, schemaValidator } from './support/openapi.ts';

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 値の中の、名前で並ぶオブジェクト (paths・components の各部など)。無ければ空。 */
function entries(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : [];
}

const spec = loadSpec();
const components = isRecord(spec) && isRecord(spec.components) ? spec.components : {};
const schemas = isRecord(components.schemas) ? components.schemas : {};
const namedExamples = isRecord(components.examples) ? components.examples : {};

/** '#/components/<種類>/<名前>' の参照なら名前を、そうでなければ undefined を返す。 */
function refName(value: unknown, kind: string): string | undefined {
  if (!isRecord(value) || typeof value.$ref !== 'string') return undefined;
  const prefix = `#/components/${kind}/`;
  return value.$ref.startsWith(prefix) ? value.$ref.slice(prefix.length) : undefined;
}

/** スキーマの部品の参照なら、参照先の部品を返す。参照でなければ、そのまま返す。 */
function deref(value: unknown): unknown {
  const name = refName(value, 'schemas');
  return name === undefined ? value : schemas[name];
}

/*
 * Path Item で操作を表すフィールド (OpenAPI 3.1 の HTTP のメソッド)。
 * Path Item に書いてよい操作でないキー。ほかのキー ($ref を含む) は、操作を見落とさないよう誤りにする。
 */
const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const pathItemKeys = ['summary', 'description', 'servers', 'parameters'];

/** 仕様の操作を「メソッド パス operationId」の文にして返す。拾えないものは problems に入れる。 */
function operationsOf(problems: string[]): string[] {
  const operations: string[] = [];
  const paths = isRecord(spec) ? spec.paths : undefined;
  for (const [path, item] of entries(paths)) {
    for (const [key, operation] of entries(item)) {
      if (!methods.includes(key)) {
        if (!pathItemKeys.includes(key)) problems.push(`${path} の Path Item に、操作でない知らないキー ${key} がある`);
        continue;
      }
      if (!isRecord(operation) || typeof operation.operationId !== 'string') {
        problems.push(`${key.toUpperCase()} ${path} に operationId が無い`);
        continue;
      }
      operations.push(`${key.toUpperCase()} ${path} ${operation.operationId}`);
    }
  }
  return operations;
}

/** 表の本体の行 (見出しと区切りの行の次から、空行の前まで)。形の合わない行を数えられるよう、正規表現で拾う前の行を返す。 */
function tableLines(text: string, header: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(header);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.trim() === '');
  return lines.slice(start + 2, end < 0 ? undefined : end);
}

/** 行を pattern で拾い、拾えない行は problems に足す。拾えない行が黙って抜けないよう、形の確かめと一緒に行う。 */
function rows<T>(text: string, header: string, pattern: RegExp, toRow: (match: RegExpExecArray) => T, problems: string[]): T[] {
  const lines = tableLines(text, header);
  if (lines.length === 0) problems.push(`表 ${header} が無いか、行が無い`);
  return lines.flatMap((line) => {
    const match = pattern.exec(line);
    if (match === null) {
      problems.push(`表の行を拾えない: ${line}`);
      return [];
    }
    return [toRow(match)];
  });
}

it('仕様の操作が、対応表の操作と、メソッド・パス・操作の名前の組で一致する', () => {
  const problems: string[] = [];
  const operations = operationsOf(problems);
  expect(problems).toEqual([]);
  expect(operations.length).toBeGreaterThan(0);
  const table: unknown = parse(read('docs/api-design/operations.yaml'));
  const rowsOfTable = isRecord(table) && Array.isArray(table.operations) ? table.operations.filter(isRecord) : [];
  const expected = rowsOfTable.map((row) => `${String(row.method)} ${String(row.path)} ${String(row.operationId)}`);
  expect([...operations].sort()).toEqual([...expected].sort());
});

interface KeyRow {
  key: string;
  /** 最上位なら空文字列、配列の要素ならその配列のキー。 */
  place: string;
  inRequest: boolean;
  inOrder: boolean;
}

const keyHeader = '| キー | 場所 | 語 | 型 | 注文するのリクエスト | 注文の表現 |';
const keyPattern = /^\| `([^`]+)` \| (?:最上位|`([^`]+)` の要素) \| [^|]+ \| [^|]+ \| (入れる|入れない) \| (入れる|入れない) \|$/;

/*
 * キーの表の列と、その列のキーを持つスキーマの部品。表の型と仕様のスキーマのどちらを元にするかはまだ決めていないので、
 * ここでは型を比べず、キーの名前・場所と、required (1 周目は省いてよいキーが無いので、入るキーはすべて必須) だけを比べる。
 */
const columns = [
  { column: 'inRequest', schema: 'PlaceOrderRequest' },
  { column: 'inOrder', schema: 'Order' },
] as const;

it('表現の決まりのキーの表と、リクエストと表現のスキーマが、キーの名前と場所と必須で一致する', () => {
  const problems: string[] = [];
  const keyRows = rows<KeyRow>(
    read('docs/api-design/representation.md'),
    keyHeader,
    keyPattern,
    (m) => ({ key: m[1], place: m[2] ?? '', inRequest: m[3] === '入れる', inOrder: m[4] === '入れる' }),
    problems,
  );
  expect(problems).toEqual([]);
  for (const { column, schema } of columns) {
    const root = schemas[schema];
    for (const place of [...new Set(keyRows.map((row) => row.place))]) {
      const expected = keyRows.filter((row) => row[column] && row.place === place).map((row) => row.key).sort();
      if (expected.length === 0) continue;
      const where = place === '' ? `${schema}` : `${schema} の ${place} の要素`;
      const target = place === '' ? root : deref(isRecord(root) && isRecord(root.properties) && isRecord(root.properties[place]) ? root.properties[place].items : undefined);
      const properties = isRecord(target) && isRecord(target.properties) ? Object.keys(target.properties).sort() : [];
      const required = isRecord(target) && Array.isArray(target.required) ? [...target.required].sort() : [];
      expect(properties, `${where} の properties`).toEqual(expected);
      expect(required, `${where} の required`).toEqual(expected);
    }
  }
});

/** 例のファイルのディレクトリ。仕様の名前付きの例は、このどちらかの同じ名前のファイルと同じ値にする。 */
const exampleDirs = ['examples/orders', 'examples/problems'];
const exampleFiles = new Map(
  exampleDirs.flatMap((dir) =>
    readdirSync(fileURLToPath(new URL(`../${dir}/`, import.meta.url)))
      .filter((name) => name.endsWith('.json'))
      .map((name) => [name.replace(/\.json$/, ''), `${dir}/${name}`] as const),
  ),
);

/*
 * どの操作にも書けない失敗 (エンドポイントの一覧に無いパスの 404 と、受け付けないメソッドの 405) の例のファイル。
 * 誤りの応答の決まり (problems.md) の失敗の一覧で操作が「操作の外」の行の型とステータスコードを、問題の型の表の例の列で引く。
 */
function outsideOperationExamples(problems: string[]): string[] {
  const text = read('docs/api-design/problems.md');
  const failures = rows(
    text,
    '| 操作 | 失敗 | ユースケース | 問題の型 | ステータスコード |',
    /^\| ([^|]+) \| [^|]+ \| [^|]+ \| `([^`]+)` \| (\d{3}) \|$/,
    (m) => ({ operation: m[1].trim(), type: m[2], status: m[3] }),
    problems,
  );
  const types = rows(
    text,
    '| 型 | ステータスコード | 題 | 使う場面 | 拡張メンバー | 例 |',
    /^\| `([^`]+)` \| (\d{3}) \| [^|]+ \| [^|]+ \| [^|]+ \| `([a-z-]+)\.json` \|$/,
    (m) => ({ type: m[1], status: m[2], example: m[3] }),
    problems,
  );
  return failures
    .filter((failure) => failure.operation === '操作の外')
    .flatMap((failure) => types.filter((type) => type.type === failure.type && type.status === failure.status).map((type) => type.example));
}

it('仕様の名前付きの例が、同じ名前の例のファイルと同じ値で、操作の外の失敗を除くファイルがどれも仕様にある', () => {
  const problems: string[] = [];
  const outside = outsideOperationExamples(problems);
  expect(problems).toEqual([]);
  expect(outside.length).toBeGreaterThan(0);
  for (const [name, example] of Object.entries(namedExamples)) {
    const file = exampleFiles.get(name);
    expect(file, `${name} の例のファイルが ${exampleDirs.join(' か ')} に無い`).toBeDefined();
    expect(isRecord(example) ? example.value : undefined, `${name} の value`).toStrictEqual(JSON.parse(read(file ?? '')));
  }
  const expected = [...exampleFiles.keys()].filter((name) => !outside.includes(name)).sort();
  expect(Object.keys(namedExamples).sort()).toEqual(expected);
});

/** 操作の requestBody と応答 (部品の応答の参照もたどる) の Media Type Object を、置き場の名前とともに返す。 */
function mediaTypes(): { where: string; media: unknown }[] {
  const responses = isRecord(components.responses) ? components.responses : {};
  const found: { where: string; media: unknown }[] = [];
  const paths = isRecord(spec) ? spec.paths : undefined;
  for (const [path, item] of entries(paths)) {
    for (const [method, operation] of entries(item).filter(([key]) => methods.includes(key))) {
      const where = `${method.toUpperCase()} ${path}`;
      const body = isRecord(operation) ? operation.requestBody : undefined;
      for (const [type, media] of entries(isRecord(body) ? body.content : undefined)) {
        found.push({ where: `${where} のリクエストの ${type}`, media });
      }
      for (const [code, response] of entries(isRecord(operation) ? operation.responses : undefined)) {
        const name = refName(response, 'responses');
        const resolved = name === undefined ? response : responses[name];
        for (const [type, media] of entries(isRecord(resolved) ? resolved.content : undefined)) {
          found.push({ where: `${where} の ${code} の ${type}`, media });
        }
      }
    }
  }
  return found;
}

it('仕様の名前付きの例が、置かれた場所のスキーマに合い、どれもどこかに置かれている', () => {
  const validator = schemaValidator(spec);
  const problems: string[] = [];
  const used = new Set<string>();
  for (const { where, media } of mediaTypes()) {
    const schema = refName(isRecord(media) ? media.schema : undefined, 'schemas');
    if (schema === undefined) {
      problems.push(`${where} の schema が components/schemas の部品の参照でない`);
      continue;
    }
    const validate = validator(schema);
    for (const [key, example] of entries(isRecord(media) ? media.examples : undefined)) {
      const name = refName(example, 'examples');
      const value = name === undefined ? undefined : namedExamples[name];
      if (name === undefined || !isRecord(value)) {
        problems.push(`${where} の例 ${key} が components/examples の例の参照でない`);
        continue;
      }
      used.add(name);
      if (!validate(value.value)) {
        problems.push(`${where} の例 ${name} が ${schema} に合わない: ${JSON.stringify(validate.errors)}`);
      }
    }
  }
  for (const name of Object.keys(namedExamples)) {
    if (!used.has(name)) problems.push(`例 ${name} がどこにも置かれていない`);
  }
  expect(problems).toEqual([]);
  expect(used.size).toBeGreaterThan(0);
});

/*
 * リクエストは、表で「入れる」としたほかのキーがあれば受け付けない (表現の決まりの形の節)。応答には後からキーを足し、
 * クライアントは知らないキーを無視する。仕様のスキーマがこの 2 つを写していることを、例に知らないキーを足して確かめる。
 */
it('リクエストのスキーマは知らないキーを断り、表現のスキーマは知らないキーを通す', () => {
  const validator = schemaValidator(spec);
  const request = JSON.parse(read('examples/orders/place-order-request.json')) as { lines: Record<string, unknown>[] };
  const order = JSON.parse(read('examples/orders/order.json')) as { lines: Record<string, unknown>[] };
  const withTopKey = <T extends object>(value: T) => ({ ...value, unknownKey: 1 });
  const withLineKey = <T extends { lines: Record<string, unknown>[] }>(value: T) => ({
    ...value,
    lines: [{ ...value.lines[0], unknownKey: 1 }, ...value.lines.slice(1)],
  });
  expect(validator('PlaceOrderRequest')(request), '知らないキーの無いリクエスト').toBe(true);
  expect(validator('PlaceOrderRequest')(withTopKey(request)), '最上位に知らないキーのあるリクエスト').toBe(false);
  expect(validator('PlaceOrderRequest')(withLineKey(request)), '注文明細に知らないキーのあるリクエスト').toBe(false);
  expect(validator('Order')(withTopKey(order)), '最上位に知らないキーのある注文の表現').toBe(true);
  expect(validator('Order')(withLineKey(order)), '注文明細に知らないキーのある注文の表現').toBe(true);
});

it('Location とパスの変数の例が、注文の例の注文 ID を指す', () => {
  const order = JSON.parse(read('examples/orders/order.json')) as { orderId: string };
  const paths = isRecord(spec) && isRecord(spec.paths) ? spec.paths : {};
  const post = isRecord(paths['/orders']) ? paths['/orders'].post : undefined;
  const created = isRecord(post) && isRecord(post.responses) ? post.responses['201'] : undefined;
  const location = isRecord(created) && isRecord(created.headers) ? created.headers.Location : undefined;
  expect(isRecord(location) ? location.example : undefined).toBe(`/orders/${order.orderId}`);
  const item = paths['/orders/{orderId}'];
  const parameters = isRecord(item) && Array.isArray(item.parameters) ? item.parameters.filter(isRecord) : [];
  expect(parameters.find((parameter) => parameter.name === 'orderId')?.example).toBe(order.orderId);
});
