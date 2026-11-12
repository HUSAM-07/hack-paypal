/**
 * Minimal RFC 6902 helpers for `state/patch`: the server diffs two JSON states, the client
 * applies the ops. Only plain JSON (objects, arrays, primitives) is supported.
 */
export type PatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown };

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const escapeToken = (t: string) => t.replaceAll("~", "~0").replaceAll("/", "~1");
const unescapeToken = (t: string) => t.replaceAll("~1", "/").replaceAll("~0", "~");

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** Ops that turn `from` into `to`. Arrays diff index-wise, so an appended item is one `add`. */
export function diffJson(from: unknown, to: unknown, path = ""): PatchOp[] {
  if (deepEqual(from, to)) return [];
  if (isObject(from) && isObject(to)) {
    const ops: PatchOp[] = [];
    for (const k of Object.keys(from)) {
      if (from[k] !== undefined && to[k] === undefined) {
        ops.push({ op: "remove", path: `${path}/${escapeToken(k)}` });
      }
    }
    for (const k of Object.keys(to)) {
      if (to[k] === undefined) continue;
      const p = `${path}/${escapeToken(k)}`;
      if (from[k] === undefined) ops.push({ op: "add", path: p, value: to[k] });
      else ops.push(...diffJson(from[k], to[k], p));
    }
    return ops;
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    const ops: PatchOp[] = [];
    const common = Math.min(from.length, to.length);
    for (let i = 0; i < common; i++) ops.push(...diffJson(from[i], to[i], `${path}/${i}`));
    for (let i = common; i < to.length; i++) {
      ops.push({ op: "add", path: `${path}/${i}`, value: to[i] });
    }
    // Remove from the end so earlier indexes stay valid while the ops apply in order.
    for (let i = from.length - 1; i >= to.length; i--)
      ops.push({ op: "remove", path: `${path}/${i}` });
    return ops;
  }
  return [{ op: "replace", path, value: to }];
}

function parsePath(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new Error(`invalid JSON pointer: ${path}`);
  return path.slice(1).split("/").map(unescapeToken);
}

/** Apply ops immutably. Throws on a path that doesn't exist (the client should resync). */
export function applyPatch<T>(
  doc: T,
  ops: readonly { op: string; path: string; value?: unknown }[],
): T {
  let root: unknown = structuredClone(doc);
  for (const op of ops) {
    const tokens = parsePath(op.path);
    if (tokens.length === 0) {
      if (op.op === "remove") throw new Error("cannot remove the root");
      root = structuredClone(op.value);
      continue;
    }
    const last = tokens[tokens.length - 1] as string;
    let parent: unknown = root;
    for (const t of tokens.slice(0, -1)) {
      parent = Array.isArray(parent) ? parent[Number(t)] : isObject(parent) ? parent[t] : undefined;
      if (parent === undefined) throw new Error(`path not found: ${op.path}`);
    }
    if (Array.isArray(parent)) {
      const i = last === "-" ? parent.length : Number(last);
      if (!Number.isInteger(i) || i < 0 || i > parent.length) {
        throw new Error(`bad index: ${op.path}`);
      }
      if (op.op === "add") parent.splice(i, 0, structuredClone(op.value));
      else if (op.op === "remove") parent.splice(i, 1);
      else if (op.op === "replace") parent[i] = structuredClone(op.value);
      else throw new Error(`unsupported op: ${op.op}`);
    } else if (isObject(parent)) {
      if (op.op === "add" || op.op === "replace") parent[last] = structuredClone(op.value);
      else if (op.op === "remove") delete parent[last];
      else throw new Error(`unsupported op: ${op.op}`);
    } else {
      throw new Error(`path not found: ${op.path}`);
    }
  }
  return root as T;
}
