/*
 * lint の落ちる例 (test/fixtures/lint/) を規則の名前と結び、Redocly CLI の lint を 1 ファイルずつ回す処理。
 * 落ちる例は、当たる規則の名前の / を - にしたディレクトリに、変えた所の名前の YAML のファイルで置く
 * (rule/created-has-location → rule-created-has-location/no-headers.yaml)。規則が見る場所と、規則の assertion ごとに 1 つ置く。
 */
import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRedocly } from './redocly.ts';

export const fixtureDir = 'test/fixtures/lint';

/** どの規則にも当たらない土台。落ちる例は、これの 1 か所 (1 つの応答・スキーマ・値) だけを変えたもの。 */
export const baseFixture = 'valid.yaml';

/** ドットで始まる名前 (エディタや OS が置く隠しファイル。`._no-headers.yaml`・`.#no-headers.yaml` など) は、拡張子が YAML でも読まない。 */
function visible(dir: string): Dirent[] {
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
}

/**
 * 落ちる例 (fixtureDir からのパス) と、それが当たるはずの規則の名前。
 * 読まないもの (規則のディレクトリの外のファイル・YAML でないファイル・規則のディレクトリの下のディレクトリ) があれば例外にする。
 * どの規則とも結ばれないまま、回されずに通るため。
 */
export function lintFixtures(root = fileURLToPath(new URL('../fixtures/lint/', import.meta.url))): { file: string; rule: string }[] {
  const entries = visible(root);
  const stray = entries.filter((entry) => !entry.isDirectory() && entry.name !== baseFixture).map((entry) => entry.name);
  if (stray.length > 0) throw new Error(`規則のディレクトリの外にファイルがある: ${stray.join(', ')}`);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((dir) => {
      const rule = dir.startsWith('rule-') ? `rule/${dir.slice('rule-'.length)}` : dir;
      const files = visible(join(root, dir));
      const unread = files.filter((entry) => !entry.isFile() || !/\.ya?ml$/.test(entry.name)).map((entry) => `${dir}/${entry.name}`);
      if (unread.length > 0) throw new Error(`落ちる例として読まないものがある (YAML のファイルだけを置く): ${unread.join(', ')}`);
      return files
        .map((entry) => entry.name)
        .sort()
        .map((file) => ({ file: `${dir}/${file}`, rule }));
    });
}

/*
 * 1 つのファイルを redocly.yaml の規則で lint し、終了コードと、指摘のあった規則の名前 (重ねない) を返す。
 * 複数のファイルを 1 回で渡すと JSON の文書がファイルの数だけ続いて出るので、1 ファイルずつ回す。
 */
export function lintFile(path: string): { status: number | null; rules: string[] } {
  const result = runRedocly(['lint', path, '--format=json', '--lint-config=error']);
  let report: { problems: { ruleId: string }[] };
  try {
    report = JSON.parse(result.stdout) as { problems: { ruleId: string }[] };
  } catch {
    // 設定の誤りでは JSON を出さず、理由を stderr に書いて止まるので、理由を失敗の文に載せる。
    throw new Error(`${path} の lint の出力が JSON でない (終了コード ${result.status})。stderr:\n${result.stderr}`);
  }
  return { status: result.status, rules: [...new Set(report.problems.map((problem) => problem.ruleId))].sort() };
}
