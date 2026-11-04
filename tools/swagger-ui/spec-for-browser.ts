/*
 * Swagger UI の配信のサーバーが配る仕様を作る処理。束ねた仕様の servers の先頭にモック (npm run mock) を足す。
 * 仕様のファイルには書かない。仕様の servers は API を置く場所を表し、手元のモックの URL は、仕様を読む人の誰にでも当てはまる場所ではないため。
 */
import { parse, stringify } from 'yaml';

/** Prism は 127.0.0.1 で待ち受けるので、localhost (::1 に解決されうる) でなく 127.0.0.1 と書く。 */
export const mockServer = { url: 'http://127.0.0.1:3904', description: 'モック (npm run mock)' };

/** 束ねた仕様の文字列を受け取り、servers の先頭にモックを足した文字列を返す。servers が無ければモックだけを置く。キーと値の組の文書でないか、servers があって配列でなければ (null を含む) 例外にする。 */
export function specForBrowser(text: string): string {
  const document: unknown = parse(text);
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error('仕様が、キーと値の組の文書でない');
  }
  const servers = 'servers' in document ? document.servers : [];
  if (!Array.isArray(servers)) throw new Error('仕様の servers が配列でない');
  return stringify({ ...document, servers: [mockServer, ...servers] });
}
