/*
 * snippets のテストが使う、実行と比較の処理のテスト。試しのファイル (test/fixtures/) で、正しい入力で通ることと、
 * 期待と違う入力で落ちること (違いを返すこと) の両方を確かめる。
 * 試しのファイルを test/snippets/ に置かないのは、記事のどの例にも当たらないファイルとして、
 * ガイドの側の照合が失敗にするため。
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { normalizeOutput } from './support/replacements.ts';
import {
  assertAlive,
  assertPortFree,
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

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/snippets/', import.meta.url));
const noServersJson = fileURLToPath(new URL('./fixtures/no-servers-json/', import.meta.url));
const port = 4599;

describe('列挙と数え方', () => {
  it('.curl と .cmd を、種類を付けてファイル名の順に返す', () => {
    expect(listSnippets(fixtures).map((s) => `${s.kind}:${s.name}`)).toEqual(['request:ch00-get', 'command:ch00-list']);
  });

  it('find で数えた数が、列挙の数と一致する', () => {
    expect(countWithFind(fixtures)).toBe(listSnippets(fixtures).length);
    expect(countWithFind(fixtures)).toBe(2);
  });

  it('servers.json の無いディレクトリは、読むと例外になる', () => {
    expect(() => readServersFile(noServersJson)).toThrow();
  });
});

describe('servers.json の検査', () => {
  it('試しのファイルには食い違いが無い', () => {
    expect(findServersFileProblems(fixtures, readServersFile(fixtures))).toEqual([]);
  });

  it('.server の無い名前・.cmd の無い command・重なるポートを返す', () => {
    const file = readServersFile(fixtures);
    file.servers['ch00-ghost'] = { port, ready: { http: '/' } };
    file.commands['ch00-missing'] = [];
    expect(findServersFileProblems(fixtures, file)).toEqual([
      'servers.json の ch00-ghost に ch00-ghost.server が無い',
      'servers.json の commands の ch00-missing に ch00-missing.cmd が無い',
      `servers.json のポートが重なる: ${port}`,
    ]);
  });
});

describe('出力のそろえ方', () => {
  it('CRLF を LF にし、Date ヘッダの値を固定の値にする', () => {
    const actual = 'HTTP/1.1 200 OK\r\nDate: Mon, 02 Nov 2026 12:34:56 GMT\r\nX-Date: Mon, 02 Nov 2026 12:34:56 GMT\r\n';
    expect(normalizeOutput(actual)).toBe(
      'HTTP/1.1 200 OK\nDate: Sat, 31 Oct 2026 09:00:00 GMT\nX-Date: Mon, 02 Nov 2026 12:34:56 GMT\n',
    );
  });

  it('形の違う Date の行は置き換えない', () => {
    expect(normalizeOutput('Date: yesterday\n')).toBe('Date: yesterday\n');
  });

  it('最後の空でない行をステータスコードとして読む', () => {
    expect(lastLine('{"orderId":"1"}\n201\n')).toBe('201');
    expect(lastLine('{"orderId":"1"}\n201\n')).not.toBe('200');
  });

  it('curl が接続するポートを読む', () => {
    expect(portsOfCurl("curl -s -w '\\n%{http_code}\\n' http://localhost:4010/orders")).toEqual([4010]);
  });
});

describe('コマンドの実行', () => {
  it('標準出力と標準エラー出力を出た順にまとめ、終了コードを返す', () => {
    const command = readFileSync(`${fixtures}ch00-list.cmd`, 'utf8');
    expect(runCommand(command, root)).toEqual({ output: 'out\nerr\n', status: 3 });
  });

  it('末尾に改行が無いコマンドも同じ結果になる', () => {
    expect(runCommand('echo out\necho err >&2\nexit 3', root)).toEqual({ output: 'out\nerr\n', status: 3 });
  });
});

describe('サーバーとポート', () => {
  it('使われているポートでは assertPortFree が例外になり、空けば通る', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, resolve));
    await expect(assertPortFree(port)).rejects.toThrow(`ポート ${port} が使われている`);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  it('ポートが使われていれば、サーバーを起動しない', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, resolve));
    try {
      await expect(startServer('ch00-web', { port, ready: { http: '/' } }, `node test/fixtures/server.ts ${port}`, root)).rejects.toThrow(
        `ポート ${port} が使われている`,
      );
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it('孫のプロセスで動くサーバーを起動して呼べ、止めるとポートが空く', async () => {
    // bash の下の sh の下で node が動く。プロセスグループで止めないと node が残る。
    const server = await startServer('ch00-web', { port, ready: { http: '/' } }, `sh -c 'node test/fixtures/server.ts ${port}'`, root);
    try {
      const result = runCurl(readFileSync(`${fixtures}ch00-get.curl`, 'utf8'), root);
      expect(normalizeOutput(result.stdout)).toBe(readFileSync(`${fixtures}ch00-get.out`, 'utf8'));
      expect(lastLine(result.stdout)).toBe('200');
    } finally {
      await stopServer(server);
    }
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  it('起動した子が終わっていれば、assertAlive が例外になる', async () => {
    const server = await startServer('ch00-web', { port, ready: { http: '/' } }, `node test/fixtures/server.ts ${port}`, root);
    try {
      assertAlive(server);
      if (server.child.pid !== undefined) process.kill(-server.child.pid, 'SIGTERM');
      for (let i = 0; i < 50 && !server.exited; i++) await sleep(100);
      expect(() => assertAlive(server)).toThrow('サーバー ch00-web が終わっている');
    } finally {
      await stopServer(server);
    }
  });
});
