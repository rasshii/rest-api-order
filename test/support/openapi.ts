/*
 * 注文 API の仕様 (openapi/ に分けたもの) を読み、テストから使える形にする処理。
 * 仕様のファイルの置き方を変えたら、読み方はここだけを直す。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import { parse } from 'yaml';
import { runRedocly } from './redocly.ts';

/*
 * 分けた仕様を一時のファイルに束ね、内部の参照 ('#/components/...') だけを持つ 1 つの文書にして返す。
 * npm run bundle が作る dist/ は読まない。元を直して束ね直し忘れると、テストが古い仕様を確かめて通るため。
 * entry はリポジトリの root からの相対パス。照合の土台の自己テストは、試しの仕様 (test/fixtures/) を渡す。
 */
export function loadSpec(entry = 'openapi/openapi.yaml'): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'rest-api-order-spec-'));
  try {
    const out = join(dir, 'openapi.yaml');
    const result = runRedocly(['bundle', entry, '--output', out]);
    if (result.status !== 0) throw new Error(`仕様を束ねられない:\n${result.stderr}`);
    return parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 値の中の、名前で並ぶオブジェクト (paths・components の各部など)。無ければ空。 */
export function entries(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : [];
}

/** Path Item で操作を表すフィールド (OpenAPI 3.1 の HTTP のメソッド)。 */
export const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** '#/components/<種類>/<名前>' の参照なら名前を、そうでなければ undefined を返す。 */
export function refName(value: unknown, kind: string): string | undefined {
  if (!isRecord(value) || typeof value.$ref !== 'string') return undefined;
  const prefix = `#/components/${kind}/`;
  return value.$ref.startsWith(prefix) ? value.$ref.slice(prefix.length) : undefined;
}

/** 操作の requestBody と応答 (部品の応答の参照もたどる) の Media Type Object を、置き場の名前とともに返す。 */
export function mediaTypes(spec: unknown): { where: string; media: unknown }[] {
  const found: { where: string; media: unknown }[] = [];
  const paths = isRecord(spec) ? spec.paths : undefined;
  for (const [path, item] of entries(paths)) {
    for (const [method, operation] of entries(item).filter(([key]) => methods.includes(key))) {
      const where = `${method.toUpperCase()} ${path}`;
      const body = isRecord(operation) ? operation.requestBody : undefined;
      for (const [type, media] of entries(isRecord(body) ? body.content : undefined)) {
        found.push({ where: `${where} のリクエストの ${type}`, media });
      }
      for (const [code, response] of entries(isRecord(operation) ? operation.responses : undefined)) {
        const resolved = resolveResponse(spec, response);
        for (const [type, media] of entries(isRecord(resolved) ? resolved.content : undefined)) {
          found.push({ where: `${where} の ${code} の ${type}`, media });
        }
      }
    }
  }
  return found;
}

/** 応答 (Response Object か、'#/components/responses/<名前>' の参照) を、参照をたどった Response Object にする。 */
export function resolveResponse(spec: unknown, response: unknown): unknown {
  const name = refName(response, 'responses');
  if (name === undefined) return response;
  const components = isRecord(spec) && isRecord(spec.components) ? spec.components : {};
  return isRecord(components.responses) ? components.responses[name] : undefined;
}

/** 文書の中の参照 ('#/...') を、検証器に登録した文書 (openapi.json) の中の参照に書き換える。 */
function rebase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rebase);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, key === '$ref' && typeof v === 'string' && v.startsWith('#/') ? `openapi.json${v}` : rebase(v)]),
  );
}

/*
 * 仕様の components/schemas の部品を JSON Schema 2020-12 の検証器に登録する。部品の名前で検証の関数を引く byName と、
 * 仕様の中のスキーマ (部品への '#/components/schemas/<名前>' の参照を含んでよい) をコンパイルする compile を返す。
 * 仕様の文書は JSON Schema ではない (openapi・paths などを持つ) ので、components/schemas だけを持つ文書に包んで登録する。
 * 部品どうしの参照は、包んだ文書の中で解決する。format (email・date-time など) も検証する。
 */
export function componentsValidator(spec: unknown): { byName: (name: string) => ValidateFunction; compile: (schema: unknown) => ValidateFunction } {
  const schemas = (spec as { components?: { schemas?: unknown } }).components?.schemas;
  if (typeof schemas !== 'object' || schemas === null) throw new Error('仕様に components/schemas が無い');
  const ajv = new Ajv2020({ allErrors: true });
  formats.default(ajv);
  // 包んだ文書の最上位の components は、JSON Schema のキーワードでないことを検証器に知らせる。
  ajv.addVocabulary(['components']);
  ajv.addSchema({ $id: 'openapi.json', components: { schemas } });
  return {
    byName: (name) => {
      const validate = ajv.getSchema(`openapi.json#/components/schemas/${name}`);
      if (validate === undefined) throw new Error(`仕様の components/schemas に ${name} が無い`);
      return validate;
    },
    compile: (schema) => ajv.compile(rebase(schema) as object),
  };
}

/** 部品の名前で検証の関数を返す (componentsValidator の byName)。 */
export function schemaValidator(spec: unknown): (name: string) => ValidateFunction {
  return componentsValidator(spec).byName;
}
