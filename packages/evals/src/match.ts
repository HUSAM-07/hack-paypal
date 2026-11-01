/**
 * Subset matching for tool-argument expectations.
 *
 *   plain value      equal (strings compare case-insensitively)
 *   object           every listed key matches; extra keys in the actual are fine
 *   array            same length, element-wise in order
 *   {"$unordered":[…]}  same length, each expected matches a distinct actual element
 *   {"$in":[…]}         equals one of the values
 *   {"$between":[a,b]}  number in [a,b], or ISO timestamps compared by time
 *   {"$exists":bool}    key present (or absent)
 *   {"$regex":"…"}      string matches (case-insensitive)
 *   {"$any":true}       anything
 */
export function match(actual: unknown, expected: unknown, path = "$"): string[] {
  if (isOp(expected)) return matchOp(actual, expected, path);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected array, got ${show(actual)}`];
    if (actual.length !== expected.length) {
      return [`${path}: expected ${expected.length} elements, got ${actual.length}`];
    }
    return expected.flatMap((e, i) => match(actual[i], e, `${path}[${i}]`));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return [`${path}: expected object, got ${show(actual)}`];
    }
    return Object.entries(expected).flatMap(([k, e]) => {
      const a = (actual as Record<string, unknown>)[k];
      if (isOp(e) && "$exists" in e) return matchOp(a, e, `${path}.${k}`, k in actual);
      return match(a, e, `${path}.${k}`);
    });
  }
  if (typeof expected === "string" && typeof actual === "string") {
    return expected.toLowerCase() === actual.toLowerCase()
      ? []
      : [`${path}: expected "${expected}", got "${actual}"`];
  }
  return Object.is(actual, expected)
    ? []
    : [`${path}: expected ${show(expected)}, got ${show(actual)}`];
}

type Op = Record<`$${string}`, unknown>;

function isOp(v: unknown): v is Op {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0]?.startsWith("$") === true;
}

function matchOp(actual: unknown, op: Op, path: string, present = actual !== undefined): string[] {
  const [name, arg] = Object.entries(op)[0] as [string, unknown];
  switch (name) {
    case "$any":
      return [];
    case "$exists":
      return present === arg ? [] : [`${path}: expected ${arg ? "present" : "absent"}`];
    case "$in":
      return (arg as unknown[]).some((v) => match(actual, v, path).length === 0)
        ? []
        : [`${path}: ${show(actual)} not in ${show(arg)}`];
    case "$regex":
      return typeof actual === "string" && new RegExp(arg as string, "i").test(actual)
        ? []
        : [`${path}: ${show(actual)} does not match /${arg}/`];
    case "$between": {
      const [lo, hi] = arg as [number | string, number | string];
      const n = toNumber(actual);
      if (n === undefined) return [`${path}: expected number or timestamp, got ${show(actual)}`];
      return n >= (toNumber(lo) ?? Number.NaN) && n <= (toNumber(hi) ?? Number.NaN)
        ? []
        : [`${path}: ${show(actual)} not in [${lo}, ${hi}]`];
    }
    case "$unordered": {
      const expected = arg as unknown[];
      if (!Array.isArray(actual)) return [`${path}: expected array, got ${show(actual)}`];
      if (actual.length !== expected.length) {
        return [`${path}: expected ${expected.length} elements, got ${actual.length}`];
      }
      const used = new Set<number>();
      const errors: string[] = [];
      expected.forEach((e, i) => {
        const j = actual.findIndex((a, k) => !used.has(k) && match(a, e).length === 0);
        if (j === -1) errors.push(`${path}: no element matches expected[${i}] ${show(e)}`);
        else used.add(j);
      });
      return errors;
    }
    default:
      return [`${path}: unknown matcher ${name}`];
  }
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

function show(v: unknown): string {
  return JSON.stringify(v)?.slice(0, 160) ?? "undefined";
}
