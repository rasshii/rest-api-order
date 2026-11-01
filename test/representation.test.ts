/*
 * 注文の表現の例 (examples/orders/) が、表現の決まり (docs/api-design/representation.md) のキーの表と値の形と注文明細の決まりに合い、
 * ドメインモデルの計算例と同じ金額を持つことを確かめる。例は API の仕様の例やモックの応答に写すので、決まりに合わない例を写すと、
 * その形が API の形として伝わるため。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

interface KeyRow {
  key: string;
  place: string;
  term: string;
  type: string;
  inRequest: boolean;
  inOrder: boolean;
}

type Column = 'inRequest' | 'inOrder';

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON として読めなければ、理由の文を返す。読めない例は、ほかのテストを止めずに、1 つ目のテストで落とす。 */
function parseJson(text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const representation = read('docs/api-design/representation.md');
const glossary: unknown = parse(read('docs/glossary.yaml'));
const taxCalculation: unknown = JSON.parse(read('examples/domain/tax-calculation.json'));
const exampleFiles = readdirSync(fileURLToPath(new URL('../examples/orders/', import.meta.url))).filter((name) => name.endsWith('.json'));
const parsed = new Map(exampleFiles.map((name) => [name, parseJson(read(`examples/orders/${name}`))]));
const examples = new Map([...parsed].map(([name, result]) => [name, result.value]));

/** 例のファイルと、キーの表でその例に入るキーを決める列。examples/orders/ に例を足したら、ここにも足す。 */
const columns: Record<string, Column> = {
  'place-order-request.json': 'inRequest',
  'order.json': 'inOrder',
};

const header = '| キー | 場所 | 語 | 型 | 注文するのリクエスト | 注文の表現 |';
/** 場所は「最上位」か「`配列のキー` の要素」。place には、最上位なら空文字列を、配列の要素ならその配列のキーを入れる。 */
const rowPattern = /^\| `([^`]+)` \| (?:最上位|`([^`]+)` の要素) \| ([^|]+) \| ([^|]+) \| (入れる|入れない) \| (入れる|入れない) \|$/;

/** キーの表の本体の行 (見出しと区切りの行の次から、空行の前まで)。形の合わない行を数えられるよう、正規表現で拾う前の行を返す。 */
function keyTableLines(): string[] {
  const lines = representation.split(/\r?\n/);
  const start = lines.indexOf(header);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.trim() === '');
  return lines.slice(start + 2, end < 0 ? undefined : end);
}

const rows: KeyRow[] = keyTableLines().flatMap((line) => {
  const match = rowPattern.exec(line);
  if (match === null) return [];
  return [{ key: match[1], place: match[2] ?? '', term: match[3], type: match[4], inRequest: match[5] === '入れる', inOrder: match[6] === '入れる' }];
});

const terms = isRecord(glossary) && Array.isArray(glossary.terms) ? glossary.terms.filter(isRecord) : [];
const codeByName = new Map(terms.map((term) => [term.name, term.code]));
const codes = terms.flatMap((term) => (typeof term.code === 'string' ? [term.code] : []));

/*
 * キーの表の型ごとの確かめ方。表に、ここに無い型を書いたら、確かめ方が無いことを誤りとして返す
 * (型を足したのに確かめ方を足し忘れると、その型の値が何も確かめずに通るため)。
 */
const typeChecks: Record<string, (value: unknown) => boolean> = {
  '文字列': (value) => typeof value === 'string' && value !== '',
  '文字列 (UUIDv7)': (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value),
  '文字列 (UTC の日時)': (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value,
  '文字列 (状態の code)': (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value) && codes.includes(value),
  '文字列 (メールアドレス)': (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value),
  '配列 (1 つ以上)': (value) => Array.isArray(value) && value.length > 0,
  '整数 (1 以上)': (value) => Number.isSafeInteger(value) && (value as number) >= 1,
  '整数 (円)': (value) => Number.isSafeInteger(value) && (value as number) >= 0,
  '整数 (8 か 10)': (value) => value === 8 || value === 10,
};

/** 例の中の、キーの表のある場所のオブジェクトを、配列の要素の中までたどって、その場所と見出しの文とともに返す。 */
function objectsIn(value: unknown, place: string, where: string): { place: string; where: string; value: unknown }[] {
  const result = [{ place, where, value }];
  if (!isRecord(value)) return result;
  for (const row of rows.filter((candidate) => candidate.place === place && candidate.type.startsWith('配列'))) {
    const items = value[row.key];
    if (Array.isArray(items)) items.forEach((item, index) => result.push(...objectsIn(item, row.key, `${where} の ${row.key}[${index}]`)));
  }
  return result;
}

/** 値の中で null になっている位置を、配列の要素も含めて返す。 */
function nullsIn(value: unknown, where: string): string[] {
  if (value === null) return [where];
  if (Array.isArray(value)) return value.flatMap((item, index) => nullsIn(item, `${where}[${index}]`));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, field]) => nullsIn(field, `${where}.${key}`));
  return [];
}

it('examples/orders の例は、どれも JSON として読め、最上位がオブジェクト', () => {
  expect(exampleFiles.length).toBeGreaterThan(0);
  const problems: string[] = [];
  for (const [name, result] of parsed) {
    if (result.error !== undefined) problems.push(`${name}: JSON として読めない (${result.error})`);
    else if (!isRecord(result.value)) problems.push(`${name}: 最上位がオブジェクトでない`);
  }
  expect(problems).toEqual([]);
});

