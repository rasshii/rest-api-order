/*
 * 注文 API の仕様 (openapi/openapi.yaml) を読み、テストから使える形にする処理。
 * 仕様のファイルの置き方を変えたら、読み方はここだけを直す。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import { parse } from 'yaml';

export function loadSpec(): unknown {
  return parse(readFileSync(fileURLToPath(new URL('../../openapi/openapi.yaml', import.meta.url)), 'utf8'));
}

/*
 * 仕様の components/schemas の部品を JSON Schema 2020-12 の検証器に登録し、部品の名前で検証の関数を返す。
 * 仕様の文書は JSON Schema ではない (openapi・paths などを持つ) ので、components/schemas だけを持つ文書に包んで登録する。
 * 部品どうしの '#/components/schemas/<名前>' の参照は、包んだ文書の中で解決する。format (email・date-time など) も検証する。
 */
export function schemaValidator(spec: unknown): (name: string) => ValidateFunction {
  const schemas = (spec as { components?: { schemas?: unknown } }).components?.schemas;
  if (typeof schemas !== 'object' || schemas === null) throw new Error('仕様に components/schemas が無い');
  const ajv = new Ajv2020({ allErrors: true });
  formats.default(ajv);
  // 包んだ文書の最上位の components は、JSON Schema のキーワードでないことを検証器に知らせる。
  ajv.addVocabulary(['components']);
  ajv.addSchema({ $id: 'openapi.json', components: { schemas } });
  return (name) => {
    const validate = ajv.getSchema(`openapi.json#/components/schemas/${name}`);
    if (validate === undefined) throw new Error(`仕様の components/schemas に ${name} が無い`);
    return validate;
  };
}
