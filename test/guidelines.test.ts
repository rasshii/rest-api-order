/*
 * API の設計のガイドライン (docs/api-design/guidelines.md) の守り方の列が、実際に働く守りを指していることを確かめる。
 * 規則やテストの名前を変えたり消したりしても、ガイドラインの表は文書なので古いまま残り、守っていない規約を守っていると読めるため。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { lintFixtures } from './support/lint.ts';

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

const header = '| 規約 | 決めた文書 | 守り方 |';

/** ガイドラインの表の守り方の列。表の見出しの次の区切りの行から空行の前までの行の、最後の列を返す。 */
function protectionCells(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const cells: string[] = [];
  lines.forEach((line, index) => {
    if (line !== header) return;
    for (const row of lines.slice(index + 2)) {
      if (row.trim() === '') break;
      const columns = row.split(' | ');
      cells.push(columns[columns.length - 1].replace(/ \|$/, ''));
    }
  });
  return cells;
}

/*
 * 守り方の 1 つずつの形。どれにも合わない書き方は誤りにする
 * (綴りを崩した守り方が、照らされないまま守っていると読めるため)。
 */
const lintPattern = /^lint: `([^`]+)`$/;
const testPattern = /^テスト: `([^`]+)` の「([^」]+)」$/;

const cells = protectionCells(read('docs/api-design/guidelines.md'));
const parts = cells.flatMap((cell) => cell.split(' / '));

it('ガイドラインの守り方は、どれも lint・テスト・人が見るの形で書かれている', () => {
  expect(cells.length).toBeGreaterThan(0);
  expect(parts.filter((part) => !lintPattern.test(part) && !testPattern.test(part) && part !== '人が見る')).toEqual([]);
});

it('ガイドラインの lint の規則と、落ちる例を置いた規則が 1 対 1', () => {
  const named = parts.flatMap((part) => lintPattern.exec(part)?.[1] ?? []).sort();
  expect(named.length).toBeGreaterThan(0);
  expect(new Set(named).size, 'ガイドラインで同じ規則を 2 度挙げていない').toBe(named.length);
  expect(named).toEqual([...new Set(lintFixtures().map((fixture) => fixture.rule))].sort());
});

it('ガイドラインのテストは、そのファイルに同じ名前の it がある', () => {
  const tests = parts.flatMap((part) => {
    const match = testPattern.exec(part);
    return match === null ? [] : [{ file: match[1], name: match[2] }];
  });
  expect(tests.length).toBeGreaterThan(0);
  const missing = tests.filter(({ file, name }) => {
    const path = fileURLToPath(new URL(`../${file}`, import.meta.url));
    return !existsSync(path) || !readFileSync(path, 'utf8').includes(`it('${name}'`);
  });
  expect(missing).toEqual([]);
});
