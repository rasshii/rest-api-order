// 照合の土台の自己テストで起動する、どのリクエストにも 200 と ok を返すサーバー。
import { createServer } from 'node:http';

const port = Number(process.argv[2]);
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok\n');
}).listen(port);
