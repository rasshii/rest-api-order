/*
 * 記事で動かすサーバー (tools/) が、本文を受け取る途中で切れたリクエストの後も止まらずに応答することを確かめる。
 * 読者が curl を途中で止めても、同じサーバーで記事の次の例を続けられるようにするため。
 */
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { assertAlive, readServersFile, startServer, stopServer } from './support/snippets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const snippets = fileURLToPath(new URL('./snippets/', import.meta.url));
const servers = readServersFile(snippets);

/** 本文の途中まで送り、残りを送らずに接続を切る。 */
async function sendHalfBody(port: number, path: string): Promise<void> {
  const socket = connect(port, 'localhost');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"name":`);
  // サーバーがヘッダを読んで本文を待ち始めてから切る。
  await sleep(200);
  socket.destroy();
}

it('エコーサーバーは、本文を受け取る途中で切れたリクエストの後も応答する', async () => {
  const name = 'ch02-echo-server';
  const spec = servers.servers[name];
  const server = await startServer(name, spec, readFileSync(`${snippets}${name}.server`, 'utf8'), root);
  try {
    await sendHalfBody(spec.port, '/');
    await sleep(300);
    const response = await fetch(`http://localhost:${spec.port}/after`);
    expect(response.status).toBe(200);
    assertAlive(server);
  } finally {
    await stopServer(server);
  }
});
