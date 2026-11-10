import { serve } from "@hono/node-server";
import { createCatalogueApp, PORT } from "./index";

const port = Number(process.env.PORT ?? PORT);
const app = createCatalogueApp();
serve({ fetch: app.fetch, port }, () =>
  console.log(`catalogue-mcp listening on http://localhost:${port}`),
);
