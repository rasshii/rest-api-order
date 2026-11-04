/*
 * docs/ の文書と仕様 (openapi/) に、用語集 (docs/glossary.yaml) の使わない語が無いことと、
 * 仕様の lint の規則 (redocly.yaml の rule/glossary-avoid) が用語集の使わない語をどれも探すことを確かめる。
 * 同じものを別の語で書くと、読む人は別のものを指していると受け取るため。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

interface Term {
  name: string;
  code?: string;
  definition: string;
  avoid?: string[];
}

interface Glossary {
  allowed?: string[];
  terms: Term[];
}

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const raw: unknown = parse(readFileSync(join(docs, 'glossary.yaml'), 'utf8'));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isWords(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isText);
}

/*
 * 用語集の形の崩れを、見つけた順に文で返す。avoid のキーを綴り違えたり値を書き忘れたりすると、
 * その語の確かめが黙って抜けるので、知らないキーと、空の avoid も崩れとみなす。
 */
function shapeProblems(value: unknown): string[] {
  if (!isRecord(value)) return ['用語集が、キーと値の組でない'];
  const problems = Object.keys(value)
    .filter((key) => key !== 'allowed' && key !== 'terms')
    .map((key) => `知らないキー: ${key}`);
  if ('allowed' in value && !isWords(value.allowed)) problems.push('allowed が、1 つ以上の語の配列でない');
  if (!Array.isArray(value.terms) || value.terms.length === 0) return [...problems, 'terms が、1 つ以上の項の配列でない'];
  value.terms.forEach((term: unknown, index) => {
    const where = `terms の ${index + 1} 番目`;
    if (!isRecord(term)) {
      problems.push(`${where} が、キーと値の組でない`);
      return;
    }
    for (const key of Object.keys(term)) {
      if (!['name', 'code', 'definition', 'avoid'].includes(key)) problems.push(`${where}: 知らないキー ${key}`);
    }
    if (!isText(term.name)) problems.push(`${where}: name が無い`);
    if (!isText(term.definition)) problems.push(`${where}: definition が無い`);
    if ('code' in term && !isText(term.code)) problems.push(`${where}: code が空`);
    if ('avoid' in term && !isWords(term.avoid)) problems.push(`${where}: avoid が、1 つ以上の語の配列でない`);
    // 括弧・読点・中黒・コンマを含む語は、2 つの語を 1 つに書いたものと読めて、どちらの形でも探せない。
    for (const word of isWords(term.avoid) ? term.avoid : []) {
      if (/[()（）、・,，]/.test(word)) problems.push(`${where}: avoid の「${word}」が 1 つの語の形でない`);
    }
  });
  return problems;
}

const problems = shapeProblems(raw);
const glossary: Glossary = problems.length === 0 ? (raw as Glossary) : { terms: [] };
const names = glossary.terms.map((term) => term.name);

const root = fileURLToPath(new URL('../', import.meta.url));

/*
 * 使わない語を探すファイルを、リポジトリの root からの相対パスで返す。docs/ の .md と .yaml (用語集そのものを除く) と、仕様の openapi/ の .yaml。
 * 仕様は lint の規則も探すが、lint は $ref の隣の description と YAML のコメントを見ないので、ファイルの文字としても探す。
 */
function searchedFiles(): string[] {
  const under = (dir: string, extensions: string[]) =>
    readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
      .filter((file) => extensions.some((extension) => file.endsWith(extension)))
      .map((file) => join(dir, file));
  return [...under('docs', ['.md', '.yaml']), ...under('openapi', ['.yaml'])].filter((file) => file !== join('docs', 'glossary.yaml')).sort();
}

/*
 * 使わない語を探す前に、その語を含む用語集の語と allowed の語を消す。消さないと、「消費税額」の中の「税額」のように、
 * 正しい語の一部を使わない語として見つける。消すのはその語を含む語だけにする。用語集の語をすべて消すと、
 * 「税込価格」の中の「価格」も消えて、使わない語を見落とす。
 */
function containsAvoided(text: string, word: string): boolean {
  const masked = [...names, ...(glossary.allowed ?? [])]
    .filter((other) => other !== word && other.includes(word))
    .reduce((rest, other) => rest.replaceAll(other, '\n'), text);
  return masked.includes(word);
}

it('用語集の形が崩れておらず、語が重ならず、使わない語がほかの語の名前になっていない', () => {
  expect(problems).toEqual([]);
  expect(new Set(names).size).toBe(names.length);
  const avoided = glossary.terms.flatMap((term) => term.avoid ?? []);
  expect(avoided.length).toBeGreaterThan(0);
  expect(avoided.filter((word) => names.includes(word))).toEqual([]);
});

it('docs/ の文書と仕様に、用語集の使わない語が無い', () => {
  // 用語集の形が崩れると語の一覧が空になり、この it だけを回したときに何も探さずに通るので、ここでも確かめる。
  expect(problems).toEqual([]);
  expect(glossary.terms.flatMap((term) => term.avoid ?? []).length).toBeGreaterThan(0);
  const files = searchedFiles();
  expect(files.filter((file) => file.endsWith('.md')).length).toBeGreaterThan(0);
  expect(files.filter((file) => file.startsWith('openapi')).length).toBeGreaterThan(0);
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const term of glossary.terms) {
      for (const word of term.avoid ?? []) {
        if (containsAvoided(text, word)) found.push(`${file}: ${word} (用語集の ${term.name} を見る)`);
      }
    }
  }
  expect(found).toEqual([]);
});

/*
 * 仕様の lint の規則 rule/glossary-avoid が探す正規表現 (redocly.yaml に、用語集から手で写したもの)。
 * Redocly は notPattern の '/<式>/<フラグ>' を正規表現として読むので、同じ形で JavaScript の正規表現にする。
 */
function lintPattern(): RegExp | undefined {
  const config: unknown = parse(readFileSync(join(root, 'redocly.yaml'), 'utf8'));
  const rule = isRecord(config) && isRecord(config.rules) ? config.rules['rule/glossary-avoid'] : undefined;
  const notPattern = isRecord(rule) && isRecord(rule.assertions) ? rule.assertions.notPattern : undefined;
  const match = typeof notPattern === 'string' ? /^\/(.+)\/([a-z]*)$/s.exec(notPattern) : null;
  return match === null ? undefined : new RegExp(match[1], match[2]);
}

it('仕様の lint の規則が、用語集の使わない語にどれも当たり、その語を含む用語集の語と allowed の語には当たらない', () => {
  expect(problems).toEqual([]);
  const pattern = lintPattern();
  expect(pattern, 'redocly.yaml の rule/glossary-avoid の notPattern').toBeDefined();
  const words = glossary.terms.flatMap((term) => term.avoid ?? []);
  expect(words.length).toBeGreaterThan(0);
  expect(words.filter((word) => !pattern?.test(word))).toEqual([]);
  // 05 章の確かめと同じく、使わない語を含む用語集の語と allowed の語 (消費税額など) は、その語として探さない。
  const containing = [...names, ...(glossary.allowed ?? [])].filter((other) => words.some((word) => other !== word && other.includes(word)));
  expect(containing.length).toBeGreaterThan(0);
  expect(containing.filter((other) => pattern?.test(other))).toEqual([]);
});
