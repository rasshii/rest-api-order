/*
 * 注文 API の仕様 (openapi/openapi.yaml) を、ブラウザの Swagger UI で読むための配信のサーバー。
 * 画面のファイルは npm の swagger-ui-dist のものを配り、読む仕様を決める初期化の script だけをここで作る。
 * 仕様のファイルはリクエストのたびに読み直すので、仕様を直したらブラウザで読み込み直せば反映される。
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = 3903;
const spec = fileURLToPath(new URL('../../openapi/openapi.yaml', import.meta.url));

/**
 * swagger-ui-dist の index.js は、読み込むとブラウザ向けの bundle まで読み込むので import しない。
 * package.json の場所から、配るファイルのあるディレクトリだけを求める。
 */
const dist = dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));

/** swagger-ui-dist の index.html が読み込むファイルと、その Content-Type。ここに無いパスは 404 にする。 */
const assets: Record<string, string> = {
  '/index.html': 'text/html; charset=utf-8',
  '/swagger-ui.css': 'text/css; charset=utf-8',
  '/index.css': 'text/css; charset=utf-8',
  '/swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
  '/swagger-ui-standalone-preset.js': 'text/javascript; charset=utf-8',
  '/favicon-32x32.png': 'image/png',
  '/favicon-16x16.png': 'image/png',
};

/**
 * swagger-ui-dist の swagger-initializer.js の代わりに配る、初期化の script。
 * 読む仕様をこのサーバーの /openapi.yaml にする。リクエストを送る先がまだ無いので、Try it out は出さない。
 */
const initializer = `window.onload = () => {
  window.ui = SwaggerUIBundle({
    url: '/openapi.yaml',
    dom_id: '#swagger-ui',
    supportedSubmitMethods: [],
  });
};
`;

function send(res: ServerResponse, status: number, contentType: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * ファイルを読んで返す。読めなければ 500 と理由を返す。仕様のファイルは、tag を切り替えたときや名前を変えたときに無くなりうる。
 * readFileSync の例外を捕まえないと、この関数の外で処理されないまま、サーバーのプロセスが止まる。
 */
function sendFile(res: ServerResponse, file: string, contentType: string): void {
  let body: Buffer;
  try {
    body = readFileSync(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    send(res, 500, 'text/plain; charset=utf-8', `配るファイルを読めません (${code})\n`);
    return;
  }
  send(res, 200, contentType, body);
}

createServer((req, res) => {
  // http.Server が渡すリクエストには、url が必ずある (型が省略可なのは、クライアントが受ける応答と型を共用するため)。
  const target = req.url!;
  /*
   * リクエストの対象は、/ で始まるパス (origin-form) のほかに、http://… の絶対形式 (absolute-form) でも届き、
   * サーバーは絶対形式も受け付ける (RFC 9112 の 3.2.2)。/ で始まる対象を基準の URL に対して解決すると、// で始まるパスを
   * 別のホストと読むので、パスには localhost を前に付ける。
   * *:99999 のように URL として読めないものも届く。new URL は読めないと例外を投げ、この関数の外で
   * 処理されないまま、サーバーのプロセスが止まるので、読めなければ null を返す URL.parse を使う。
   */
  const url = target.startsWith('/') ? URL.parse(`http://localhost${target}`) : URL.parse(target);
  if (url === null) return send(res, 400, 'text/plain; charset=utf-8', 'リクエストの対象を URL として読めません\n');
  const path = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  if (path === '/openapi.yaml') return sendFile(res, spec, 'application/yaml');
  if (path === '/swagger-initializer.js') return send(res, 200, 'text/javascript; charset=utf-8', initializer);
  const name = path === '/' ? '/index.html' : path;
  const contentType = assets[name];
  if (contentType === undefined) return send(res, 404, 'text/plain; charset=utf-8', `${path} は見つかりません\n`);
  sendFile(res, join(dist, name), contentType);
}).listen(port, () => {
  console.log(`Swagger UI を http://localhost:${port} で起動しました`);
});
