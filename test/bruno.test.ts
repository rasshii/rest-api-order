/*
 * Bruno のコレクション (bruno/) が、受け入れ条件の文書 (docs/requirements/stories.md) と、
 * 始めるための手順 (docs/getting-started.md) の「受け入れ条件とモック」の表にそろっていることを確かめる。
 * 受け入れ条件は、モックで確かめるもの (Bruno のリクエストがある) と、モックで確かめられないもの (表に理由がある) に分ける。
 * どちらにも入らない受け入れ条件があると、確かめたつもりで抜けるため。
 * モックへ実際にリクエストを送って assert が通ることは、記事の例 (snippets の bru run) が確かめる。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { isRecord } from './support/openapi.ts';

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
