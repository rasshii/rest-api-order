/*
 * 文書 (Markdown) の表を、テストが行ごとに読める形にする処理。
 */

/** 表の本体の行 (見出しの行 header と区切りの行の次から、空行の前まで)。形の合わない行を数えられるよう、正規表現で拾う前の行を返す。 */
export function tableLines(text: string, header: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(header);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.trim() === '');
  return lines.slice(start + 2, end < 0 ? undefined : end);
}

/** 表の行を pattern で拾い、拾えない行は problems に足す。拾えない行が黙って抜けないよう、形の確かめと一緒に行う。 */
export function rows<T>(text: string, header: string, pattern: RegExp, toRow: (match: RegExpExecArray) => T, problems: string[]): T[] {
  const lines = tableLines(text, header);
  if (lines.length === 0) problems.push(`表 ${header} が無いか、行が無い`);
  return lines.flatMap((line) => {
    const match = pattern.exec(line);
    if (match === null) {
      problems.push(`形の合わない行: ${line}`);
      return [];
    }
    return [toRow(match)];
  });
}
