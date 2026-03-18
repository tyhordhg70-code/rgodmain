import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "path";
import router from "./routes";

const app: Express = express();

app.disable("x-powered-by");

const isDev = process.env.NODE_ENV !== "production";

// In production (Plesk), serve the frontend's built static files.
// The build process copies the frontend dist into ./public/ next to start.cjs.
// __dirname is the CJS built-in pointing to the directory of the running file.
if (!isDev) {
  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir, { index: false }));
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:      ["'self'"],
        scriptSrc:       ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
        styleSrc:        ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:         ["'self'", "data:", "https://fonts.gstatic.com"],
        imgSrc:          ["'self'", "data:", "https:", "blob:"],
        connectSrc:      ["'self'", ...(isDev ? ["ws:", "wss:"] : [])],
        frameSrc:        ["'none'"],
        frameAncestors:  ["'none'"],
        objectSrc:       ["'none'"],
        baseUri:         ["'self'"],
        formAction:      ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard:    { action: "deny" },
    hsts:          { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff:       true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "TRACE" || req.method === "TRACK") {
    res.set("Allow", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
    res.status(405).end();
    return;
  }
  next();
});

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(
  express.json({
    limit: "1mb",
  })
);
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use("/api", router);

// SPA catch-all: serve index.html for any non-API route in production
if (!isDev) {
  const indexHtml = path.join(__dirname, "public", "index.html");
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(indexHtml);
  });
}

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  console.error("Internal Server Error:", err);
  if (res.headersSent) return next(err);
  return res.status(status).json({ message });
});

export default app;
