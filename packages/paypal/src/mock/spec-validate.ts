/**
 * Test helper: validate a JSON body against the response schema of an operation in the
 * bundled official PayPal OpenAPI specs (`cited/paypal-openapi/`). Checks type, required
 * fields and enums (resolving $ref and allOf); ignores string patterns and lengths.
 */
import { readFileSync } from "node:fs";

type Schema = Record<string, unknown>;
type Doc = {
  paths: Record<string, Record<string, { responses?: Record<string, Schema> }>>;
  components: { schemas: Record<string, Schema> };
};

const docs = new Map<string, Doc>();
const specUrl = (name: string) =>
  new URL(`../../../../cited/paypal-openapi/${name}.json`, import.meta.url);

export function loadSpec(name: string): Doc {
  let d = docs.get(name);
  if (!d) {
    d = JSON.parse(readFileSync(decodeURIComponent(specUrl(name).pathname), "utf8")) as Doc;
    docs.set(name, d);
  }
  return d;
}

function resolve(doc: Doc, s: Schema): Schema {
  const ref = s.$ref as string | undefined;
  if (!ref) return s;
  const hit = doc.components.schemas[ref.replace("#/components/schemas/", "")];
  if (!hit) throw new Error(`unresolved ref ${ref}`);
  return resolve(doc, hit);
}

/** Collapse allOf into one flat view: merged properties, required, and the first type/enum. */
function flatten(doc: Doc, raw: Schema): Schema {
  const s = resolve(doc, raw);
  const parts = (s.allOf as Schema[] | undefined)?.map((p) => flatten(doc, p)) ?? [];
  const merged: Schema = {
    ...s,
    properties: { ...(s.properties as object) },
    required: [...((s.required as string[]) ?? [])],
  };
  for (const p of parts) {
    Object.assign(merged.properties as object, p.properties);
    (merged.required as string[]).push(...((p.required as string[]) ?? []));
    merged.type ??= p.type;
    merged.enum ??= p.enum;
    merged.items ??= p.items;
  }
  return merged;
}

export function validate(doc: Doc, raw: Schema, value: unknown, path = "$"): string[] {
  const s = flatten(doc, raw);
  const errs: string[] = [];
  if (s.enum && !(s.enum as unknown[]).includes(value))
    errs.push(`${path}: ${String(value)} not in enum`);
  const type = s.type as string | undefined;
  const kind = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (type === "object" || (!type && s.properties && Object.keys(s.properties as object).length)) {
    if (kind !== "object") return [`${path}: expected object, got ${kind}`];
    const obj = value as Record<string, unknown>;
    for (const r of s.required as string[]) if (!(r in obj)) errs.push(`${path}.${r}: required`);
    for (const [k, sub] of Object.entries(s.properties as Record<string, Schema>)) {
      if (k in obj) errs.push(...validate(doc, sub, obj[k], `${path}.${k}`));
    }
  } else if (type === "array") {
    if (kind !== "array") return [`${path}: expected array, got ${kind}`];
    if (s.items)
      for (const [i, v] of (value as unknown[]).entries()) {
        errs.push(...validate(doc, s.items as Schema, v, `${path}[${i}]`));
      }
  } else if (type === "string" && kind !== "string")
    errs.push(`${path}: expected string, got ${kind}`);
  else if ((type === "integer" || type === "number") && kind !== "number")
    errs.push(`${path}: expected number, got ${kind}`);
  else if (type === "boolean" && kind !== "boolean")
    errs.push(`${path}: expected boolean, got ${kind}`);
  return errs;
}

/** Validate `body` against the 2xx response schema of `method path` (path as written in the spec). */
export function validateResponse(
  spec: string,
  method: string,
  path: string,
  body: unknown,
): string[] {
  const doc = loadSpec(spec);
  const op = doc.paths[path]?.[method.toLowerCase()];
  if (!op) throw new Error(`${spec}: no ${method} ${path}`);
  const code = Object.keys(op.responses ?? {}).find((c) => c.startsWith("2"));
  const schema = (
    (op.responses as Record<string, unknown>)[code as string] as {
      content?: Record<string, { schema: Schema }>;
    }
  ).content?.["application/json"]?.schema;
  if (!schema) throw new Error(`${spec}: ${method} ${path} has no JSON response schema`);
  return validate(doc, schema, body);
}

/** Validate a body against a named component schema. */
export function validateSchema(spec: string, name: string, body: unknown): string[] {
  const doc = loadSpec(spec);
  return validate(doc, { $ref: `#/components/schemas/${name}` }, body);
}
