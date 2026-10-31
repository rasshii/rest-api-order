import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * 期待値のファイル (.out) が無いときに書き出さず、失敗にする。書き出すのは -u を付けたときだけにする。
     * 指定しないと、CI でない手元の実行では、無いファイルを黙って書き出して通る。
     */
    update: 'none',
    // snippets のテストは記事と同じ固定のポートでサーバーを起動するので、テストのファイルを並列に走らせない。
    fileParallelism: false,
  },
});
