// Writes packages/agent-protocol/schema/ from the zod protocol. Run: npm run gen -w @shop/agent-protocol
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatSchemaFile, protocolJsonSchemas } from "../src/schema";

const root = path.join(import.meta.dirname, "..", "schema");
rmSync(root, { recursive: true, force: true });
const files = protocolJsonSchemas();
for (const [rel, doc] of Object.entries(files)) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, formatSchemaFile(doc));
}
console.log(
  `wrote ${Object.keys(files).length} schema files to ${path.relative(process.cwd(), root)}`,
);
