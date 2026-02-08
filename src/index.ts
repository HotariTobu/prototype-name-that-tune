import { Server as Engine } from "@socket.io/bun-engine";
import { Server } from "socket.io";
import { registerHandlers } from "./server/socket.ts";
import { hasCredentials, generateToken } from "./server/token.ts";
import index from "./index.html";

const engine = new Engine({ path: "/socket.io/" });

const io = new Server();
io.bind(engine);
registerHandlers(io);

const { fetch: engineFetch, websocket } = engine.handler();

export default {
  port: Number(process.env.PORT) || 3000,
  idleTimeout: 30,
  routes: {
    "/*": index,

    "/api/token": {
      async GET() {
        if (!hasCredentials()) {
          return Response.json({ error: "Credentials not configured. Set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY in .env" }, { status: 401 });
        }
        try {
          const { token, expiresAt } = await generateToken(60 * 10);
          return Response.json({ token, expiresAt: expiresAt.toISOString() });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Token generation failed";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
  fetch(req: Request, server: any) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/socket.io/")) {
      return engineFetch(req, server);
    }
    return undefined;
  },
  websocket,
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
};