it('キーの表の行はどれも形が合い、語は用語集にあり、配列でないキーは、その語の用語集の code と同じ。場所は、最上位か配列のキーの要素', () => {
  expect(representation.split(/\r?\n/)).toContain(header);
  expect(rows.length).toBeGreaterThan(0);
  const arrays = rows.filter((row) => row.place === '' && row.type.startsWith('配列')).map((row) => row.key);
  const problems = keyTableLines()
    .filter((line) => !rowPattern.test(line))
    .map((line) => `形の合わない行: ${line}`);
  for (const row of rows) {
    if (!codeByName.has(row.term)) problems.push(`${row.key}: 語「${row.term}」が用語集に無い`);
    else if (!row.type.startsWith('配列') && codeByName.get(row.term) !== row.key) problems.push(`${row.key}: 語「${row.term}」の code と違う`);
    if (row.place !== '' && !arrays.includes(row.place)) problems.push(`${row.key}: 場所の ${row.place} が、最上位の配列のキーでない`);
  }
  expect(problems).toEqual([]);
});

it('例は、キーの表でその例の列に「入れる」としたキーを、その場所ごとにちょうど持つ', () => {
  const problems: string[] = [];
  for (const [name, example] of examples) {
    const column = columns[name];
    if (column === undefined) {
      problems.push(`${name}: 例の列が決まっていない`);
      continue;
    }
    for (const { place, where, value } of objectsIn(example, '', name)) {
      const expected = rows.filter((row) => row.place === place && row[column]).map((row) => row.key).sort();
      const actual = isRecord(value) ? Object.keys(value).sort() : [];
      if (!isRecord(value)) problems.push(`${where}: オブジェクトでない`);
      else if (actual.join() !== expected.join()) problems.push(`${where}: キーが ${actual.join(',')} で、表の ${expected.join(',')} と違う`);
    }
  }
  expect(problems).toEqual([]);
});

it('例の値は、キーの表の型に合う', () => {
  const problems: string[] = [];
  for (const row of rows) {
    if (typeChecks[row.type] === undefined) problems.push(`${row.key}: 型「${row.type}」の確かめ方が無い`);
  }
  for (const [name, example] of examples) {
    for (const { place, where, value } of objectsIn(example, '', name)) {
      if (!isRecord(value)) continue;
      for (const row of rows.filter((candidate) => candidate.place === place && candidate.key in value)) {
        const check = typeChecks[row.type];
        if (check !== undefined && !check(value[row.key])) problems.push(`${where} の ${row.key}: ${JSON.stringify(value[row.key])} が「${row.type}」でない`);
      }
    }
  }
  expect(problems).toEqual([]);
});

it('例に null が無い (配列の要素も含めて)', () => {
  expect([...examples].flatMap(([name, example]) => nullsIn(example, name))).toEqual([]);
});

it('例の注文明細は 100 以下で、同じ商品の注文明細が 2 つ以上無い', () => {
  const problems: string[] = [];
  for (const [name, example] of examples) {
    const lines = isRecord(example) && Array.isArray(example.lines) ? example.lines : [];
    if (lines.length > 100) problems.push(`${name}: 注文明細が ${lines.length} 個`);
    const productIds = lines.flatMap((line: unknown) => (isRecord(line) && typeof line.productId === 'string' ? [line.productId] : []));
    if (new Set(productIds).size !== productIds.length) problems.push(`${name}: 同じ商品の注文明細が 2 つ以上ある`);
  }
  expect(problems).toEqual([]);
});

it('注文の例は、リクエストの例と同じ注文を表し、金額はドメインモデルの計算例と同じ', () => {
  const request = examples.get('place-order-request.json') as { contactEmail: string; lines: { productId: string; quantity: number }[] };
  const order = examples.get('order.json') as {
    contactEmail: string;
    lines: { productId: string; quantity: number; unitPrice: number; taxRate: number }[];
    total: number;
    taxAmount: number;
  };
  expect(request, 'place-order-request.json が無いか、JSON として読めない').toBeDefined();
  expect(order, 'order.json が無いか、JSON として読めない').toBeDefined();
  expect(order.contactEmail).toBe(request.contactEmail);
  expect(order.lines.map(({ productId, quantity }) => ({ productId, quantity }))).toStrictEqual(request.lines);

  const calculations = isRecord(taxCalculation) && Array.isArray(taxCalculation.examples) ? taxCalculation.examples.filter(isRecord) : [];
  const calculation = calculations.find((example) => example.name === '税率ごとに注文明細が 1 つずつで、端数が出ない') as
    | { lines: { unitPrice: number; quantity: number; taxRate: number }[]; total: number; taxAmount: number }
    | undefined;
  expect(calculation).toBeDefined();
  expect(order.lines.map(({ unitPrice, quantity, taxRate }) => ({ unitPrice, quantity, taxRate }))).toStrictEqual(
    calculation?.lines.map(({ unitPrice, quantity, taxRate }) => ({ unitPrice, quantity, taxRate })),
  );
  expect({ total: order.total, taxAmount: order.taxAmount }).toStrictEqual({ total: calculation?.total, taxAmount: calculation?.taxAmount });
});
