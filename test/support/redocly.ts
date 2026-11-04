/*
 * Redocly CLI を、テストを動かしている Node.js で子のプロセスとして呼ぶ処理。
 * npx を通さないのは、テストの環境に npm の告知や PATH の違いを持ち込まないため。
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** リポジトリの root。仕様と redocly.yaml の相対パスは、ここから解決する。 */
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const cli = createRequire(import.meta.url).resolve('@redocly/cli/bin/cli.js');

export interface RedoclyResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** redocly <args> を repoRoot で回し、終了コードと出力を返す。 */
export function runRedocly(args: string[]): RedoclyResult {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
