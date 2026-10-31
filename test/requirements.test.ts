/*
 * 受け入れ条件の文書 (docs/requirements/stories.md) と、受け入れ条件のテスト (acceptance.test.ts) の名前がそろっていることを確かめる。
 * 片方だけを直すと、文書とテストが別の受け入れ条件を指すようになるため。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const stories = readFileSync(fileURLToPath(new URL('../docs/requirements/stories.md', import.meta.url)), 'utf8');
const acceptanceTests = readFileSync(fileURLToPath(new URL('./acceptance.test.ts', import.meta.url)), 'utf8');

/** 「ストーリーの名前 > 受け入れ条件の見出しの文」を、書いた順に返す。 */
function criteriaInStories(markdown: string): string[] {
  const result: string[] = [];
  let story = '';
  for (const match of markdown.matchAll(/^## ストーリー: (.+)$|^### 受け入れ条件: (.+)$/gm)) {
    if (match[1] !== undefined) story = match[1];
    else result.push(`${story} > ${match[2]}`);
  }
  return result;
}

/** 「describe の名前 > テストの名前」を、書いた順に返す。 */
function namesInTests(source: string): string[] {
  const result: string[] = [];
  let suite = '';
  for (const match of source.matchAll(/\bdescribe\('([^']+)'|\bit(?:\.todo)?\('([^']+)'/g)) {
    if (match[1] !== undefined) suite = match[1];
    else result.push(`${suite} > ${match[2]}`);
  }
  return result;
}

it('受け入れ条件の文書とテストが、同じストーリーの同じ受け入れ条件を同じ順に持つ', () => {
  const criteria = criteriaInStories(stories);
  expect(criteria.length).toBeGreaterThan(0);
  expect(namesInTests(acceptanceTests)).toEqual(criteria);
});
