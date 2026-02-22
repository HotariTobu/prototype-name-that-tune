import { networkInterfaces } from "node:os";
import { serve } from "bun";
import { Server as Engine } from "@socket.io/bun-engine";
import { Server } from "socket.io";
import { registerHandlers } from "./server/socket.ts";
import { hasCredentials, generateToken } from "./server/token.ts";
import index from "./index.html";

function getLocalIPAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter(
      (addr): addr is NonNullable<typeof addr> =>
        addr !== undefined && addr.family === "IPv4" && !addr.internal,
    )
    .map((addr) => addr.address);
}

const engine = new Engine({
  path: "/socket.io/",
  pingInterval: 25000,
  pingTimeout: 20000,
});

const io = new Server();
io.bind(engine);
registerHandlers(io);

const { fetch: engineFetch, websocket } = engine.handler();

const server = serve({
  port: Number(process.env.PORT) || 3000,
  idleTimeout: 60,
  routes: {
    "/*": index,

    "/api/session": {
      GET(req: Request) {
        const cookies = req.headers.get("cookie") ?? "";
        const match = cookies.match(/(?:^|;\s*)ntt-session-id=([^;]+)/);
        const sessionId = match?.[1] || crypto.randomUUID();
        const headers: HeadersInit = {};
        if (!match) {
          headers["Set-Cookie"] = `ntt-session-id=${sessionId}; HttpOnly; SameSite=Lax; Max-Age=31536000; Path=/`;
        }
        return Response.json({ ready: true }, { headers });
      },
    },

    "/api/token": {
      async GET() {
        if (!hasCredentials()) {
          return Response.json({ error: "Credentials not configured. Set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY in .env" }, { status: 401 });
        }
        try {
          const { token, expiresAt } = await generateToken(60 * 60 * 24);
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
});

const { port } = server;
console.log(`🚀 Server running at`);
console.log(`   Local:   http://localhost:${port}`);
for (const ip of getLocalIPAddresses()) {
  console.log(`   Network: http://${ip}:${port}`);
}
