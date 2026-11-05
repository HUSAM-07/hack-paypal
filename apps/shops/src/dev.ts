import { serve } from "@hono/node-server";
import { app, PORT } from "./index";

const port = Number(process.env.PORT ?? PORT);
serve({ fetch: app.fetch, port }, () => console.log(`shops listening on http://localhost:${port}`));
