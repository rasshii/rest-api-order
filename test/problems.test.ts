/*
 * 誤りの応答の例 (examples/problems/) が、誤りの応答の決まり (docs/api-design/problems.md) の問題の型の表と 1 対 1 で、
 * 表と拡張メンバーの決まりに合うことと、ユースケースの別の流れがどれも失敗の一覧にあることを確かめる。
 * 第 2 部の実装は問題の型の表を写すので、表と例が食い違うと、どちらを写すかで応答が変わるため。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

interface TypeRow {
  type: string;
  status: number;
  title: string;
  members: string[];
  example: string;
}

interface MemberRow {
  member: string;
  term: string;
  type: string;
}

interface FailureRow {
  useCase: string;
  type: string;
  status: number;
}

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** JSON として読めなければ、理由の文を返す。読めない例は、ほかのテストを止めずに、1 つ目のテストで落とす。 */
function parseJson(text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const problemsDoc = read('docs/api-design/problems.md');
const useCases = read('docs/requirements/use-cases.md');
const glossary: unknown = parse(read('docs/glossary.yaml'));
const exampleFiles = readdirSync(fileURLToPath(new URL('../examples/problems/', import.meta.url))).filter((name) => name.endsWith('.json'));
const parsed = new Map(exampleFiles.map((name) => [name, parseJson(read(`examples/problems/${name}`))]));
const examples = new Map([...parsed].map(([name, result]) => [name, result.value]));

/** RFC 9457 が定めるメンバーのうち、例に入れてよいもの (instance は 1 周目は使わない)。これ以外は、問題の型の表に書いた拡張メンバー。 */
const standardMembers = ['type', 'title', 'status', 'detail'];

/** RFC 9110 のステータスコードの名前。about:blank の題はこれと同じにする。表に about:blank の行を足したら、ここにも足す。 */
const statusNames: Record<number, string> = {
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  415: 'Unsupported Media Type',
};

/** RFC 6901 の 3 節の ABNF を写した、JSON Pointer の文字列の形。空文字列は本文全体を指す。 */
const jsonPointer = /^(\/([^/~]|~[01])*)*$/;

/** 拡張メンバーの値の確かめ方。拡張メンバーの表にメンバーを足したら、ここにも足す (足し忘れると 5 つ目のテストで落ちる)。 */
const memberChecks: Record<string, (value: unknown) => boolean> = {
  errors: (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((error) => isRecord(error) && Object.keys(error).sort().join() === 'detail,pointer' && typeof error.pointer === 'string' && jsonPointer.test(error.pointer) && isText(error.detail)),
  productIds: (value) => Array.isArray(value) && value.length > 0 && value.every(isText) && new Set(value).size === value.length,
  trackingId: isText,
};

/** header の行の表の本体 (見出しと区切りの行の次から、空行の前まで)。形の合わない行を数えられるよう、正規表現で拾う前の行を返す。 */
function tableLines(header: string): string[] {
  const lines = problemsDoc.split(/\r?\n/);
  const start = lines.indexOf(header);
  if (start < 0) return [];
  const end = lines.indexOf('', start);
  return lines.slice(start + 2, end < 0 ? undefined : end);
}

/** 行を pattern で拾い、拾えない行は problems に足す。拾えない行が黙って抜けないよう、形の確かめと一緒に行う。 */
function rows<T>(header: string, pattern: RegExp, toRow: (match: RegExpExecArray) => T, problems: string[]): T[] {
  const lines = tableLines(header);
  if (lines.length === 0) problems.push(`表 ${header} が無いか、行が無い`);
  return lines.flatMap((line) => {
    const match = pattern.exec(line);
    if (match === null) problems.push(`形の合わない行: ${line}`);
    return match === null ? [] : [toRow(match)];
  });
}

const typeHeader = '| 型 | ステータスコード | 題 | 使う場面 | 拡張メンバー | 例 |';
const typePattern = /^\| `([^`]+)` \| (\d{3}) \| `([^`]+)` \| [^|]+ \| (なし|`[a-zA-Z]+`(?:・`[a-zA-Z]+`)*) \| `([a-z-]+\.json)` \|$/;
const memberHeader = '| メンバー | 語 | 型 | 中身 |';
const memberPattern = /^\| `([a-zA-Z]+)` \| ([^|]+) \| ([^|]+) \| [^|]+ \|$/;
const failureHeader = '| 操作 | 失敗 | ユースケース | 問題の型 | ステータスコード |';
const failurePattern = /^\| [^|]+ \| [^|]+ \| ([^|]+) \| `([^`]+)` \| (\d{3}) \|$/;

/** 表ごとの形の崩れ。その表を使うテストで落とす。 */
const typeShape: string[] = [];
const memberShape: string[] = [];
const failureShape: string[] = [];
const typeRows = rows<TypeRow>(
  typeHeader,
  typePattern,
  (m) => ({ type: m[1], status: Number(m[2]), title: m[3], members: m[4] === 'なし' ? [] : m[4].replaceAll('`', '').split('・'), example: m[5] }),
  typeShape,
);
const memberRows = rows<MemberRow>(memberHeader, memberPattern, (m) => ({ member: m[1], term: m[2], type: m[3] }), memberShape);
const failureRows = rows<FailureRow>(failureHeader, failurePattern, (m) => ({ useCase: m[1], type: m[2], status: Number(m[3]) }), failureShape);

