/*
 * 注文 API の仕様を、ブラウザの Swagger UI で読むための配信のサーバー。
 * 画面のファイルは npm の swagger-ui-dist のものを配り、読む仕様を決める初期化の script だけをここで作る。
 * 配る仕様は、npm run bundle が openapi/ から束ねた dist/openapi.yaml (モックと build-docs も同じファイルを読む)。
 * リクエストのたびに読み直すので、仕様を直したら npm run bundle を回してからブラウザで読み込み直せば反映される。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = 3903;
const spec = fileURLToPath(new URL('../../dist/openapi.yaml', import.meta.url));

/*
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

/*
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

createServer((req, res) => {
  /*
   * リクエストの対象は / で始まるパスとは限らず、*:99999 のように URL として読めないものも届く。
   * new URL は読めないと例外を投げ、この関数の外で処理されないまま、サーバーのプロセスが止まる。
   */
  const url = URL.parse(`http://localhost${req.url}`);
  if (url === null) return send(res, 400, 'text/plain; charset=utf-8', 'リクエストの対象を URL として読めません\n');
  const path = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  if (path === '/openapi.yaml') {
    // 束ねる前や dist/ を消した後に readFileSync が投げると、サーバーのプロセスが止まるので、先に有無を見る。
    if (!existsSync(spec)) return send(res, 500, 'text/plain; charset=utf-8', 'dist/openapi.yaml がありません。npm run bundle で作ってください\n');
    return send(res, 200, 'application/yaml', readFileSync(spec));
  }
  if (path === '/swagger-initializer.js') return send(res, 200, 'text/javascript; charset=utf-8', initializer);
  const name = path === '/' ? '/index.html' : path;
  const contentType = assets[name];
  if (contentType === undefined) return send(res, 404, 'text/plain; charset=utf-8', `${path} は見つかりません\n`);
  send(res, 200, contentType, readFileSync(join(dist, name)));
}).listen(port, () => {
  console.log(`Swagger UI を http://localhost:${port} で起動しました`);
});
