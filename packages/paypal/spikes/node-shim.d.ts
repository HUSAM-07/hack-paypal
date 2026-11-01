// Minimal Node typings for the spike scripts; the package itself targets Workers and
// doesn't depend on @types/node.
declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
  loadEnvFile(path: string): void;
};

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
}