/*
 * use-cases.md の別の流れを、「注文する 2a」のようにユースケースの名前と手順の番号で返す。
 * 「### 別の流れ」の節の行は、決めた形 (- **2a** …) で拾えなければ problems に足す。書き方の違う 1 行が黙って抜けると、
 * その流れが失敗の一覧に無くても 6 本目が通るため。同じ理由で、ユースケースの見出しの下に無い別の流れの節、
 * 「別の流れ」を含むのに形の違う見出し、節の外にある別の流れの形の行も、形の崩れとして足す。
 */
function alternateFlows(problems: string[]): string[] {
  let name = '';
  let inFlows = false;
  return useCases.split(/\r?\n/).flatMap((line) => {
    if (line.startsWith('#')) {
      if (line.startsWith('## ')) name = /^## ユースケース: (.+)$/.exec(line)?.[1] ?? '';
      inFlows = line === '### 別の流れ';
      if (inFlows && name === '') problems.push(`ユースケースの見出しの下に無い別の流れの節: ${line}`);
      if (!inFlows && line.includes('別の流れ')) problems.push(`形の合わない別の流れの見出し: ${line}`);
      return [];
    }
    if (!inFlows) {
      if (/^\s*[-*] \*\*\d+[a-z]\*\*/.test(line)) problems.push(`別の流れの節の外にある別の流れの行: ${line}`);
      return [];
    }
    if (line === '') return [];
    const flow = /^- \*\*(\d+[a-z])\*\* /.exec(line);
    if (flow === null) problems.push(`形の合わない別の流れの行: ${line}`);
    return flow === null || name === '' ? [] : [`${name} ${flow[1]}`];
  });
}

/** 値か、その中の配列の要素とオブジェクトの値のどこかに null があるか。 */
function hasNull(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.some(hasNull);
  return isRecord(value) && Object.values(value).some(hasNull);
}

/** 用語集の語の名前から code を引く表。 */
function codesByName(): Map<string, string | undefined> {
  const terms = isRecord(glossary) && Array.isArray(glossary.terms) ? glossary.terms : [];
  return new Map(terms.filter(isRecord).map((term) => [String(term.name), typeof term.code === 'string' ? term.code : undefined]));
}

it('examples/problems/ の例は、どれも JSON として読め、最上位がオブジェクト', () => {
  const problems: string[] = [];
  for (const [name, result] of parsed) {
    if (result.error !== undefined) problems.push(`${name}: JSON として読めない (${result.error})`);
    else if (!isRecord(result.value)) problems.push(`${name}: 最上位がオブジェクトでない`);
  }
  expect(problems).toEqual([]);
});

it('問題の型の表の行はどれも決めた形で書かれ、例のファイルと 1 対 1 で、自前の型は /problems/ と kebab-case の相対 URI で重ならず、about:blank の題はステータスコードの名前', () => {
  const problems = [...typeShape];
  const listed = typeRows.map((row) => row.example);
  for (const name of listed.filter((name, index) => listed.indexOf(name) !== index)) problems.push(`例 ${name} が表に 2 回以上ある`);
  for (const name of listed.filter((name) => !exampleFiles.includes(name))) problems.push(`例 ${name} が examples/problems/ に無い`);
  for (const name of exampleFiles.filter((name) => !listed.includes(name))) problems.push(`examples/problems/${name} が表に無い`);
  const ownTypes = typeRows.filter((row) => row.type !== 'about:blank').map((row) => row.type);
  for (const type of ownTypes.filter((type, index) => ownTypes.indexOf(type) !== index)) problems.push(`型 ${type} が 2 回以上ある`);
  for (const type of ownTypes.filter((type) => !/^\/problems\/[a-z]+(-[a-z]+)*$/.test(type))) problems.push(`型 ${type} が /problems/ と kebab-case の相対 URI でない`);
  for (const row of typeRows.filter((row) => row.type === 'about:blank')) {
    if (statusNames[row.status] === undefined) problems.push(`about:blank の ${row.status}: ステータスコードの名前がテストの表に無い`);
    else if (row.title !== statusNames[row.status]) problems.push(`about:blank の ${row.status}: 題 ${row.title} が ${statusNames[row.status]} でない`);
  }
  expect(problems).toEqual([]);
});

