/*
 * 受け取ったリクエストのメソッド・URL・ヘッダ・本文を、そのまま JSON にして返すサーバー。
 * 2 章で、curl が何を送っているかを観察するのに使う。設計した API ではない。
 */
import { createServer } from 'node:http';
import { text } from 'node:stream/consumers';

const port = 3901;

createServer(async (req, res) => {
  let body: string;
  try {
    body = await text(req);
  } catch {
    /*
     * 本文を受け取る途中で接続が切れた。応答を返す相手がいないので、接続を閉じて終える。
     * 捕まえないと、この async の関数の外で処理されないまま、サーバーのプロセスが止まる。
     */
    res.destroy();
    return;
  }
  const echo = { method: req.method, url: req.url, headers: req.headers, body };
  const json = `${JSON.stringify(echo, null, 2)}\n`;
  /*
   * writeHead でヘッダを決めてから本文を渡すので、Content-Length を書かないと、Node.js は本文を chunked で送る。
   * 長さを数えるのは文字でなくバイトで、日本語は 1 文字が複数のバイトになる。
   */
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}).listen(port, () => {
  console.log(`エコーサーバーを http://localhost:${port} で起動しました`);
});
