/*
 * 実行のたびに変わる値を、記事と期待値のファイル (.out) に載せる固定の値に置き換える規則。
 * 規則は当たる行の形まで書く。広い正規表現にすると、比べたい値まで置き換えて食い違いを見逃す。
 */
const rules: { pattern: RegExp; replacement: string }[] = [
  // HTTP の応答の Date ヘッダ (curl -i・-I の出力)
  { pattern: /^Date: [A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/gm, replacement: 'Date: Sat, 31 Oct 2026 09:00:00 GMT' },
];

/**
 * 実際の出力を、期待値と比べる形にそろえる。
 * curl の -i・-I はヘッダの行を CRLF で出すが、期待値のファイルは LF に固定しているので、先に LF にそろえる。
 */
export function normalizeOutput(text: string): string {
  let result = text.replace(/\r\n/g, '\n');
  for (const rule of rules) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}
