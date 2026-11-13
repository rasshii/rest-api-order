/*
 * 実行と比較の処理のテスト (harness.test.ts) で起動するサーバー。
 * /ua は、テストの curl が設定ファイルで決めた User-Agent を送っていることを確かめるために、受け取った値を返す。
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2]);
createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(req.url === '/ua' ? `${req.headers['user-agent']}\n` : 'ok\n');
}).listen(port);
