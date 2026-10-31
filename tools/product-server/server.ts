/*
 * 商品を ID と名前だけで持つ、手書きのサーバー。3 章でメソッドとステータスコードを観察し、
 * 7 章でリソースの URL と RPC 風の口 (/rpc) を呼び比べるのに使う。
 * 設計した API ではない。何を受け付けて何を返すかは、このコードの中にしか書いていない。
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';

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

/**
 * 本文を JSON で返す。HEAD のリクエストには、Node.js が本文を送らずにヘッダだけを返す。
 * Content-Length を書くのは、HEAD の応答にも GET と同じ長さを載せるため。書かないと Node.js は本文を chunked で送り、
 * HEAD の応答に長さが出ない。
 */
function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(json)),
    ...headers,
  });
  res.end(json);
}

function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string>): void {
  res.writeHead(status, headers);
  res.end();
}

/** type と subtype は大文字小文字を区別しない (RFC 9110 の 8.3.1) ので、パラメータ (; charset=utf-8 など) を除いて小文字で比べる。 */
function isJson(contentType: string | undefined): boolean {
  return contentType?.split(';')[0].trim().toLowerCase() === 'application/json';
}

/** JSON として読んだ値から、key の値を取り出す。オブジェクトでないか、key が無ければ undefined。 */
function fieldOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

function addProduct(name: string): Product {
  const product = { id: `p-${nextNumber++}`, name };
  products.push(product);
  return product;
}

async function createProduct(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isJson(req.headers['content-type'])) {
    sendJson(res, 415, { message: '本文は application/json で送ってください' });
    return;
  }
  let body: string;
  try {
    body = await text(req);
  } catch {
    // 本文を受け取る途中で接続が切れた。応答を返す相手がいないので、接続を閉じて終える。
    res.destroy();
    return;
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    sendJson(res, 400, { message: '本文が JSON として読めません' });
    return;
  }
  const name = fieldOf(input, 'name');
  if (typeof name !== 'string' || name === '') {
    sendJson(res, 400, { message: 'name を文字列で指定してください' });
    return;
  }
  const product = addProduct(name);
  sendJson(res, 201, product, { Location: `/products/${product.id}` });
}

/*
 * RPC 風の口。取得も作成も POST /rpc に送り、何をするかを本文の call で指定する。
 * 結果も失敗も 200 で返し、本文の result と error のどちらがあるかで見分ける。
 */
async function callRpc(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: string;
  try {
    body = await text(req);
  } catch {
    // 本文を受け取る途中で接続が切れた。応答を返す相手がいないので、接続を閉じて終える。
    res.destroy();
    return;
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    sendJson(res, 200, { error: { message: '本文が JSON として読めません' } });
    return;
  }
  /*
   * call と id には JSON のどの値も届く。文字列でない値を文に埋めると、{"toString":0} のようなオブジェクトでは
   * 文字列に変える途中で例外が出て、この async の関数の外で処理されないまま、サーバーのプロセスが止まる。
   */
  const call = fieldOf(input, 'call');
  if (typeof call !== 'string') {
    sendJson(res, 200, { error: { message: 'call を文字列で指定してください' } });
    return;
  }
  if (call === 'getProduct') {
    const id = fieldOf(input, 'id');
    if (typeof id !== 'string') {
      sendJson(res, 200, { error: { message: 'id を文字列で指定してください' } });
      return;
    }
    const product = products.find((p) => p.id === id);
    if (product === undefined) {
      sendJson(res, 200, { error: { message: `商品 ${id} は見つかりません` } });
      return;
    }
    sendJson(res, 200, { result: product });
    return;
  }
  if (call === 'createProduct') {
    const name = fieldOf(input, 'name');
    if (typeof name !== 'string' || name === '') {
      sendJson(res, 200, { error: { message: 'name を文字列で指定してください' } });
      return;
    }
    sendJson(res, 200, { result: addProduct(name) });
    return;
  }
  sendJson(res, 200, { error: { message: `${call} という呼び出しはありません` } });
}

createServer(async (req, res) => {
  // http.Server が渡すリクエストには、method と url が必ずある (型が省略可なのは、クライアントが受ける応答と型を共用するため)。
  const method = req.method!;
  const target = req.url!;
  /*
   * リクエストの対象は、/ で始まるパス (origin-form) のほかに、http://… の絶対形式 (absolute-form) でも届き、
   * サーバーは絶対形式も受け付ける (RFC 9112 の 3.2.2)。/ で始まる対象を基準の URL に対して解決すると、// で始まるパスを
   * 別のホストと読むので、パスには localhost を前に付ける。
   * *:99999 のように URL として読めないものも届く。new URL は読めないと例外を投げ、この async の関数の外で
   * 処理されないまま、サーバーのプロセスが止まるので、読めなければ null を返す URL.parse を使う。
   */
  const url = target.startsWith('/') ? URL.parse(`http://localhost${target}`) : URL.parse(target);
  if (url === null) return sendJson(res, 400, { message: 'リクエストの対象を URL として読めません' });
  const path = url.pathname;

  if (path === '/products') {
    const allow = 'GET, HEAD, POST, OPTIONS';
    if (method === 'GET' || method === 'HEAD') return sendJson(res, 200, products);
    if (method === 'POST') return createProduct(req, res);
    if (method === 'OPTIONS') return sendEmpty(res, 204, { Allow: allow });
    return sendJson(res, 405, { message: `${method} はこの URL で使えません` }, { Allow: allow });
  }

  if (path === '/rpc') {
    const allow = 'POST, OPTIONS';
    if (method === 'POST') return callRpc(req, res);
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
