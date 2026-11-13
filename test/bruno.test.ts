/*
 * Bruno のコレクション (bruno/) が、受け入れ条件の文書 (docs/requirements/stories.md) と、
 * 始めるための手順 (docs/getting-started.md) の「受け入れ条件とモック」の表にそろっていることを確かめる。
 * 受け入れ条件は、モックで確かめるもの (Bruno のリクエストがある) と、モックで確かめられないもの (表に理由がある) に分ける。
 * どちらにも入らない受け入れ条件があると、確かめたつもりで抜けるため。
 * 例を返すモックへ実際にリクエストを送って assert が通ることは、記事の例 (snippets の bru run) が確かめる。
 * 値を作るモックへ送ると落ちることは、記事の例は終了コードだけを見るので、落ちた理由をこのファイルの最後の it が確かめる。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { isRecord } from './support/openapi.ts';
import { readServersFile, runCommand, startServer, stopServer } from './support/snippets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const stories = readFileSync(join(root, 'docs/requirements/stories.md'), 'utf8');
const gettingStarted = readFileSync(join(root, 'docs/getting-started.md'), 'utf8');

/** 受け入れ条件の見出しの文と、それを持つストーリーの名前を、書いた順に返す。 */
function criteria(): { story: string; name: string }[] {
  const result: { story: string; name: string }[] = [];
  let story = '';
  for (const match of stories.matchAll(/^## ストーリー: (.+)$|^### 受け入れ条件: (.+)$/gm)) {
    if (match[1] !== undefined) story = match[1];
    else result.push({ story, name: match[2] });
  }
  return result;
}

/** getting-started.md の見出し (## <見出し>) の下にある表の、見出しの行と区切りの行を除いた行を、セルの配列で返す。 */
function tableRows(heading: string): string[][] {
  const start = gettingStarted.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`docs/getting-started.md に「${heading}」の見出しが無い`);
  const next = gettingStarted.indexOf('\n## ', start + 1);
  const section = gettingStarted.slice(start, next === -1 ? undefined : next);
  return section
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .slice(2)
    .map((line) => line.slice(2, -2).split(' | '));
}

interface Request {
  path: string;
  folder: string;
  name: string;
  assertions: { expression: string; operator: string; value: string }[];
}

/** bruno/ のフォルダごとの、リクエストのファイル (folder.yml を除く .yml) を読む。 */
function requests(): Request[] {
  const dir = join(root, 'bruno');
  const result: Request[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'environments') continue;
    const folder: unknown = parse(readFileSync(join(dir, entry.name, 'folder.yml'), 'utf8'));
    const folderName = isRecord(folder) && isRecord(folder.info) ? String(folder.info.name) : '';
    for (const file of readdirSync(join(dir, entry.name)).filter((f) => f.endsWith('.yml') && f !== 'folder.yml')) {
      const path = `bruno/${entry.name}/${file}`;
      const request: unknown = parse(readFileSync(join(root, path), 'utf8'));
      if (!isRecord(request) || !isRecord(request.info) || request.info.type !== 'http') {
        throw new Error(`${path} が、Bruno の HTTP のリクエストの形でない`);
      }
      const runtime = isRecord(request.runtime) ? request.runtime : {};
      const assertions = Array.isArray(runtime.assertions) ? runtime.assertions : [];
      result.push({ path, folder: folderName, name: String(request.info.name), assertions });
    }
  }
  return result;
}

const rows = tableRows('受け入れ条件とモック');

it('表の行が、受け入れ条件と同じものを同じ順に持ち、どの行にもモックで確かめられないことが書いてある', () => {
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.map((row) => row[0])).toEqual(criteria().map((c) => c.name));
  for (const row of rows) expect(row[2], row[0]).toMatch(/\S/);
});

it('表が指すリクエストは、その受け入れ条件の名前を持ち、そのストーリーのフォルダにある', () => {
  const byPath = new Map(requests().map((r) => [r.path, r]));
  const storyOf = new Map(criteria().map((c) => [c.name, c.story]));
  for (const [name, cell] of rows) {
    if (cell === '—') continue;
    const path = cell.replace(/^`|`$/g, '');
    const request = byPath.get(path);
    expect(request, `${name} の ${path}`).toBeDefined();
    expect(request?.name).toBe(name);
    expect(request?.folder).toBe(storyOf.get(name));
  }
});

