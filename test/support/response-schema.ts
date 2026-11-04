/*
 * 値を作るモック (Prism の --dynamic) の応答を、値でなく仕様のスキーマで確かめる処理。
 * 記事の curl (-i -w '\n%{http_code}\n' の形) の出力から、ステータスコード・Content-Type・本文を読み、
 * curl のメソッドと URL のパスで仕様の操作を探し、その応答の本文のスキーマで本文を検証する。
 * どの段でもスキーマが見つからなければ食い違いとして返す。空のスキーマで検証して通ることを防ぐため。
 */
import { componentsValidator, entries, isRecord, resolveResponse } from './openapi.ts';
import { curlUrls, curlWords } from './snippets.ts';

export interface CurlRequest {
  method: string;
  path: string;
}

export interface CurlResponse {
  status: number;
  contentType: string | undefined;
  body: string;
}

/** curl のコマンドから、送るメソッドと送り先の URL のパスを読む。語の分け方と URL の見分け方は snippets.ts と同じ。 */
export function parseCurlRequest(command: string): CurlRequest {
  const args = curlWords(command);
  if (args[0] !== 'curl') throw new Error(`curl のコマンドでない: ${command}`);
  const [url] = curlUrls(command);
  if (url === undefined) throw new Error(`URL が無い: ${command}`);
  const explicit = args.findIndex((arg) => arg === '-X' || arg === '--request');
  let method = 'GET';
  if (explicit !== -1) method = args[explicit + 1];
  else if (args.some((arg) => arg === '-I' || arg === '--head')) method = 'HEAD';
  else if (args.some((arg) => ['-d', '--data', '--data-raw', '--json'].includes(arg))) method = 'POST';
  return { method: method.toUpperCase(), path: url.pathname };
}

/**
 * curl -i -w '\n%{http_code}\n' の出力を、ステータスコード・Content-Type・本文に分ける。
 * ヘッダの最初の行と、-w で最後の行に出したステータスコードが食い違えば例外にする (読み方の誤りに気づくため)。
 */
export function parseCurlResponse(stdout: string): CurlResponse {
  const text = stdout.replace(/\r\n/g, '\n');
  const end = text.indexOf('\n\n');
  if (!text.startsWith('HTTP/') || end === -1) throw new Error('出力がヘッダから始まっていない (curl に -i が要る)');
  const [statusLine, ...headerLines] = text.slice(0, end).split('\n');
  const status = Number(statusLine.split(' ')[1]);
  const rest = text.slice(end + 2).replace(/\n+$/, '');
  const cut = rest.lastIndexOf('\n');
  const written = cut === -1 ? rest : rest.slice(cut + 1);
  if (written !== String(status)) {
    throw new Error(`最後の行 (${written}) が、ヘッダのステータスコード (${status}) と違う (curl に -w '\\n%{http_code}\\n' が要る)`);
  }
  const header = headerLines.find((line) => /^content-type:/i.test(line));
  const contentType = header?.slice(header.indexOf(':') + 1).split(';')[0].trim().toLowerCase();
  return { status, contentType, body: cut === -1 ? '' : rest.slice(0, cut) };
}

/** パスのテンプレート (/orders/{orderId}) が、送ったパスに合うか。変数は / を含まない 1 つ以上の文字に合わせる。 */
function matchesTemplate(template: string, path: string): boolean {
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => (part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${pattern}$`).test(path);
}

/**
 * 仕様から、その応答の本文のスキーマを探す。見つからなければ、どの段で見つからないかを文で返す。
 * 応答のキーは、ステータスコードそのものか範囲 (4XX など) を探す。default は探さない
 * (default に当たると、仕様に無いステータスコードの応答が通ってしまうため)。
 */
export function findResponseSchema(spec: unknown, request: CurlRequest, response: CurlResponse): { schema: unknown } | { problem: string } {
  const where = `${request.method} ${request.path}`;
  const paths = isRecord(spec) ? spec.paths : undefined;
  // 変数の少ないテンプレートを先にする (静的なパスを、同じ形の変数のパスより先に当てる)。
  const templates = entries(paths)
    .filter(([template]) => matchesTemplate(template, request.path))
    .sort(([a], [b]) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0));
  if (templates.length === 0) return { problem: `${where}: 仕様にこのパスが無い` };
  const [template, item] = templates[0];
  const operation = isRecord(item) ? item[request.method.toLowerCase()] : undefined;
  if (!isRecord(operation)) return { problem: `${where}: 仕様の ${template} にメソッド ${request.method} が無い` };
  const responses = isRecord(operation.responses) ? operation.responses : {};
  const code = String(response.status);
  const declared = responses[code] ?? responses[`${code[0]}XX`];
  if (declared === undefined) return { problem: `${where}: 仕様の ${template} の ${request.method} にステータスコード ${code} が無い` };
  const resolved = resolveResponse(spec, declared);
  const content = isRecord(resolved) && isRecord(resolved.content) ? resolved.content : {};
  if (response.contentType === undefined) return { problem: `${where} の ${code}: 応答に Content-Type ヘッダが無い` };
  const media = content[response.contentType];
  if (!isRecord(media)) return { problem: `${where} の ${code}: 仕様に ${response.contentType} の本文が無い` };
  if (!isRecord(media.schema) || Object.keys(media.schema).length === 0) {
    return { problem: `${where} の ${code} の ${response.contentType}: 仕様に本文のスキーマが無い` };
  }
  return { schema: media.schema };
}

/**
 * 仕様を受け取り、curl のコマンドとその出力を、仕様の応答のスキーマで確かめる関数を返す。
 * 返す関数は、食い違いを文の配列で返す (食い違いが無ければ空)。検証器は openapi.ts の componentsValidator を使う。
 */
export function responseChecker(spec: unknown): (command: string, stdout: string) => string[] {
  const validator = componentsValidator(spec);
  return (command, stdout) => {
    const request = parseCurlRequest(command);
    const response = parseCurlResponse(stdout);
    const found = findResponseSchema(spec, request, response);
    if ('problem' in found) return [found.problem];
    let body: unknown;
    try {
      body = JSON.parse(response.body);
    } catch {
      return [`${request.method} ${request.path} の ${response.status}: 本文を JSON として読めない`];
    }
    const validate = validator.compile(found.schema);
    if (validate(body)) return [];
    return (validate.errors ?? []).map(
      (e) => `${request.method} ${request.path} の ${response.status}: ${e.instancePath || '/'} ${e.message ?? e.keyword}`,
    );
  };
}
