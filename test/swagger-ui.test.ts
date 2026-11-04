/*
 * Swagger UI の配信のサーバーが配る仕様 (tools/swagger-ui/spec-for-browser.ts と、それを通して配る server.ts) を確かめる。
 * servers の先頭がモックになり、モックの URL が記事の例のモック (servers.json の ch13-mock) と同じポートを指すこと。
 * Try it out の送り先はこの先頭のサーバーなので、ずれると画面からモックへ届かなくなる。
 * 配信のサーバーは動かして /openapi.yaml を取り、本文の servers を見る (処理を通さずに配る形に戻すと落ちる)。
 * 配信のサーバーの it は、テストの中で dist/openapi.yaml に束ねる。配信のサーバーが決まったパスの dist/openapi.yaml を読むため。
 * 途中で読めない中身を書くので、最後に束ね直して戻す。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { mockServer, specForBrowser } from '../tools/swagger-ui/spec-for-browser.ts';
import { runRedocly } from './support/redocly.ts';
import { assertAlive, readServersFile, startServer, stopServer } from './support/snippets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const snippets = fileURLToPath(new URL('./snippets/', import.meta.url));
/** 配信のサーバーは記事と同じ 3903 で待ち受ける (server.ts で決まった値)。テストのファイルは並べて回さないので、snippets の例と重ならない。 */
const port = 3903;

it('配る仕様の servers の先頭にモックを足し、ほかのキーと元の servers は変えない', () => {
  const original = 'openapi: 3.1.2\ninfo:\n  title: 注文 API\nservers:\n  - url: /\n    description: 元のサーバー\npaths: {}\n';
  const served = parse(specForBrowser(original)) as Record<string, unknown>;
  expect(served.servers).toEqual([mockServer, { url: '/', description: '元のサーバー' }]);
  expect(Object.keys(served)).toEqual(['openapi', 'info', 'servers', 'paths']);
  expect(served.info).toEqual({ title: '注文 API' });
});

it('servers の無い仕様には、モックだけを置く', () => {
  const served = parse(specForBrowser('openapi: 3.1.2\npaths: {}\n')) as Record<string, unknown>;
  expect(served.servers).toEqual([mockServer]);
});

it('キーと値の組でない文書 (空・配列) と、servers が配列でない文書 (文字列・null) は、読まずに例外にする', () => {
  expect(() => specForBrowser('')).toThrow('キーと値の組の文書でない');
  expect(() => specForBrowser('- a\n')).toThrow('キーと値の組の文書でない');
  expect(() => specForBrowser('openapi: 3.1.2\nservers: /\n')).toThrow('servers が配列でない');
  expect(() => specForBrowser('openapi: 3.1.2\nservers:\n')).toThrow('servers が配列でない');
});

it('配信のサーバーは、/openapi.yaml に dist/openapi.yaml の servers の先頭へモックを足したものを配り、読めない仕様には 500 を返す', async () => {
  const dist = fileURLToPath(new URL('../dist/openapi.yaml', import.meta.url));
  const bundle = () => {
    const result = runRedocly(['bundle', 'openapi/openapi.yaml', '--output', 'dist/openapi.yaml']);
    if (result.status !== 0) throw new Error(`仕様を束ねられない:\n${result.stderr}`);
  };
  bundle();
  const server = await startServer('ch00-swagger-ui', { port, ready: { http: '/' } }, 'node tools/swagger-ui/server.ts', root);
  try {
    const served = await fetch(`http://localhost:${port}/openapi.yaml`);
    expect(served.status).toBe(200);
    const document = parse(await served.text()) as { servers: { url: string }[] };
    expect(document.servers.map((s) => s.url)).toEqual([mockServer.url, '/']);
    // 束ね直している途中の書きかけを真似て、YAML として読めない中身にする。
    writeFileSync(dist, 'openapi: [3.1.2\n');
    const broken = await fetch(`http://localhost:${port}/openapi.yaml`);
    expect(broken.status).toBe(500);
    expect(await broken.text()).toContain('dist/openapi.yaml を読めません');
    assertAlive(server);
  } finally {
    // 束ね直しが投げても配信のサーバーが残らないよう先に止め、止める処理が投げても束ね直す。
    try {
      await stopServer(server);
    } finally {
      bundle();
    }
  }
}, 60_000);

it('モックの URL は、記事の例のモック (servers.json の ch13-mock) のポートの 127.0.0.1 を指す', () => {
  const { servers } = readServersFile(snippets);
  const mock = servers['ch13-mock'];
  expect(mock, 'servers.json に ch13-mock が無い').toBeDefined();
  expect(mockServer.url).toBe(`http://127.0.0.1:${mock.port}`);
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  expect(scripts.mock).toMatch(new RegExp(`--port ${mock.port}(\\s|$)`));
});
