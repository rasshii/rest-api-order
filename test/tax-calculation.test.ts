/*
 * examples/domain/tax-calculation.json の計算例が、ドメインモデル (docs/model/domain-model.md) の求め方と合っていることを確かめる。
 * 計算例は、注文の集約を実装するときのテストの入力にもなるので、例の値そのものが誤っていないかを先に確かめる。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

interface Line {
  product: string;
  unitPrice: number;
  quantity: number;
  taxRate: number;
}

interface RateTotal {
  taxRate: number;
  total: number;
  taxAmount: number;
}

interface Example {
  name: string;
  lines: Line[];
  total: number;
  taxByRate: RateTotal[];
  taxAmount: number;
}

const raw: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../examples/domain/tax-calculation.json', import.meta.url)), 'utf8'),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** keys のキーをすべて持ち、ほかのキーを持たないか。 */
function hasExactly(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).sort().join() === [...keys].sort().join();
}

function isYen(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isQuantity(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 1;
}

function isTaxRate(value: unknown): boolean {
  return value === 8 || value === 10;
}

function isLine(value: unknown): boolean {
  return (
    hasExactly(value, ['product', 'unitPrice', 'quantity', 'taxRate']) &&
    typeof value.product === 'string' &&
    isYen(value.unitPrice) &&
    isQuantity(value.quantity) &&
    isTaxRate(value.taxRate)
  );
}

function isRateTotal(value: unknown): boolean {
  return (
    hasExactly(value, ['taxRate', 'total', 'taxAmount']) &&
    isTaxRate(value.taxRate) &&
    isYen(value.total) &&
    isYen(value.taxAmount)
  );
}

/*
 * 計算例の形の崩れを、見つけた順に文で返す。キーの綴り違いや値の型の誤りがあると、計算と照らす前に値が読めず、
 * 例が黙って抜けるか、誤った理由で落ちるので、先に形を確かめる。
 */
function shapeProblems(value: unknown): string[] {
  if (!hasExactly(value, ['rounding', 'examples'])) return ['最上位のキーが rounding と examples の 2 つでない'];
  if (value.rounding !== 'floor') return ['rounding が floor でない (このテストは 1 円未満を切り捨てて計算する)'];
  if (!Array.isArray(value.examples) || value.examples.length === 0) return ['examples が、1 つ以上の例の配列でない'];
  const problems: string[] = [];
  value.examples.forEach((example: unknown, index) => {
    const where = `examples の ${index + 1} 番目`;
    if (!hasExactly(example, ['name', 'lines', 'total', 'taxByRate', 'taxAmount'])) {
      problems.push(`${where}: キーが name・lines・total・taxByRate・taxAmount の 5 つでない`);
      return;
    }
    if (typeof example.name !== 'string' || example.name === '') problems.push(`${where}: name が無い`);
    if (!Array.isArray(example.lines) || example.lines.length === 0 || !example.lines.every(isLine)) {
      problems.push(`${where}: lines が、商品・単価・数量 (1 以上)・税率 (8 か 10) を持つ注文明細の配列でない`);
    }
    if (!Array.isArray(example.taxByRate) || !example.taxByRate.every(isRateTotal)) {
      problems.push(`${where}: taxByRate が、税率・合計・消費税額を持つ配列でない`);
    }
    if (!isYen(example.total) || !isYen(example.taxAmount)) problems.push(`${where}: total か taxAmount が円の整数でない`);
  });
  return problems;
}

/** 税率ごとの合計に含まれる消費税額。1 円未満を切り捨て、整数の割り算で求める (浮動小数点の誤差を入れない)。 */
function taxAmountOf(total: number, taxRate: number): number {
  const numerator = total * taxRate;
  return (numerator - (numerator % (100 + taxRate))) / (100 + taxRate);
}

/** 注文明細から、合計・税率ごとの合計と消費税額・消費税額を求める。税率ごとの合計から 1 回だけ割り戻す。 */
function calculate(lines: Line[]): Omit<Example, 'name' | 'lines'> {
  const totals = new Map<number, number>();
  for (const line of lines) {
    totals.set(line.taxRate, (totals.get(line.taxRate) ?? 0) + line.unitPrice * line.quantity);
  }
  const taxByRate = [...totals]
    .sort(([a], [b]) => a - b)
    .map(([taxRate, total]) => ({ taxRate, total, taxAmount: taxAmountOf(total, taxRate) }));
  return {
    total: taxByRate.reduce((sum, rate) => sum + rate.total, 0),
    taxByRate,
    taxAmount: taxByRate.reduce((sum, rate) => sum + rate.taxAmount, 0),
  };
}

const problems = shapeProblems(raw);
const examples: Example[] = problems.length === 0 ? (raw as { examples: Example[] }).examples : [];

it('計算例の形が崩れていない', () => {
  expect(problems).toEqual([]);
});

for (const example of examples) {
  it(`計算例「${example.name}」の合計と消費税額が、求め方と合う`, () => {
    const { total, taxByRate, taxAmount } = example;
    expect({ total, taxByRate, taxAmount }).toEqual(calculate(example.lines));
  });
}
