/*
 * 商品を ID と名前だけで持つ、手書きのサーバー。3 章でメソッドとステータスコードを観察するのに使う。
 * 設計した API ではない。何を受け付けて何を返すかは、このコードの中にしか書いていない。
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const port = 3902;

interface Product {
  id: string;
  name: string;
}

const products: Product[] = [
  { id: 'p-1', name: 'りんご' },
  { id: 'p-2', name: 'みかん' },
];
let nextNumber = 3;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** 本文を JSON で返す。HEAD のリクエストには、Node.js が本文を送らずにヘッダだけを返す。 */
function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(text)),
    ...headers,
  });
  res.end(text);
}

/** 本文の無い応答を返す。 */
function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, headers);
  res.end();
}

async function createProduct(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers['content-type'] !== 'application/json') {
    sendJson(res, 415, { message: '本文は application/json で送ってください' });
    return;
  }
  let input: unknown;
  try {
    input = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { message: '本文が JSON として読めません' });
    return;
  }
  const name = typeof input === 'object' && input !== null && 'name' in input ? input.name : undefined;
  if (typeof name !== 'string' || name === '') {
    sendJson(res, 400, { message: 'name を文字列で指定してください' });
    return;
  }
  const product = { id: `p-${nextNumber++}`, name };
  products.push(product);
  sendJson(res, 201, product, { Location: `/products/${product.id}` });
}

createServer(async (req, res) => {
  /*
   * リクエストの対象は / で始まるパスとは限らず、*:99999 のように URL として読めないものも届く。
   * new URL は読めないと例外を投げ、この async の関数の外で処理されないまま、サーバーのプロセスが止まる。
   */
  const url = URL.parse(`http://localhost${req.url}`);
  if (url === null) return sendJson(res, 400, { message: 'リクエストの対象を URL として読めません' });
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/products') {
    const allow = 'GET, HEAD, POST, OPTIONS';
    if (method === 'GET' || method === 'HEAD') return sendJson(res, 200, products);
    if (method === 'POST') return createProduct(req, res);
    if (method === 'OPTIONS') return sendEmpty(res, 204, { Allow: allow });
    return sendJson(res, 405, { message: `${method} はこの URL で使えません` }, { Allow: allow });
  }

  const match = /^\/products\/([^/]+)$/.exec(path);
  if (match) {
    const allow = 'GET, HEAD, OPTIONS';
    if (method === 'OPTIONS') return sendEmpty(res, 204, { Allow: allow });
    if (method !== 'GET' && method !== 'HEAD') {
      return sendJson(res, 405, { message: `${method} はこの URL で使えません` }, { Allow: allow });
    }
    const product = products.find((p) => p.id === match[1]);
    if (product === undefined) return sendJson(res, 404, { message: `商品 ${match[1]} は見つかりません` });
    return sendJson(res, 200, product);
  }

  sendJson(res, 404, { message: `${path} は見つかりません` });
}).listen(port, () => {
  console.log(`商品のサーバーを http://localhost:${port} で起動しました`);
});
