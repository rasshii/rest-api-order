/*
 * ユースケースから API の操作までの対応表 (docs/api-design/operations.yaml) が、要件・モデル・エンドポイントの文書と
 * 食い違わないことを確かめる。表は文書の語と名前を写したものなので、片方だけを直すと、別のものを指すようになるため。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

interface Operation {
  useCase: string;
  command?: string;
  aggregateMethod?: string;
  readModel?: string;
  method: string;
  path: string;
  operationId: string;
}

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

const raw: unknown = parse(read('docs/api-design/operations.yaml'));
const useCases = read('docs/requirements/use-cases.md');
const board = read('docs/model/event-storming.md');
const model = read('docs/model/domain-model.md');
const endpoints = read('docs/api-design/endpoints.md');
const glossary: unknown = parse(read('docs/glossary.yaml'));

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const writeKeys = 'aggregateMethod,command,method,operationId,path,useCase';
const readKeys = 'method,operationId,path,readModel,useCase';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** /orders/{orderId} のように、小文字の英語のセグメントか {lowerCamelCase の変数} を / でつないだパスか。 */
function isPath(value: unknown): boolean {
  return isText(value) && /^(\/([a-z][a-z0-9-]*|\{[a-z][a-zA-Z0-9]*\}))+$/.test(value);
}

/*
 * 対応表の形の崩れを、見つけた順に文で返す。キーを綴り違えると、その項目の照合が黙って抜けるので、知らないキーも崩れとみなす。
 * 状態を変える行は command と aggregateMethod を、読むだけの行は readModel を持つ。
 */
