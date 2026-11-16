/*
 * redocly.yaml の規則が、規則ごとに作った落ちる例でその規則だけを報告し、土台の仕様には何も報告しないことを確かめる。
 * 規則の書き方を誤っても (where の祖先の型・どこにも当たらない親のキーの絞り・狭い正規表現)、設定として正しい形なら
 * --lint-config=error でも止まらず、その規則は当たるべき場所に当たらないまま lint が通るので、
 * 仕様の lint が通ることだけでは、規則が働いている証にならないため。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { baseFixture, fixtureDir, lintFile, lintFixtures } from './support/lint.ts';

const fixtures = lintFixtures();

describe('落ちる例の読み方', () => {
  /** 一時のディレクトリに files (パスと中身) を置いて、lintFixtures で読む。 */
  function listed(files: string[]): () => { file: string; rule: string }[] {
    const root = mkdtempSync(join(tmpdir(), 'lint-fixtures-'));
    for (const file of files) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      if (!file.endsWith('/')) writeFileSync(join(root, file), '');
    }
    return () => {
      try {
        return lintFixtures(root);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
  }

  it('規則のディレクトリの YAML のファイルを規則と結び、ドットで始まる名前は読まない', () => {
    const read = listed([baseFixture, '.DS_Store', 'rule-a/x.yaml', 'rule-a/._x.yaml', 'rule-a/.#x.yaml', 'b/y.yml']);
    expect(read()).toEqual([
      { file: 'b/y.yml', rule: 'b' },
      { file: 'rule-a/x.yaml', rule: 'rule/a' },
    ]);
  });

  it('規則のディレクトリの外のファイル・YAML でないファイル・規則のディレクトリの下のディレクトリは、例外にする', () => {
    expect(listed([baseFixture, 'stray.yaml'])).toThrow('規則のディレクトリの外にファイルがある: stray.yaml');
    expect(listed([baseFixture, 'rule-a/x.json'])).toThrow('rule-a/x.json');
    expect(listed([baseFixture, 'rule-a/sub/x.yaml'])).toThrow('rule-a/sub');
  });
});

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
