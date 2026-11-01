/**
 * Reference UI wire format: an agent message is optional prose followed by one
 * fenced block tagged `ui` holding a JSON node tree:
 *
 *   ```ui
 *   {"component":"Stack","props":{"children":[{"component":"Text","props":{"markdown":"Hi"}}]}}
 *   ```
 *
 * The worker emits OpenUI Lang instead; its adapter supplies its own `parseUi`
 * returning the same `UiNode` shape, so graders never depend on the wire format.
 */
import type { UiNode } from "./adapter";

const FENCE = /```ui\s*\n([\s\S]*?)```/g;

export class UiParseError extends Error {}

/** Prose outside the fences becomes a leading Text node, since the host renders it as one. */
export function parseJsonUi(text: string): UiNode[] {
  const prose = proseOf(text);
  const roots: UiNode[] = prose ? [{ component: "Text", props: { markdown: prose } }] : [];
  for (const match of text.matchAll(FENCE)) {
    let json: unknown;
    try {
      json = JSON.parse(match[1] ?? "");
    } catch (e) {
      throw new UiParseError(`ui block is not JSON: ${(e as Error).message}`);
    }
    for (const node of Array.isArray(json) ? json : [json]) roots.push(asNode(node));
  }
  return roots;
}

/** Prose outside the ui fences (rendered as markdown by the host). */
export function proseOf(text: string): string {
  return text.replace(FENCE, "").trim();
}

function asNode(value: unknown): UiNode {
  if (!value || typeof value !== "object" || typeof (value as UiNode).component !== "string") {
    throw new UiParseError(`not a ui node: ${JSON.stringify(value)?.slice(0, 120)}`);
  }
  const { component, props } = value as { component: string; props?: unknown };
  return { component, props: (props ?? {}) as Record<string, unknown> };
}

/** Depth-first walk over a node and its `children` (only Stack nests today). */
export function* walk(nodes: readonly UiNode[]): Generator<UiNode> {
  for (const node of nodes) {
    yield node;
    const children = node.props.children;
    if (Array.isArray(children)) {
      const kids = children.filter(
        (c): c is UiNode => !!c && typeof c === "object" && typeof c.component === "string",
      );
      yield* walk(kids.map((c) => ({ component: c.component, props: c.props ?? {} })));
    }
  }
}

/** Every human-readable string in a node's own props (not its children). */
export function textsOf(node: UiNode): string[] {
  const out: string[] = [];
  const visit = (v: unknown, key: string) => {
    if (key === "children" || key.endsWith("Ref") || key.endsWith("Refs")) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) visit(x, "");
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  for (const [k, v] of Object.entries(node.props)) visit(v, k);
  return out;
}