it('コレクションのリクエストは、どれも表から指されている', () => {
  const found = requests().map((r) => r.path);
  expect(found.length).toBeGreaterThan(0);
  const pointed = rows.filter((row) => row[1] !== '—').map((row) => row[1].replace(/^`|`$/g, ''));
  expect(found.sort()).toEqual(pointed.sort());
});

it('どのリクエストも、ステータスコードを確かめる assert を持つ', () => {
  for (const request of requests()) {
    expect(
      request.assertions.some((a) => a.expression === 'res.status' && a.operator === 'eq' && /^\d{3}$/.test(String(a.value))),
      request.path,
    ).toBe(true);
  }
});

it('例の商品 ID の表の商品 ID が、仕様の例のもとの JSON (examples/) にある', () => {
  const ids = tableRows('例の商品 ID').map((row) => row[1].replace(/^`|`$/g, ''));
  expect(ids.length).toBe(3);
  const examples = ['orders', 'problems']
    .flatMap((dir) => readdirSync(join(root, 'examples', dir)).map((f) => join(root, 'examples', dir, f)))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  for (const id of ids) expect(examples, id).toContain(`"${id}"`);
});

it('例の商品 ID の表の商品は、受け入れ条件の前提の価格と税率で、注文の例の同じ商品 ID の注文明細にある', () => {
  // 前提の表 (stories.md) の価格と税率を、注文の例の注文明細の単価と税率と照らす。商品 ID を入れ替えると、単価が食い違う。
  const premises = new Map(
    [...stories.matchAll(/^\| (\S+) \| ([\d,]+) 円 \| (\d+)% [^|]*\| \d+ \|$/gm)].map((m) => [m[1], { unitPrice: Number(m[2].replaceAll(',', '')), taxRate: Number(m[3]) }]),
  );
  const order = JSON.parse(readFileSync(join(root, 'examples/orders/order.json'), 'utf8')) as { lines: { productId: string; unitPrice: number; taxRate: number }[] };
  const rows = tableRows('例の商品 ID')
    .map(([name, id]) => ({ name, id: id.replace(/^`|`$/g, '') }))
    .filter((row) => premises.has(row.name));
  expect(rows.map((row) => row.name).sort()).toEqual([...premises.keys()].sort());
  for (const { name, id } of rows) {
    const line = order.lines.find((l) => l.productId === id);
    expect(line && { unitPrice: line.unitPrice, taxRate: line.taxRate }, `${name} (${id})`).toEqual(premises.get(name));
  }
});

it('Bruno の環境の baseUrl は、記事の例を返すモック (servers.json の ch13-mock) のポートを指す', () => {
  const env: unknown = parse(readFileSync(join(root, 'bruno/environments/mock.yml'), 'utf8'));
  const variables = isRecord(env) && Array.isArray(env.variables) ? env.variables.filter(isRecord) : [];
  const baseUrl = variables.find((variable) => variable.name === 'baseUrl')?.value;
  expect(typeof baseUrl, 'mock.yml の baseUrl').toBe('string');
  const mock = readServersFile(join(root, 'test/snippets')).servers['ch13-mock'];
  expect(Number(new URL(String(baseUrl)).port)).toBe(mock.port);
});

it('値を作るモックへのコレクションは、送り先に届いた上で、assert の外れで落ちる (記事の ch13-21)', async () => {
  // 記事の例は終了コード 1 だけを見るので、送り先を誤って接続を断られても 1 で通る。ここで落ちた理由を見分ける。
  const name = 'ch13-mock-dynamic';
  const dir = join(root, 'test/snippets');
  const server = await startServer(name, readServersFile(dir).servers[name], readFileSync(join(dir, `${name}.server`), 'utf8'), root);
  try {
    const { output, status } = runCommand(readFileSync(join(dir, 'ch13-21-bruno-dynamic.cmd'), 'utf8'), root);
    expect(status).toBe(1);
    expect(output, 'どのリクエストも送り先に届く').not.toContain('ECONNREFUSED');
    expect(output, 'assert の外れがある').toContain('✕');
  } finally {
    await stopServer(server);
  }
}, 120_000);
