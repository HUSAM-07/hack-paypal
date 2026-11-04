import { serve } from "@hono/node-server";
import { app, PORT } from "./index";

const port = Number(process.env.PORT ?? PORT);
serve({ fetch: app.fetch, port }, () =>
  console.log(`studio listening on http://localhost:${port}`),
);
