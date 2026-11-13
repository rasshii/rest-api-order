/*
 * 記事で動かすサーバー (tools/) の、記事の例では通らない振る舞いを確かめる。
 * 本文を受け取る途中で切れたリクエストの後も止まらずに応答すること (読者が curl を途中で止めても、同じサーバーで
 * 記事の次の例を続けられるようにするため) と、商品のサーバーが受け付けるリクエストの形。
 */
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { assertAlive, readServersFile, startServer, stopServer } from './support/snippets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const snippets = fileURLToPath(new URL('./snippets/', import.meta.url));
const servers = readServersFile(snippets);

/** 記事の例と同じ servers.json と .server でサーバーを起動し、fn の後に止める。 */
async function withServer(name: string, fn: (port: number) => Promise<void>): Promise<void> {
  const spec = servers.servers[name];
  const server = await startServer(name, spec, readFileSync(`${snippets}${name}.server`, 'utf8'), root);
  try {
    await fn(spec.port);
    assertAlive(server);
  } finally {
    await stopServer(server);
  }
}

async function open(port: number): Promise<Socket> {
  const socket = connect(port, 'localhost');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

/** 本文の途中まで送り、残りを送らずに接続を切る。 */
async function sendHalfBody(port: number, path: string): Promise<void> {
  const socket = await open(port);
  socket.write(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"name":`);
  // サーバーがヘッダを読んで本文を待ち始めてから切る。
  await sleep(200);
  socket.destroy();
}

/** 開始行を文字のまま送り、応答の開始行を返す。fetch や curl では送れない形の request-target を試すため。 */
async function statusLineOf(port: number, requestLine: string): Promise<string> {
  const socket = await open(port);
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => (received += chunk));
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  socket.write(`${requestLine}\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
  await closed;
  return received.split('\r\n')[0];
}

describe('本文を受け取る途中で切れたリクエストの後も応答する', () => {
  it('エコーサーバー', async () => {
    await withServer('ch02-echo-server', async (port) => {
      await sendHalfBody(port, '/');
      await sleep(300);
      expect((await fetch(`http://localhost:${port}/after`)).status).toBe(200);
    });
  });

  it('商品のサーバー', async () => {
    await withServer('ch03-product-server', async (port) => {
      await sendHalfBody(port, '/products');
      await sendHalfBody(port, '/rpc');
      await sleep(300);
      expect((await fetch(`http://localhost:${port}/products`)).status).toBe(200);
    });
  });
});

describe('商品のサーバーが受け付けるリクエストの形', () => {
  it('request-target が絶対形式 (http://…) でも、パスで応答を選ぶ', async () => {
    await withServer('ch03-product-server', async (port) => {
      expect(await statusLineOf(port, `GET http://localhost:${port}/products HTTP/1.1`)).toBe('HTTP/1.1 200 OK');
      expect(await statusLineOf(port, `GET http://localhost:${port}/products/p-none HTTP/1.1`)).toBe('HTTP/1.1 404 Not Found');
    });
  });

  it('/ で始まる対象はパスとして読み、// で始まっても別のホストの URL として読まない', async () => {
    await withServer('ch03-product-server', async (port) => {
      expect(await statusLineOf(port, 'GET //example.com/products HTTP/1.1')).toBe('HTTP/1.1 404 Not Found');
    });
  });

  it('URL として読めない対象には 400 を返し、止まらない', async () => {
    await withServer('ch03-product-server', async (port) => {
      expect(await statusLineOf(port, 'GET *:99999 HTTP/1.1')).toBe('HTTP/1.1 400 Bad Request');
      expect((await fetch(`http://localhost:${port}/products`)).status).toBe(200);
    });
  });

  it('Content-Type は、パラメータを除いた type と subtype を、大文字小文字を区別せずに application/json と比べる', async () => {
    await withServer('ch03-product-server', async (port) => {
      const post = async (contentType: string) =>
        (
          await fetch(`http://localhost:${port}/products`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: JSON.stringify({ name: 'もも' }),
          })
        ).status;
      expect(await post('application/json')).toBe(201);
      expect(await post('application/json; charset=utf-8')).toBe(201);
      expect(await post('Application/JSON')).toBe(201);
      expect(await post('application/json-patch+json')).toBe(415);
      expect(await post('text/plain; charset=application/json')).toBe(415);
    });
  });
});
