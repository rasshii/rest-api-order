/*
 * snippets のテストが使う、実行と比較の処理のテスト。試しのファイル (test/fixtures/) で、正しい入力で通ることと、
 * 期待と違う入力で落ちること (違いを返すこと) の両方を確かめる。
 * 試しのファイルを test/snippets/ に置かないのは、記事のどの例にも当たらないファイルとして、
 * ガイドの側の照合が失敗にするため。
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSpec } from './support/openapi.ts';
import { normalizeOutput } from './support/replacements.ts';
import { parseCurlRequest, parseCurlResponse, responseChecker } from './support/response-schema.ts';
import type { RunningServer } from './support/snippets.ts';
import {
  assertAlive,
  assertPortFree,
  countWithFind,
  curlUserAgent,
  findServersFileProblems,
  lastLine,
  listSnippets,
  liveGroupMembers,
  portsOfCurl,
  signalGroup,
  readServersFile,
  runCommand,
  runCurl,
  startServer,
  stopServer,
  valueServerProblems,
} from './support/snippets.ts';

/** bash -c <script> を新しいプロセスグループで起こし、そのグループの ID (先頭の PID) を返す。 */
function spawnGroup(script: string): number {
  const child = spawn('bash', ['-c', script], { detached: true, stdio: 'ignore' });
  if (child.pid === undefined) throw new Error(`起動できない: ${script}`);
  return child.pid;
}

/** プロセスグループのメンバーの PID と、ps の状態。 */
function groupStates(pgid: number): { pid: number; stat: string }[] {
  return spawnSync('ps', ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8' })
    .stdout.split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([, group, stat]) => Number(group) === pgid && stat !== undefined)
    .map(([pid, , stat]) => ({ pid: Number(pid), stat }));
}

/** イベントループに戻らずに、条件が成り立つまで (最長 timeoutMs) 待つ。Node が子を回収しないように、同期で待つ。 */
function waitSync(condition: () => boolean, timeoutMs = 5_000): boolean {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    Atomics.wait(cell, 0, 0, 50);
  }
  return true;
}

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

