import { createServer } from "http";
import app from "./app";
import { registerRoutes } from "./routes/responses";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

(async () => {
  await registerRoutes(httpServer, app);

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
  });
})();
