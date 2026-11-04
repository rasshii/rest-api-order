/*
 * 記事に載せた curl とコマンドを、記事と同じ形で実行して比べるための処理。
 * 記事の例をどう確かめているかは、ガイドの第 1 章の「記事の例は動かして確かめている」節
 * (https://notes.rewheel.dev/docs/rest-api/introduction#記事の例は動かして確かめている) にある。
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface ServerSpec {
  port: number;
  /** 起動を待つ条件。HTTP で応答が返るか、標準出力か標準エラー出力に文字列が出るか。 */
  ready: { http: string } | { output: string };
  /**
   * 値を作るサーバー (応答の値が毎回変わるモック) なら、応答を確かめる仕様の入口 (リポジトリの root からの相対パス)。
   * このサーバーへの例は、値を .out で比べず、ステータスコードを .status で、本文をこの仕様のスキーマで確かめる。
   */
  spec?: string;
}

export interface ServersFile {
  servers: Record<string, ServerSpec>;
  /** command の名前ごとに、その command が使うサーバーの名前。 */
  commands: Record<string, string[]>;
}

export interface Snippet {
  name: string;
  kind: 'request' | 'command';
  file: string;
}

/** snippets のディレクトリの .curl と .cmd を、ファイル名の順 (名前が ch<章>-<順>-<内容> なので、章ごとに記事の順) に返す。 */
export function listSnippets(dir: string): Snippet[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.curl') || f.endsWith('.cmd'))
    .sort()
    .map((f) => ({
      name: f.replace(/\.(curl|cmd)$/, ''),
      kind: f.endsWith('.curl') ? 'request' : 'command',
      file: join(dir, f),
    }));
}

/**
 * listSnippets と別の方法 (find) で、.curl と .cmd のファイルの数を数える。
 * 列挙の誤りで 1 つも走らなかったときに、走った数との突き合わせで気づくため。
 */
export function countWithFind(dir: string): number {
  const result = spawnSync(
    'find',
    [dir, '-maxdepth', '1', '-type', 'f', '(', '-name', '*.curl', '-o', '-name', '*.cmd', ')'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`find が失敗した: ${result.stderr}`);
  }
  return result.stdout.split('\n').filter((line) => line !== '').length;
}

/** servers.json を読む。無ければ例外にする (別のディレクトリを読んで 0 件で通るのを防ぐため)。 */
export function readServersFile(dir: string): ServersFile {
  const raw = JSON.parse(readFileSync(join(dir, 'servers.json'), 'utf8')) as Partial<ServersFile>;
  return { servers: raw.servers ?? {}, commands: raw.commands ?? {} };
}

/** servers.json と snippets のファイルの食い違いを、見つかった順に文で返す。 */
export function findServersFileProblems(dir: string, file: ServersFile): string[] {
  const names = readdirSync(dir);
  const serverFiles = names.filter((f) => f.endsWith('.server')).map((f) => f.replace(/\.server$/, ''));
  const problems: string[] = [];
  for (const name of serverFiles) {
    if (!(name in file.servers)) problems.push(`${name}.server が servers.json の servers に無い`);
  }
  for (const name of Object.keys(file.servers)) {
    if (!serverFiles.includes(name)) problems.push(`servers.json の ${name} に ${name}.server が無い`);
  }
  for (const name of Object.keys(file.commands)) {
    if (!names.includes(`${name}.cmd`)) problems.push(`servers.json の commands の ${name} に ${name}.cmd が無い`);
  }
  const ports = Object.values(file.servers).map((s) => s.port);
  const repeated = ports.filter((p, i) => ports.indexOf(p) !== i);
  if (repeated.length > 0) problems.push(`servers.json のポートが重なる: ${[...new Set(repeated)].join(', ')}`);
  return problems;
}

/**
 * 値を作るサーバー (起動のコマンドが prism mock に --dynamic を付けるもの) と、servers.json の spec の食い違いを返す。
 * spec を書き忘れると、そのサーバーへの例はスキーマで確かめられないまま通り、
 * 例を返すサーバーに spec を書くと、値を作っていない応答を、値を作った応答として確かめたことになるため。
 * command は .server の中身。npm run <名前> なら、scripts のその名前の中身を見る。
 */
export function valueServerProblems(file: ServersFile, commandOf: (name: string) => string, scripts: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [name, spec] of Object.entries(file.servers)) {
    const command = commandOf(name).trim();
    const script = /^npm run ([\w:-]+)$/.exec(command)?.[1];
    const resolved = script === undefined ? command : (scripts[script] ?? '');
    const dynamic = /\bprism mock\b/.test(resolved) && /(^|\s)(--dynamic|-d)(\s|$)/.test(resolved);
    if (dynamic && spec.spec === undefined) problems.push(`${name} は値を作るモックなのに、servers.json に spec が無い`);
    if (!dynamic && spec.spec !== undefined) problems.push(`${name} は値を作るモックでないのに、servers.json に spec がある`);
  }
  return problems;
}

