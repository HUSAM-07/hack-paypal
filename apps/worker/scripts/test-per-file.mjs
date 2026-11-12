// Runs each worker test file in its own vitest process.
// In @cloudflare/vitest-plugin, the second test file to start in a pool worker crashes it
// ("Worker exited unexpectedly", WebSocket 1009 Message is too large) once the worker bundle
// passes a size threshold. Every file passes on its own, so give each file its own pool.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const files = readdirSync(path.join(root, "test"))
  .filter((f) => f.endsWith(".test.ts") && f !== "live.test.ts")
  .sort()
  .map((f) => `test/${f}`);
const parallel = Number(process.env.TEST_PARALLEL ?? 4);

function run(file) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("npx", ["vitest", "run", file], { cwd: root, env: process.env });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ file, code, out }));
  });
}

const queue = [...files];
const failed = [];
await Promise.all(
  Array.from({ length: parallel }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const r = await run(file);
      if (r.code === 0) console.log(`ok   ${file}`);
      else {
        failed.push(file);
        console.log(`FAIL ${file}\n${r.out}`);
      }
    }
  }),
);
console.log(`${files.length - failed.length}/${files.length} test files passed`);
process.exit(failed.length ? 1 : 0);
