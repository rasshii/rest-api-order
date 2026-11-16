/*
 * snippets のテストが使う、実行と比較の処理のテスト。試しのファイル (test/fixtures/) で、正しい入力で通ることと、
 * 期待と違う入力で落ちること (違いを返すこと) の両方を確かめる。
 * 試しのファイルを test/snippets/ に置かないのは、記事のどの例にも当たらないファイルとして、
 * ガイドの側の照合が失敗にするため。
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { normalizeOutput } from './support/replacements.ts';
import {
  assertAlive,
  assertPortFree,
  countWithFind,
  curlUserAgent,
  findServersFileProblems,
  lastLine,
  listSnippets,
  groupMembers,
  liveGroupMembers,
  portsOfCurl,
  signalGroup,
  readServersFile,
  runCommand,
  runCurl,
  ServerPool,
  startServer,
  stopServer,
} from './support/snippets.ts';
import type { RunningServer } from './support/snippets.ts';

/** bash -c <script> を新しいプロセスグループで起こし、そのグループの ID (先頭の PID) を返す。 */
function spawnGroup(script: string): number {
  const child = spawn('bash', ['-c', script], { detached: true, stdio: 'ignore' });
  if (child.pid === undefined) throw new Error(`起動できない: ${script}`);
  return child.pid;
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

describe('プロセスグループのメンバー', () => {
  it('ps を起こせないときは、その理由を例外の文に入れる', () => {
    // ps の無い PATH で呼ぶ。理由を捨てると、何が起きたか分からない「ps が失敗した: 」だけが残る。
    vi.stubEnv('PATH', '/nonexistent');
    try {
      expect(() => liveGroupMembers(process.pid)).toThrow(/ENOENT/);
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

  it('テストの curl は、curl の版に関わらず決まった User-Agent を送る', async () => {
    const server = await startServer('ch00-web', { port, ready: { http: '/' } }, `node test/fixtures/server.ts ${port}`, root);
    try {
      /*
       * 素の curl の値と区別できる値で、設定ファイルの仕組みそのものを確かめる (curl が 8.18.0 の機では、
       * 既定の値で確かめても、仕組みが効いていなくても通ってしまう)。
       */
      expect(runCurl(`curl -s http://localhost:${port}/ua`, root, 'snippet-test/1.0').stdout).toBe('snippet-test/1.0\n');
      expect(runCurl(`curl -s http://localhost:${port}/ua`, root).stdout).toBe(`${curlUserAgent}\n`);
    } finally {
      await stopServer(server);
    }
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
    expect(waitSync(() => groupMembers(pgid).length > 0 && groupMembers(pgid).every((m) => m.stat.startsWith('Z'))), '先頭が Z になる').toBe(true);
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
      expect(waitSync(() => groupMembers(pgid).some((m) => m.pid !== pgid && m.stat.startsWith('Z'))), 'Z のメンバーができる').toBe(true);
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

  it('起動の条件が成り立った直後に起動のコマンドが終わっていれば、孫のプロセスまで止めてから例外にする', async () => {
    // bash は ready を出してすぐ終わり、後ろで起こした node だけがポートを持って残る。
    await expect(
      startServer('ch00-web', { port, ready: { output: 'ready' } }, `node test/fixtures/server.ts ${port} & echo ready`, root),
    ).rejects.toThrow('サーバー ch00-web');
    for (let i = 0; i < 30 && !(await isPortFree(port)); i++) await sleep(100);
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });
});

describe('起動したサーバーの持ち方 (ServerPool)', () => {
  // 起動と停止の関数を差し替えるので、本物のサーバーは起動しない。名前だけを持つ RunningServer で足りる。
  const fake = (name: string) => ({ name }) as RunningServer;

  it('同じ名前のサーバーを起動の途中にもう一度頼んでも、1 回しか起動しない', async () => {
    let calls = 0;
    let finish: (server: RunningServer) => void = () => {};
    const pool = new ServerPool(
      () => {
        calls++;
        return new Promise<RunningServer>((resolve) => (finish = resolve));
      },
      async () => {},
    );
    const first = pool.get('a');
    const second = pool.get('a');
    finish(fake('a'));
    expect(await second).toBe(await first);
    expect(calls).toBe(1);
  });

  it('止めるのに 1 つ失敗しても、ほかを止めてから例外にし、持っているサーバーを空にする', async () => {
    const stopped: string[] = [];
    const pool = new ServerPool(
      async (name) => fake(name),
      async (server) => {
        if (server.name === 'a') throw new Error('a を止められない');
        // 止め終わるまで時間のかかるサーバー。失敗を見てすぐに例外にすると、止め終わる前に戻る。
        await sleep(50);
        stopped.push(server.name);
      },
    );
    for (const name of ['a', 'b', 'c']) await pool.get(name);
    await expect(pool.stopAll()).rejects.toThrow('a を止められない');
    expect(stopped.sort()).toEqual(['b', 'c']);
    expect(['a', 'b', 'c'].filter((name) => pool.has(name))).toEqual([]);
  });

  it('起動に失敗したサーバーは止めにかからず、stopAll は例外にしない', async () => {
    const stopped: string[] = [];
    const pool = new ServerPool(
      async () => {
        throw new Error('起動に失敗');
      },
      async (server) => {
        stopped.push(server.name);
      },
    );
    await expect(pool.get('a')).rejects.toThrow('起動に失敗');
    await expect(pool.stopAll()).resolves.toBeUndefined();
    expect(stopped).toEqual([]);
  });
});

async function isPortFree(target: number): Promise<boolean> {
  try {
    await assertPortFree(target);
    return true;
  } catch {
    return false;
  }
}
