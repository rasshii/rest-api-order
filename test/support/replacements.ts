/*
 * 実行のたびに変わる値を、記事と期待値のファイル (.out) に載せる固定の値に置き換える規則。
 * 規則は当たる行の形まで書く。広い正規表現にすると、比べたい値まで置き換えて食い違いを見逃す。
 */
type Replacement = string | ((line: string, ...groups: string[]) => string);

const rules: { pattern: RegExp; replacement: Replacement }[] = [
  // HTTP の応答の Date ヘッダ (curl -i・-I の出力)
  { pattern: /^Date: [A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/gm, replacement: 'Date: Sat, 31 Oct 2026 09:00:00 GMT' },
  /*
   * Redocly CLI の lint と bundle の所要時間。NODE_ENV が test のとき (Vitest はそうする) は、数でなく <test> と出す。
   * テストの中でも読者の端末でも同じ期待値になるよう、どちらも同じ値にそろえる。
   */
  { pattern: /^(\S+): validated in (?:\d+|<test>)ms$/gm, replacement: '$1: validated in 35ms' },
  { pattern: /^📦 Created a bundle for (\S+) at (\S+) (?:\d+|<test>)ms\.$/gm, replacement: '📦 Created a bundle for $1 at $2 12ms.' },
  // Bruno CLI の bru run の、リクエストごとの所要時間 (「place-order/accepted (201 Created) - 12 ms」の行)
  { pattern: /^([\w./-]+) \((\d{3} [A-Za-z -]+)\) - \d+ ms$/gm, replacement: '$1 ($2) - 3 ms' },
  /*
   * bru run の最後の表の、全体の所要時間の行。値は列の中で中央に寄せて出るので、桁で前後の空白が変わる。
   * 列の幅 (行の長さ) は変えずに、値だけを 1 つに決めて中央に置き直す。
   */
  {
    pattern: /^│ Duration \(ms\) │( +)(\d+)( +)│$/gm,
    replacement: (_line: string, before: string, digits: string, after: string) => {
      const width = before.length + digits.length + after.length;
      const value = '80';
      const left = Math.floor((width - value.length) / 2);
      return `│ Duration (ms) │${' '.repeat(left)}${value}${' '.repeat(width - value.length - left)}│`;
    },
  },
];

/**
 * 実際の出力を、期待値と比べる形にそろえる。
 * curl の -i・-I はヘッダの行を CRLF で出すが、期待値のファイルは LF に固定しているので、先に LF にそろえる。
 */
export function normalizeOutput(text: string): string {
  let result = text.replace(/\r\n/g, '\n');
  for (const { pattern, replacement } of rules) {
    result = typeof replacement === 'string' ? result.replace(pattern, replacement) : result.replace(pattern, replacement);
  }
  return result;
}
