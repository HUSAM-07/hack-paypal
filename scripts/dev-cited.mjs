// Starts every CITED app together, forcing the keyless modes. Ctrl-C stops all.
import { spawn } from "node:child_process";

const apps = [
  ["engine", "@cited/engine", 8800],
  ["catalogue-mcp", "@cited/catalogue-mcp", 8801],
  ["shops", "@cited/shops", 8802],
  ["agents", "@cited/agents", 8803],
  ["studio", "@cited/studio", 8804],
];

const env = {
  ...process.env,
  PAYPAL_MODE: "simulated",
  MODEL_PROVIDER: "fake",
  // The shops' PayPal mock delivers its webhooks here.
  ENGINE_URL: "http://localhost:8800",
};
const children = apps.map(([name, workspace, port]) => {
  const child = spawn("npm", ["run", "dev", "-w", workspace], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = `[${name}:${port}]`;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) console.log(`${tag} ${line}`);
    });
  }
  child.on("exit", (code) => console.log(`${tag} exited (${code})`));
  return child;
});

const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
