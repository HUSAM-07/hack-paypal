/**
 * RFC 6902 JSON Patch, applied immutably: every container on a changed path is copied, the rest
 * is shared, so React sees new references exactly where state changed. Throws on an invalid op;
 * the caller then asks for a fresh snapshot instead of guessing.
 */
export type PatchOp = {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string | undefined;
  value?: unknown;
};

export class PatchError extends Error {}

function parsePointer(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new PatchError(`Invalid JSON pointer: ${path}`);
  return path
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

type Container = Record<string, unknown> | unknown[];

function isContainer(v: unknown): v is Container {
  return typeof v === "object" && v !== null;
}

function get(doc: unknown, tokens: string[]): unknown {
  let cur = doc;
  for (const t of tokens) {
    if (Array.isArray(cur)) {
      const i = Number(t);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) throw new PatchError(`No index ${t}`);
      cur = cur[i];
    } else if (isContainer(cur) && Object.hasOwn(cur, t)) {
      cur = (cur as Record<string, unknown>)[t];
    } else {
      throw new PatchError(`Path not found at ${t}`);
    }
  }
  return cur;
}

/** Copy containers along `tokens[0..n-1]` and run `edit` on the (copied) parent. */
function update(
  doc: unknown,
  tokens: string[],
  edit: (parent: Container, key: string) => void,
): unknown {
  if (tokens.length === 0) throw new PatchError("Root edits are handled by the caller");
  const [head, ...rest] = tokens as [string, ...string[]];
  if (!isContainer(doc)) throw new PatchError(`Not a container at ${head}`);
  const copy: Container = Array.isArray(doc) ? [...doc] : { ...doc };
  if (rest.length === 0) {
    edit(copy, head);
    return copy;
  }
  const child = Array.isArray(copy) ? copy[Number(head)] : (copy as Record<string, unknown>)[head];
  if (child === undefined) throw new PatchError(`Path not found at ${head}`);
  const next = update(child, rest, edit);
  if (Array.isArray(copy)) copy[Number(head)] = next;
  else (copy as Record<string, unknown>)[head] = next;
  return copy;
}

function arrayIndex(arr: unknown[], key: string, forInsert: boolean): number {
  if (forInsert && key === "-") return arr.length;
  const i = Number(key);
  const max = forInsert ? arr.length : arr.length - 1;
  if (!/^(0|[1-9]\d*)$/.test(key) || i > max) throw new PatchError(`Bad array index ${key}`);
  return i;
}

function add(doc: unknown, tokens: string[], value: unknown): unknown {
  if (tokens.length === 0) return value;
  return update(doc, tokens, (parent, key) => {
    if (Array.isArray(parent)) parent.splice(arrayIndex(parent, key, true), 0, value);
    else parent[key] = value;
  });
}

function remove(doc: unknown, tokens: string[]): unknown {
  if (tokens.length === 0) throw new PatchError("Cannot remove the root");
  return update(doc, tokens, (parent, key) => {
    if (Array.isArray(parent)) parent.splice(arrayIndex(parent, key, false), 1);
    else {
      if (!Object.hasOwn(parent, key)) throw new PatchError(`Nothing to remove at ${key}`);
      delete parent[key];
    }
  });
}

function replace(doc: unknown, tokens: string[], value: unknown): unknown {
  if (tokens.length === 0) return value;
  return update(doc, tokens, (parent, key) => {
    if (Array.isArray(parent)) parent[arrayIndex(parent, key, false)] = value;
    else {
      if (!Object.hasOwn(parent, key)) throw new PatchError(`Nothing to replace at ${key}`);
      parent[key] = value;
    }
  });
}

export function applyPatch<T>(doc: T, ops: readonly PatchOp[]): T {
  let cur: unknown = doc;
  for (const op of ops) {
    const path = parsePointer(op.path);
    switch (op.op) {
      case "add":
        cur = add(cur, path, op.value);
        break;
      case "remove":
        cur = remove(cur, path);
        break;
      case "replace":
        cur = replace(cur, path, op.value);
        break;
      case "move": {
        const from = parsePointer(op.from ?? "");
        const v = get(cur, from);
        cur = add(remove(cur, from), path, v);
        break;
      }
      case "copy": {
        const v = get(cur, parsePointer(op.from ?? ""));
        cur = add(cur, path, structuredClone(v));
        break;
      }
      case "test":
        if (JSON.stringify(get(cur, path)) !== JSON.stringify(op.value))
          throw new PatchError(`Test failed at ${op.path}`);
        break;
    }
  }
  return cur as T;
}
