/*
 * 応答をスキーマで確かめる処理の自己テスト (harness.test.ts) で起動するサーバー。パスごとに決まった応答を返す。
 * 試しの仕様 (openapi.yaml) に合う応答と、合わない応答の両方を持つ。メソッドは見ない。
 */
import { createServer } from 'node:http';

const responses: Record<string, { status: number; type: string; body: string }> = {
  '/items/good': { status: 200, type: 'application/json', body: '{"id":"good"}' },
  '/items/bad': { status: 200, type: 'application/json', body: '{"id":1}' },
  '/items/missing': { status: 404, type: 'application/problem+json; charset=utf-8', body: '{"status":404}' },
  '/items/teapot': { status: 418, type: 'application/json', body: '{}' },
  '/items/plain': { status: 200, type: 'text/plain', body: 'good' },
  '/items/csv': { status: 200, type: 'text/csv', body: 'id\ngood' },
  '/items/xml': { status: 200, type: 'application/xml', body: '<id>good</id>' },
  '/items/special': { status: 200, type: 'application/json', body: '{"special":true}' },
  '/items/notype': { status: 200, type: '', body: '{"id":"notype"}' },
  '/ranges/teapot': { status: 418, type: 'application/problem+json', body: '{"status":418}' },
  '/defaults/teapot': { status: 418, type: 'application/json', body: '{}' },
  '/other': { status: 200, type: 'application/json', body: '{"id":"other"}' },
};

const port = Number(process.argv[2]);
createServer((req, res) => {
  const response = responses[req.url ?? ''] ?? { status: 404, type: 'text/plain', body: 'not found' };
  // type が空なら Content-Type ヘッダを付けない (応答に Content-Type が無い場合の試し)。
  res.writeHead(response.status, response.type === '' ? {} : { 'Content-Type': response.type });
  res.end(response.body);
}).listen(port);