/**
 * curl のコマンドを語に分ける。照合する curl は、引用符と行の続きだけを使う (記事の決まり) ので、それだけを扱う。
 * 引用符の中の空白は語を分けないので、-H 'Origin: http://...' のヘッダの値は 1 つの語のまま残り、URL の語にならない。
 */
export function curlWords(command: string): string[] {
  const joined = command.replace(/\\\n/g, ' ');
  return [...joined.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** curl のコマンドの、送り先の URL (http か https で始まる語) を返す。ヘッダや本文の中の URL は含まない。 */
export function curlUrls(command: string): URL[] {
  return curlWords(command)
    .filter((word) => /^https?:\/\//.test(word))
    .map((word) => new URL(word));
}

/** curl のコマンドが接続する localhost のポートを返す。 */
export function portsOfCurl(command: string): number[] {
  const ports = curlUrls(command)
    .filter((url) => url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    .map((url) => Number(url.port));
  return [...new Set(ports)];
}

/** 出力の最後の空でない行。結果を記事で比べない curl の、-w の %{http_code} を読む。 */
export function lastLine(text: string): string {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  return lines.at(-1) ?? '';
}

/*
 * ポートが使われているかを、127.0.0.1・::1・host を省いた形 (全部のアドレス) の順に待ち受けて確かめる。
 * macOS では、127.0.0.1 だけで待ち受けるサーバー (Prism の既定) があっても、host を省いた待ち受けは成功するので、
 * host を省いた形だけでは、そのサーバーに気づかない。::1 を持たない機 (EADDRNOTAVAIL) では、そのアドレスは空いているとみなす。
 */
const probeHosts: (string | undefined)[] = ['127.0.0.1', '::1', undefined];

function probePort(port: number, host: string | undefined): Promise<string | undefined> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EADDRNOTAVAIL' ? undefined : (error.code ?? 'error')));
    const listening = () => probe.close(() => resolve(undefined));
    if (host === undefined) probe.listen(port, listening);
    else probe.listen(port, host, listening);
  });
}

/** 指定のポートで待ち受けられることを確かめる。使われていれば例外にする。 */
export async function assertPortFree(port: number): Promise<void> {
  for (const host of probeHosts) {
    const code = await probePort(port, host);
    if (code !== undefined) {
      throw new Error(`ポート ${port} が使われている (${host ?? '全部のアドレス'} で ${code})。同じポートで動いている別のサーバーを止めてから回す`);
    }
  }
}

export interface RunningServer {
  name: string;
  spec: ServerSpec;
  child: ChildProcess;
  output: string;
  exited: boolean;
}

/**
 * .server のコマンドを、新しいプロセスグループで起動して、起動の条件を待つ。
 * プロセスグループにするのは、npm run が起こす孫のプロセスまで、止めるときにまとめて止めるため。
 */
export async function startServer(
  name: string,
  spec: ServerSpec,
  command: string,
  cwd: string,
  timeoutMs = 30_000,
): Promise<RunningServer> {
  await assertPortFree(spec.port);
  const child = spawn('bash', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const server: RunningServer = { name, spec, child, output: '', exited: false };
  child.stdout?.on('data', (chunk) => (server.output += String(chunk)));
  child.stderr?.on('data', (chunk) => (server.output += String(chunk)));
  child.once('exit', () => (server.exited = true));

  const deadline = Date.now() + timeoutMs;
  while (!(await isReady(server))) {
    if (server.exited) {
      // bash が終わっても、npm run が起こした孫のプロセスが残っていることがある。
      if (child.pid !== undefined) signalGroup(child.pid, 'SIGKILL');
      throw new Error(`サーバー ${name} が起動の途中で終わった:\n${server.output}`);
    }
    if (Date.now() > deadline) {
      await stopServer(server);
      throw new Error(`サーバー ${name} の起動を ${timeoutMs}ms 待ったが、条件が成り立たない:\n${server.output}`);
    }
    await sleep(100);
  }
  assertAlive(server);
  return server;
}

async function isReady(server: RunningServer): Promise<boolean> {
  const { ready, port } = server.spec;
  if ('output' in ready) return server.output.includes(ready.output);
  try {
    await fetch(`http://localhost:${port}${ready.http}`);
    return true;
  } catch {
    // まだ待ち受けていない (接続を断られた)。
    return false;
  }
}

/**
 * 起動した子のプロセスが生きていることを確かめる。
 * 空きを確かめてから待ち受けるまでの間に別の実行がポートを取ると、こちらの子は終わり、
 * 起動の条件と curl は相手のサーバーで成り立ってしまうため、起動の後と例の後に確かめる。
 */
export function assertAlive(server: RunningServer): void {
  if (server.exited) {
    throw new Error(`サーバー ${server.name} が終わっている:\n${server.output}`);
  }
}

/** プロセスグループごと止めて、ポートが空くのを待つ。 */
export async function stopServer(server: RunningServer, timeoutMs = 10_000): Promise<void> {
  const pid = server.child.pid;
  if (pid !== undefined) {
    signalGroup(pid, 'SIGTERM');
    const deadline = Date.now() + timeoutMs;
    while (!(await isPortFree(server.spec.port)) && Date.now() < deadline) {
      await sleep(100);
    }
    signalGroup(pid, 'SIGKILL');
  }
  await assertPortFree(server.spec.port);
}

/** プロセスグループに信号を送る。グループが無いか、終わったメンバーしか残っていなければ、何もしない。 */
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // グループのプロセスがすべて終わっていれば ESRCH になる。止める目的は果たしている。
    if (code === 'ESRCH') return;
    /*
     * macOS の kill(2) は、グループの先頭のプロセスが終わって、まだ親 (このテストのプロセス) に回収されていない
     * (ps の状態が Z の) ときにも EPERM を返す。生きているメンバーが残っていなければ、止める目的は果たしている。
     */
    if (code === 'EPERM' && liveGroupMembers(pid).length === 0) return;
    throw error;
  }
}

