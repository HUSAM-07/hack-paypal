// Playwright runs these files under Node; only `process.env` is used, so declare just that
// instead of pulling @types/node into the browser app's type space.
declare const process: { env: Record<string, string | undefined> };
