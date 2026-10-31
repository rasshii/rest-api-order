/*
 * 受け取ったリクエストのメソッド・URL・ヘッダ・本文を、そのまま JSON にして返すサーバー。
 * 2 章で、curl が何を送っているかを観察するのに使う。設計した API ではない。
 */
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';

const port = 3901;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

createServer(async (req, res) => {
  const body = await readBody(req);
  const echo = { method: req.method, url: req.url, headers: req.headers, body };
  const text = `${JSON.stringify(echo, null, 2)}\n`;
  // 本文の長さ (バイト数) を Content-Length で知らせる。日本語は 1 文字が複数のバイトになる。
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}).listen(port, () => {
  console.log(`エコーサーバーを http://localhost:${port} で起動しました`);
});