/** プロセスグループのメンバーのうち、終わっていない (ps の状態が Z でない) ものの PID を返す。 */
export function liveGroupMembers(pgid: number): number[] {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ps が失敗した: ${result.stderr}`);
  return result.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([, group, stat]) => Number(group) === pgid && stat !== undefined && !stat.startsWith('Z'))
    .map(([member]) => Number(member));
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    await assertPortFree(port);
    return true;
  } catch {
    return false;
  }
}

/** テストの curl が送る User-Agent。記事の結果もこの値で載せる。 */
export const curlUserAgent = 'curl/8.18.0';

/**
 * curl を本物の curl で実行する。比べるのは標準出力だけ。
 * User-Agent は curl の版で変わり、エコーサーバーの応答の本文と Content-Length も変わるので、
 * 設定ファイル ($CURL_HOME/.curlrc) で決まった値にする。実行する人の ~/.curlrc も読まなくなる。
 */
export function runCurl(
  command: string,
  cwd: string,
  userAgent: string = curlUserAgent,
): { stdout: string; status: number } {
  const curlHome = mkdtempSync(join(tmpdir(), 'snippet-curl-'));
  try {
    writeFileSync(join(curlHome, '.curlrc'), `user-agent = "${userAgent}"\n`);
    const result = spawnSync('bash', ['-c', command], {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, CURL_HOME: curlHome },
    });
    if (result.error) throw result.error;
    if (result.status === null) throw new Error(`curl がシグナル ${result.signal} で終わった`);
    return { stdout: result.stdout, status: result.status };
  } finally {
    rmSync(curlHome, { recursive: true, force: true });
  }
}

/**
 * コマンドを実行し、標準出力と標準エラー出力を、端末に出る順で 1 つにまとめて返す。
 * 2 つの出力に同じファイルの記述子を渡すと、書いた順に同じファイルへ並ぶ。
 * コマンドの後ろに 2>&1 を文字で足すと、末尾の改行の後の別のコマンドになり、まとまらない。
 * NO_COLOR を渡すのは、Redocly CLI などが端末でなくても CI と GITHUB_ACTIONS の環境変数があると色の符号を出し、
 * 記事に載せた出力と食い違うため。FORCE_COLOR を外すのは、Bruno CLI が FORCE_COLOR を NO_COLOR より優先して色の符号を出すため。
 */
export function runCommand(command: string, cwd: string): { output: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), 'snippet-'));
  const path = join(dir, 'output.txt');
  const fd = openSync(path, 'w');
  try {
    const { FORCE_COLOR: _forced, ...inherited } = process.env;
    const env = { ...inherited, NO_COLOR: '1' };
    const result = spawnSync('bash', ['-c', command], { cwd, env, stdio: ['ignore', fd, fd], timeout: 300_000 });
    if (result.error) throw result.error;
    if (result.status === null) throw new Error(`コマンドがシグナル ${result.signal} で終わった`);
    return { output: readFileSync(path, 'utf8'), status: result.status };
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}
