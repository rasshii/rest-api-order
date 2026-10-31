/*
 * 記事に載せた curl とコマンドを実行し、出力を test/snippets/ の期待値と比べる。
 * 記事の側の照合 (記事のフェンスと、このディレクトリのファイルが同じ中身か) は、ガイドの書き手の側のスクリプトが行う。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { normalizeOutput } from './support/replacements.ts';
import {
  assertAlive,
  countWithFind,
  findServersFileProblems,
  lastLine,
  listSnippets,
  portsOfCurl,
  readServersFile,
  runCommand,
  runCurl,
  startServer,
  stopServer,
} from './support/snippets.ts';
import type { RunningServer } from './support/snippets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = fileURLToPath(new URL('./snippets/', import.meta.url));
const servers = readServersFile(dir);
const snippets = listSnippets(dir);
const ran = new Set<string>();
const started = new Set<string>();

/** 例が使うサーバーの名前。curl は URL のポートで、command は servers.json の commands で決める。 */
function serversFor(name: string, kind: 'request' | 'command', content: string): string[] {
  if (kind === 'command') return servers.commands[name] ?? [];
  return portsOfCurl(content).map((port) => {
    const found = Object.entries(servers.servers).find(([, spec]) => spec.port === port);
    if (found === undefined) throw new Error(`${name} が接続するポート ${port} のサーバーが servers.json に無い`);
    return found[0];
  });
}

/*
 * サーバーは章ごとに 1 回だけ起動し、その章の例を記事の順に送る。読者は章の初めにサーバーを起動して記事の順に打つので、
 * 状態を変える例 (POST など) の後の結果は、前の例が変えた状態の上で出る。例ごとに起動し直すと、その結果が読者の手元と食い違う。
 * 記事の順は名前の順 (ch<章>-<順>-<内容>) で、listSnippets がその順に並べる。
 */
const running = new Map<string, RunningServer>();
let runningChapter = '';

async function stopAll(): Promise<void> {
  for (const server of running.values()) await stopServer(server);
  running.clear();
}

afterAll(stopAll);

/*
 * 例は describe で包まず、ファイルの直下に置く。Vitest は test が 0 件の describe を失敗にするので、
 * 例が 1 つも無い章の tag でも、このファイルが下の件数のテストだけで通るようにする。
 */
for (const snippet of snippets) {
  it(snippet.name, async () => {
    ran.add(snippet.name);
    const chapter = snippet.name.slice(0, 'chNN'.length);
    if (chapter !== runningChapter) {
      await stopAll();
      runningChapter = chapter;
    }
    const content = readFileSync(snippet.file, 'utf8');
    const outPath = join(dir, `${snippet.name}.out`);
    const used: RunningServer[] = [];
    for (const name of serversFor(snippet.name, snippet.kind, content)) {
      let server = running.get(name);
      if (server === undefined) {
        const command = readFileSync(join(dir, `${name}.server`), 'utf8');
        server = await startServer(name, servers.servers[name], command, root);
        running.set(name, server);
        started.add(name);
      }
      used.push(server);
    }

    if (snippet.kind === 'request') {
      const statusPath = join(dir, `${snippet.name}.status`);
      const hasOut = existsSync(outPath);
      const hasStatus = existsSync(statusPath);
      if (hasOut === hasStatus) {
        throw new Error(`${snippet.name} は .out と .status のどちらか 1 つを置く (今は ${hasOut ? '両方ある' : 'どちらも無い'})`);
      }
      const result = runCurl(content, root);
      expect(result.status, 'curl の終了コード').toBe(0);
      const stdout = normalizeOutput(result.stdout);
      if (hasStatus) {
        expect(lastLine(stdout)).toBe(readFileSync(statusPath, 'utf8').trim());
      } else {
        await expect(stdout).toMatchFileSnapshot(outPath);
      }
    } else {
      const exitPath = join(dir, `${snippet.name}.exit`);
      const expectedExit = existsSync(exitPath) ? Number(readFileSync(exitPath, 'utf8').trim()) : 0;
      const result = runCommand(content, root);
      expect(result.status, `${snippet.name} の終了コード\n${result.output}`).toBe(expectedExit);
      if (existsSync(outPath)) {
        await expect(normalizeOutput(result.output)).toMatchFileSnapshot(outPath);
      }
    }

    for (const server of used) assertAlive(server);
  });
}

it('snippets のファイルをすべて走らせ、すべてのサーバーを起動した', () => {
  expect(existsSync(join(dir, 'servers.json')), 'test/snippets/servers.json が無い').toBe(true);
  expect(findServersFileProblems(dir, servers)).toEqual([]);
  expect(ran.size).toBe(countWithFind(dir));
  expect([...started].sort()).toEqual(Object.keys(servers.servers).sort());
});