it('例の type・title・status は表の行と同じで、例は行の拡張メンバーをすべて持ち、ほかには RFC 9457 の type・title・status・detail だけを持ち、null が無い', () => {
  const problems: string[] = [];
  for (const row of typeRows) {
    const example = examples.get(row.example);
    if (!isRecord(example)) continue;
    const where = row.example;
    if (example.type !== row.type) problems.push(`${where}: type が ${JSON.stringify(example.type)} で、表の ${row.type} と違う`);
    if (example.title !== row.title) problems.push(`${where}: title が ${JSON.stringify(example.title)} で、表の ${row.title} と違う`);
    if (example.status !== row.status) problems.push(`${where}: status が ${JSON.stringify(example.status)} で、表の ${row.status} と違う`);
    const keys = Object.keys(example);
    for (const key of keys.filter((key) => !standardMembers.includes(key) && !row.members.includes(key))) problems.push(`${where}: 表に無いメンバー ${key}`);
    for (const member of row.members.filter((member) => !keys.includes(member))) problems.push(`${where}: 拡張メンバー ${member} が無い`);
    if (hasNull(example)) problems.push(`${where}: null がある`);
  }
  expect(problems).toEqual([]);
});

/*
 * 語のある拡張メンバーの名前は、表現の決まりのキーの節の箇条に従う。配列のメンバーは要素の語の複数形の英語にするので、
 * test/representation.test.ts と同じく code とは照らさず、語が用語集にあることだけを確かめる。
 */
it('拡張メンバーの表の行はどれも決めた形で書かれ、問題の型の表の拡張メンバーはこの表にあり、語は用語集にあり、配列でないメンバーの名前は語の code と同じ', () => {
  const problems = [...memberShape];
  const members = memberRows.map((row) => row.member);
  for (const member of new Set(typeRows.flatMap((row) => row.members))) {
    if (!members.includes(member)) problems.push(`${member}: 拡張メンバーの表に無い`);
  }
  const codes = codesByName();
  for (const row of memberRows.filter((row) => row.term !== 'なし')) {
    const code = codes.get(row.term);
    if (!codes.has(row.term)) problems.push(`${row.member}: 語「${row.term}」が用語集に無い`);
    else if (row.type.startsWith('配列')) continue;
    else if (code === undefined) problems.push(`${row.member}: 語「${row.term}」に code が無い`);
    else if (row.member !== code) problems.push(`${row.member}: 語「${row.term}」の code ${code} と違う`);
  }
  expect(problems).toEqual([]);
});

it('例の拡張メンバーの値は、そのメンバーの決まりに合い、拡張メンバーの表の行にはどれも値の確かめ方がある', () => {
  const problems: string[] = [];
  for (const row of memberRows) {
    if (memberChecks[row.member] === undefined) problems.push(`${row.member}: 値の確かめ方が無い`);
  }
  for (const row of typeRows) {
    const example = examples.get(row.example);
    if (!isRecord(example)) continue;
    for (const member of row.members) {
      const check = memberChecks[member];
      if (check !== undefined && member in example && !check(example[member])) problems.push(`${row.example} の ${member}: ${JSON.stringify(example[member])} が決まりに合わない`);
    }
  }
  expect(problems).toEqual([]);
});

it('失敗の一覧の行とユースケースの別の流れの行はどれも決めた形で書かれ、別の流れはどれも失敗の一覧にちょうど 1 回あり、一覧の型とステータスコードの組は問題の型の表にあり、表の型はどれも一覧で使う', () => {
  const problems = [...failureShape];
  const flows = alternateFlows(problems);
  if (flows.length === 0) problems.push('use-cases.md に別の流れが無い');
  for (const flow of flows.filter((flow, index) => flows.indexOf(flow) !== index)) problems.push(`${flow}: use-cases.md に 2 回以上ある`);
  const listed = failureRows.map((row) => row.useCase).filter((useCase) => useCase !== 'なし');
  for (const flow of flows) {
    const count = listed.filter((useCase) => useCase === flow).length;
    if (count !== 1) problems.push(`${flow}: 失敗の一覧に ${count} 回ある`);
  }
  for (const useCase of listed.filter((useCase) => !flows.includes(useCase))) problems.push(`${useCase}: use-cases.md の別の流れに無い`);
  const pairs = typeRows.map((row) => `${row.type} ${row.status}`);
  const used = failureRows.map((row) => `${row.type} ${row.status}`);
  for (const pair of used.filter((pair) => !pairs.includes(pair))) problems.push(`失敗の一覧の ${pair}: 問題の型の表に無い`);
  for (const pair of pairs.filter((pair) => !used.includes(pair))) problems.push(`問題の型の表の ${pair}: 失敗の一覧で使っていない`);
  expect(problems).toEqual([]);
});
