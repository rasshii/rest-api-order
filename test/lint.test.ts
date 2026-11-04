/*
 * redocly.yaml の規則が、規則ごとに作った落ちる例でその規則だけを報告し、土台の仕様には何も報告しないことを確かめる。
 * 規則の書き方を誤っても (where の祖先の型・どこにも当たらない親のキーの絞り・狭い正規表現)、設定として正しい形なら
 * --lint-config=error でも止まらず、その規則は当たるべき場所に当たらないまま lint が通るので、
 * 仕様の lint が通ることだけでは、規則が働いている証にならないため。
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { baseFixture, fixtureDir, lintFile, lintFixtures } from './support/lint.ts';

const fixtures = lintFixtures();

it('土台の仕様は、どの規則にも当たらない', () => {
  expect(lintFile(`${fixtureDir}/${baseFixture}`)).toEqual({ status: 0, rules: [] });
});

it.each(fixtures)('落ちる例 $file は、$rule だけに当たって lint が落ちる', ({ file, rule }) => {
  expect(lintFile(`${fixtureDir}/${file}`)).toEqual({ status: 1, rules: [rule] });
});

it('redocly.yaml の自前の規則には、どれも落ちる例がある', () => {
  const config = parse(readFileSync(new URL('../redocly.yaml', import.meta.url), 'utf8')) as { rules?: Record<string, unknown> };
  const custom = Object.keys(config.rules ?? {}).filter((name) => name.startsWith('rule/')).sort();
  expect(custom.length).toBeGreaterThan(0);
  expect(custom.filter((name) => !fixtures.some((fixture) => fixture.rule === name))).toEqual([]);
});