describe('値を作るサーバーの印 (servers.json の spec)', () => {
  const scripts = {
    mock: 'npm run bundle && prism mock dist/openapi.yaml --port 3904',
    'mock:dynamic': 'npm run bundle && prism mock dist/openapi.yaml --port 3905 --dynamic',
  };
  const file = (specOfStatic?: string, specOfDynamic?: string) => ({
    servers: {
      'ch00-mock': { port: 4590, ready: { http: '/' }, spec: specOfStatic },
      'ch00-mock-dynamic': { port: 4591, ready: { http: '/' }, spec: specOfDynamic },
    },
    commands: {},
  });
  const commandOf = (name: string) => (name === 'ch00-mock' ? 'npm run mock\n' : 'npm run mock:dynamic\n');

  it('--dynamic で起動するサーバーにだけ spec があれば、食い違いは無い', () => {
    expect(valueServerProblems(file(undefined, 'openapi/openapi.yaml'), commandOf, scripts)).toEqual([]);
  });

  it('値を作るサーバーの spec の書き忘れと、例を返すサーバーの spec を返す', () => {
    expect(valueServerProblems(file('openapi/openapi.yaml', undefined), commandOf, scripts)).toEqual([
      'ch00-mock は値を作るモックでないのに、servers.json に spec がある',
      'ch00-mock-dynamic は値を作るモックなのに、servers.json に spec が無い',
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

  it('Redocly CLI の lint と bundle の所要時間を、数でも <test> でも固定の値にし、行の形が違えば置き換えない', () => {
    const actual = [
      'openapi/openapi.yaml: validated in 48ms',
      'openapi/openapi.yaml: validated in <test>ms',
      '📦 Created a bundle for openapi/openapi.yaml at dist/openapi.yaml 7ms.',
      '📦 Created a bundle for openapi/openapi.yaml at dist/openapi.yaml <test>ms.',
      'validated in 48ms',
      '📦 Created a bundle for openapi/openapi.yaml 7ms.',
    ].join('\n');
    expect(normalizeOutput(actual)).toBe(
      [
        'openapi/openapi.yaml: validated in 35ms',
        'openapi/openapi.yaml: validated in 35ms',
        '📦 Created a bundle for openapi/openapi.yaml at dist/openapi.yaml 12ms.',
        '📦 Created a bundle for openapi/openapi.yaml at dist/openapi.yaml 12ms.',
        'validated in 48ms',
        '📦 Created a bundle for openapi/openapi.yaml 7ms.',
      ].join('\n'),
    );
  });

  it('Bruno CLI のリクエストごとの所要時間と、表の Duration の値を固定の値にし、行の形が違えば置き換えない', () => {
    const actual = [
      'place-order/accepted (201 Created) - 12 ms',
      'get-order/accepted-order (200 OK) - 1 ms',
      '│ Duration (ms) │     163      │',
      '│ Duration (ms) │     1042     │',
      'place-order/accepted (201 Created) - 12 seconds',
      '│ Requests      │ 6 (6 Passed) │',
    ].join('\n');
    expect(normalizeOutput(actual)).toBe(
      [
        'place-order/accepted (201 Created) - 3 ms',
        'get-order/accepted-order (200 OK) - 3 ms',
        '│ Duration (ms) │      80      │',
        '│ Duration (ms) │      80      │',
        'place-order/accepted (201 Created) - 12 seconds',
        '│ Requests      │ 6 (6 Passed) │',
      ].join('\n'),
    );
  });

  it('最後の空でない行をステータスコードとして読む', () => {
    expect(lastLine('{"orderId":"1"}\n201\n')).toBe('201');
    expect(lastLine('{"orderId":"1"}\n201\n')).not.toBe('200');
  });

  it('curl が接続するポートを読む', () => {
    expect(portsOfCurl("curl -s -w '\\n%{http_code}\\n' http://localhost:4010/orders")).toEqual([4010]);
  });

  it('ヘッダの値の中の URL のポートは、接続するポートに数えない', () => {
    const preflight = "curl -s -i -X OPTIONS http://127.0.0.1:3904/orders \\\n  -H 'Origin: http://localhost:3903'";
    expect(portsOfCurl(preflight)).toEqual([3904]);
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

  it('FORCE_COLOR を引き継がず、NO_COLOR を渡す (Bruno CLI は FORCE_COLOR を NO_COLOR より優先する)', () => {
    vi.stubEnv('FORCE_COLOR', '1');
    try {
      expect(runCommand('echo "[$FORCE_COLOR][$NO_COLOR]"', root)).toEqual({ output: '[][1]\n', status: 0 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('GitHub Actions の環境変数があっても、Redocly CLI の出力に色の符号が付かない', () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    try {
      const { output, status } = runCommand('npx redocly lint test/fixtures/lint/valid.yaml', root);
      expect(status).toBe(0);
      expect(output).toContain('validating test/fixtures/lint/valid.yaml...');
      expect(output.includes('\u001b[')).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('127.0.0.1 だけで待ち受けるサーバーがあっても、ポートが使われているとみなす', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve));
    try {
      await expect(assertPortFree(port)).rejects.toThrow(`ポート ${port} が使われている`);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  it('::1 だけで待ち受けるサーバーがあっても、ポートが使われているとみなす (::1 の無い機では飛ばす)', async (context) => {
    const blocker = createServer();
    const error = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
      blocker.once('error', resolve);
      blocker.listen(port, '::1', () => resolve(undefined));
    });
    if (error?.code === 'EADDRNOTAVAIL') return context.skip();
    if (error !== undefined) throw error;
    try {
      await expect(assertPortFree(port)).rejects.toThrow(`ポート ${port} が使われている`);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
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
      /*
       * テストの curl は、curl の版に関わらず決まった User-Agent を送る。
       * 素の curl の値と区別できる値で、設定ファイルの仕組みそのものを確かめる (curl が 8.18.0 の機では、
       * 既定の値で確かめても、仕組みが効いていなくても通ってしまう)。
       */
      expect(runCurl(`curl -s http://localhost:${port}/ua`, root, 'snippet-test/1.0').stdout).toBe('snippet-test/1.0\n');
      expect(runCurl(`curl -s http://localhost:${port}/ua`, root).stdout).toBe(`${curlUserAgent}\n`);
    } finally {
      await stopServer(server);
    }
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  it('起動したサーバーのプロセスグループには生きたメンバーがあり、止めると無くなる', async () => {
    const server = await startServer('ch00-web', { port, ready: { http: '/' } }, `sh -c 'node test/fixtures/server.ts ${port}'`, root);
    const pgid = server.child.pid;
    if (pgid === undefined) throw new Error('起動したサーバーに PID が無い');
    try {
      expect(liveGroupMembers(pgid).length).toBeGreaterThan(0);
    } finally {
      await stopServer(server);
    }
    for (let i = 0; i < 50 && liveGroupMembers(pgid).length > 0; i++) await sleep(100);
    expect(liveGroupMembers(pgid)).toEqual([]);
  });

  it('先頭のプロセスが終わってまだ回収されていないグループには、生きたメンバーを数えず、信号も例外にしない', () => {
    // 先頭のプロセスに SIGTERM を送ってから、イベントループに戻らずに待つと、先頭は Z のまま残る (Node が回収しないため)。
    const pgid = spawnGroup('exec sleep 30');
    process.kill(-pgid, 'SIGTERM');
    expect(waitSync(() => groupStates(pgid).length > 0 && groupStates(pgid).every((m) => m.stat.startsWith('Z'))), '先頭が Z になる').toBe(true);
    expect(liveGroupMembers(pgid)).toEqual([]);
    if (process.platform === 'darwin') {
      // macOS の kill(2) は、この状態のグループに EPERM を返す。signalGroup はそれを止めた扱いにする。
      expect(() => process.kill(-pgid, 'SIGKILL')).toThrow(expect.objectContaining({ code: 'EPERM' }));
    }
    expect(() => signalGroup(pgid, 'SIGKILL')).not.toThrow();
  });

  it('生きたメンバーを数えるときに、終わって回収されていない (Z の) メンバーを除く', () => {
    // 背景の sleep は、exec で置き換わった sleep 30 の子になり、sleep は子を回収しないので、終わった後は Z のまま残る。
    // 背景の sleep を少し長くするのは、bash が exec より前にそれを回収しないため。
    const pgid = spawnGroup('sleep 0.3 & exec sleep 30');
    try {
      expect(waitSync(() => groupStates(pgid).some((m) => m.pid !== pgid && m.stat.startsWith('Z'))), 'Z のメンバーができる').toBe(true);
      expect(liveGroupMembers(pgid)).toEqual([pgid]);
    } finally {
      process.kill(-pgid, 'SIGKILL');
    }
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

describe('値を作るサーバーの応答を、仕様のスキーマで確かめる', () => {
  // 試しのサーバー (test/fixtures/schema/server.ts) は、パスごとに決まった応答を返す。仕様は test/fixtures/schema/openapi.yaml。
  let server: RunningServer;
  let check: (command: string, stdout: string) => string[];
  beforeAll(async () => {
    check = responseChecker(loadSpec('test/fixtures/schema/openapi.yaml'));
    server = await startServer('ch00-schema', { port, ready: { http: '/other' } }, `node test/fixtures/schema/server.ts ${port}`, root);
  }, 60_000);
  afterAll(() => stopServer(server));

  /** 記事の値を作る形の curl と同じ形 (-i と、最後の行にステータスコード) で呼び、本物の curl の出力を確かめる。 */
  function call(options: string): string[] {
    const command = `curl -s -i -w '\\n%{http_code}\\n' ${options}`;
    return check(command, runCurl(command, root).stdout);
  }

  it('仕様のスキーマに合う応答は、食い違いが無い (Content-Type の引数と、部品の応答の参照も読む)', () => {
    expect(call(`http://localhost:${port}/items/good`)).toEqual([]);
    expect(call(`http://localhost:${port}/items/missing`)).toEqual([]);
  });

  it('スキーマに合わない本文を返す', () => {
    expect(call(`http://localhost:${port}/items/bad`)).toEqual(['GET /items/bad の 200: /id must be string']);
  });

  it('仕様に無いパスを返す', () => {
    expect(call(`http://localhost:${port}/other`)).toEqual(['GET /other: 仕様にこのパスが無い']);
  });

  it('パスはあるが、仕様にそのメソッドが無いことを返す', () => {
    expect(call(`-X DELETE http://localhost:${port}/items/good`)).toEqual([
      'DELETE /items/good: 仕様の /items/{itemId} にメソッド DELETE が無い',
    ]);
  });

  it('仕様にそのステータスコードが無いことを返す', () => {
    expect(call(`http://localhost:${port}/items/teapot`)).toEqual([
      'GET /items/teapot: 仕様の /items/{itemId} の GET にステータスコード 418 が無い',
    ]);
  });

  it('仕様に本文のスキーマが無いこと (Content-Type が無い・スキーマが無い・スキーマが空) を返す', () => {
    expect(call(`http://localhost:${port}/items/xml`)).toEqual(['GET /items/xml の 200: 仕様に application/xml の本文が無い']);
    expect(call(`http://localhost:${port}/items/plain`)).toEqual(['GET /items/plain の 200 の text/plain: 仕様に本文のスキーマが無い']);
    expect(call(`http://localhost:${port}/items/csv`)).toEqual(['GET /items/csv の 200 の text/csv: 仕様に本文のスキーマが無い']);
  });

  it('静的なパスを、同じ形の変数のパスより先に当てる', () => {
    expect(call(`http://localhost:${port}/items/special`)).toEqual([]);
  });

  it('範囲のキー (4XX) を、その範囲のステータスコードに当て、default には当てない', () => {
    expect(call(`http://localhost:${port}/ranges/teapot`)).toEqual([]);
    expect(call(`http://localhost:${port}/defaults/teapot`)).toEqual([
      'GET /defaults/teapot: 仕様の /defaults/{defaultId} の GET にステータスコード 418 が無い',
    ]);
  });

  it('応答に Content-Type ヘッダが無いことを返す', () => {
    expect(call(`http://localhost:${port}/items/notype`)).toEqual(['GET /items/notype の 200: 応答に Content-Type ヘッダが無い']);
  });

  it('curl のメソッドとパスを読む (-X・-d・--data-raw・--json・-I・--head・行の続き・ヘッダの中の URL)', () => {
    expect(parseCurlRequest("curl -s -i \\\n  -X PATCH 'http://localhost:3905/orders/1?x=1'")).toEqual({ method: 'PATCH', path: '/orders/1' });
    expect(parseCurlRequest(`curl -s -d '{"a":1}' http://localhost:3905/orders`)).toEqual({ method: 'POST', path: '/orders' });
    expect(parseCurlRequest(`curl -s --data-raw '{"a":1}' http://localhost:3905/orders`)).toEqual({ method: 'POST', path: '/orders' });
    expect(parseCurlRequest(`curl -s --json '{"a":1}' http://localhost:3905/orders`)).toEqual({ method: 'POST', path: '/orders' });
    expect(parseCurlRequest('curl -s -I http://localhost:3905/orders/1')).toEqual({ method: 'HEAD', path: '/orders/1' });
    expect(parseCurlRequest('curl -s --head http://localhost:3905/orders/1')).toEqual({ method: 'HEAD', path: '/orders/1' });
    expect(parseCurlRequest('curl -s http://localhost:3905/orders/1')).toEqual({ method: 'GET', path: '/orders/1' });
    expect(parseCurlRequest("curl -s -H 'Origin: http://localhost:3903' http://localhost:3905/orders/1")).toEqual({ method: 'GET', path: '/orders/1' });
  });

  it('-i の無い出力と、最後の行がステータスコードでない出力は、読まずに例外にする', () => {
    expect(() => parseCurlResponse('{"id":"good"}\n200\n')).toThrow('-i が要る');
    expect(() => parseCurlResponse('HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"id":"good"}\n')).toThrow('-w');
  });
});