function shapeProblems(value: unknown): string[] {
  if (!isRecord(value) || Object.keys(value).join() !== 'operations') return ['最上位のキーが operations の 1 つでない'];
  if (!Array.isArray(value.operations) || value.operations.length === 0) return ['operations が、1 つ以上の操作の配列でない'];
  const problems: string[] = [];
  value.operations.forEach((entry: unknown, index) => {
    const where = `operations の ${index + 1} 番目`;
    if (!isRecord(entry)) {
      problems.push(`${where}: キーと値の組でない`);
      return;
    }
    const keys = Object.keys(entry).sort().join();
    if (keys !== writeKeys && keys !== readKeys) {
      problems.push(`${where}: キーが、状態を変える行 (${writeKeys}) か読むだけの行 (${readKeys}) の組でない`);
      return;
    }
    for (const [key, field] of Object.entries(entry)) {
      if (!isText(field)) problems.push(`${where}: ${key} が空でない文字列でない`);
    }
    if (!methods.includes(entry.method as string)) problems.push(`${where}: method が ${methods.join('・')} のどれでもない`);
    if (!isPath(entry.path)) problems.push(`${where}: path が /orders/{orderId} のような形でない`);
    if (!isText(entry.operationId) || !/^[a-z][a-zA-Z0-9]*$/.test(entry.operationId)) {
      problems.push(`${where}: operationId が lowerCamelCase でない`);
    }
    if (keys === writeKeys && (!isText(entry.aggregateMethod) || !/^[A-Z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(entry.aggregateMethod))) {
      problems.push(`${where}: aggregateMethod が Order.place のような クラス名.メソッド名 の形でない`);
    }
  });
  return problems;
}

const problems = shapeProblems(raw);
const parsed: Operation[] = problems.length === 0 ? (raw as { operations: Operation[] }).operations : [];

/*
 * 対応表の操作。形が崩れると空になり、行ごとに確かめる it が何も確かめずに通る (-t で 1 本だけ回したときも) ので、
 * どの it もこれを通して読み、形の崩れと空をその it の失敗にする。
 */
function loadedOperations(): Operation[] {
  expect(problems).toEqual([]);
  expect(parsed.length).toBeGreaterThan(0);
  return parsed;
}

/** 文書の中の、pattern に当たる行の数。拾う正規表現より緩く数え、拾えない書き方の行が黙って抜けていないかを比べる。 */
function countLines(text: string, pattern: RegExp): number {
  return text.split(/\r?\n/).filter((line) => pattern.test(line)).length;
}

/** 見出しの行が header の表の、本体の行 (見出しと区切りの行の次から、空行の前まで) の数。 */
function tableRowCount(text: string, header: string): number {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(header);
  if (start < 0) return 0;
  const end = lines.findIndex((line, index) => index > start && line.trim() === '');
  return lines.slice(start + 2, end < 0 ? undefined : end).length;
}

/** Markdown の中から、正規表現の 1 つ目の組に当たる文字列を、書いた順に返す。 */
function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/*
 * ドメインモデルのクラス図で、クラス name の中括弧の中にある行を返す。クラスが無ければ空。
 * Windows の git が改行を CRLF にして取り出しても読めるよう、行の終わりの \r を許す。
 * name は形の確かめを通った英数字だけなので、正規表現に埋めても特別な文字は入らない。
 */
function classMembers(name: string): string[] {
  const block = new RegExp(`^\\s*class ${name} \\{\\r?\\n([\\s\\S]*?)^\\s*\\}`, 'm').exec(model);
  return block === null ? [] : block[1].split('\n').map((line) => line.trim());
}

it('対応表の形が崩れていない', () => {
  expect(problems).toEqual([]);
});

it('ユースケースの文書のユースケースが、対応表にちょうど 1 回ずつ現れる', () => {
  const operations = loadedOperations();
  const documented = captures(useCases, /^## ユースケース: (.+)$/gm);
  expect(documented.length).toBeGreaterThan(0);
  expect(documented.length, 'ユースケースの見出しの形').toBe(countLines(useCases, /^##\s*ユースケース/));
  expect(operations.map((operation) => operation.useCase).sort()).toEqual([...documented].sort());
});

it('ボードのコマンドが対応表にすべて現れ、対応表の読むものはボードのリードモデルにある', () => {
  const operations = loadedOperations();
  const commands = captures(board, /"コマンド<br\/>([^"]+)"/g);
  const readModels = captures(board, /"リードモデル<br\/>([^"]+)"/g);
  expect(commands.length).toBeGreaterThan(0);
  expect(commands.length, 'ボードのコマンドの付箋の形').toBe(countLines(board, /コマンド</));
  expect(operations.flatMap((operation) => operation.command ?? []).sort()).toEqual([...commands].sort());
  for (const operation of operations) {
    if (operation.readModel !== undefined) expect(readModels).toContain(operation.readModel);
  }
});

it('集約のメソッドが、ドメインモデルのクラス図のクラスにある', () => {
  const operations = loadedOperations();
  expect(operations.filter((operation) => operation.aggregateMethod !== undefined).length).toBeGreaterThan(0);
  for (const operation of operations) {
    if (operation.aggregateMethod === undefined) continue;
    const [className, methodName] = operation.aggregateMethod.split('.');
    expect(classMembers(className), operation.aggregateMethod).toContainEqual(expect.stringMatching(new RegExp(`^${methodName}\\(`)));
  }
});

it('パスの変数の名前が、用語集の code にある', () => {
  const terms = isRecord(glossary) && Array.isArray(glossary.terms) ? glossary.terms : [];
  const codes = terms.flatMap((term: unknown) => (isRecord(term) && isText(term.code) ? [term.code] : []));
  const operations = loadedOperations();
  expect(codes.length).toBeGreaterThan(0);
  for (const operation of operations) {
    for (const variable of captures(operation.path, /\{([^}]+)\}/g)) expect(codes, operation.path).toContain(variable);
  }
});

it('操作の名前も、メソッドとパスの組も、対応表の中で重ならない', () => {
  const operations = loadedOperations();
  const ids = operations.map((operation) => operation.operationId);
  const routes = operations.map((operation) => `${operation.method} ${operation.path}`);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(routes).size).toBe(routes.length);
});

it('エンドポイントの一覧と対応表が、同じ操作を同じメソッドとパスで持つ', () => {
  const operations = loadedOperations();
  const listed = [...endpoints.matchAll(/^\| `([A-Z]+ \/[^`]*)` \| `([^`]+)` \|/gm)].map((match) => `${match[1]} ${match[2]}`);
  expect(listed.length).toBeGreaterThan(0);
  expect(listed.length, 'エンドポイントの一覧の行の形').toBe(tableRowCount(endpoints, '| メソッドとパス | 操作の名前 | 成功したとき | 失敗したとき |'));
  const table = operations.map((operation) => `${operation.method} ${operation.path} ${operation.operationId}`);
  expect(table.sort()).toEqual(listed.sort());
});
