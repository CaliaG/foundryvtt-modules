// Remote Deck relay: telefono <-> client Foundry del GM. Solo stdlib Node (>= 18).
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const MAX_BODY = 1024 * 1024;

function loadToken() {
  if (process.env.DECK_TOKEN) return process.env.DECK_TOKEN;
  // Fuori dalla cartella del modulo: Foundry serve Data/modules pubblicamente.
  const file = path.join(os.homedir(), ".remote-deck-token");
  try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  const token = crypto.randomBytes(12).toString("hex");
  fs.writeFileSync(file, token);
  return token;
}

// ponytail: token statico in query string, ok per LAN di casa; per esporlo su internet servono HTTPS e login vero.
export function createServer(token) {
  let state = null;
  const clients = { foundry: new Set(), deck: new Set() };

  const send = (res, data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const broadcast = (role, data) => clients[role].forEach(res => send(res, data));
  const heartbeat = setInterval(() => {
    for (const set of Object.values(clients)) set.forEach(res => res.write(": ping\n\n"));
  }, 25000);

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (req.method === "OPTIONS") return res.end();

    const url = new URL(req.url, "http://x");
    const end = (code, body = "") => { res.statusCode = code; res.end(body); };

    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(fs.readFileSync(DIR + "public/index.html"));
    }

    const given = Buffer.from(url.searchParams.get("t") ?? "");
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return end(401, "token non valido");

    if (req.method === "GET" && url.pathname === "/events") {
      const role = url.searchParams.get("role");
      if (!clients[role]) return end(400, "role?");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": ok\n\n");
      clients[role].add(res);
      if (role === "deck") send(res, { kind: "state", state, foundry: clients.foundry.size > 0 });
      else broadcast("deck", { kind: "foundry", foundry: true });
      req.on("close", () => {
        clients[role].delete(res);
        if (role === "foundry") broadcast("deck", { kind: "foundry", foundry: clients.foundry.size > 0 });
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/img") {
      if (!state?.origin) return end(404);
      let target;
      try { target = new URL(url.searchParams.get("p") ?? "", state.origin); } catch { return end(400); }
      if (target.origin !== new URL(state.origin).origin) return end(403);
      try {
        const r = await fetch(target);
        res.statusCode = r.status;
        res.setHeader("Content-Type", r.headers.get("content-type") ?? "application/octet-stream");
        res.setHeader("Cache-Control", "max-age=3600");
        return res.end(Buffer.from(await r.arrayBuffer()));
      } catch { return end(502); }
    }

    if (req.method === "POST" && (url.pathname === "/state" || url.pathname === "/action")) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY) return end(413);
      }
      let data;
      try { data = JSON.parse(body); } catch { return end(400, "json?"); }
      if (url.pathname === "/state") {
        state = data;
        broadcast("deck", { kind: "state", state, foundry: true });
        return end(204);
      }
      if (!clients.foundry.size) return end(503, "Foundry non connesso");
      broadcast("foundry", data);
      return end(204);
    }

    end(404);
  });
  server.on("close", () => clearInterval(heartbeat));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3333);
  const host = process.env.HOST; // es. 127.0.0.1 dietro reverse proxy
  const publicUrl = process.env.PUBLIC_URL;
  const token = loadToken();
  createServer(token).listen(port, host, () => {
    console.log(`Remote Deck relay su ${host ?? "*"}:${port}`);
    console.log(`Token (da inserire nelle impostazioni del modulo): ${token}`);
    console.log("Apri sul telefono:");
    if (publicUrl) console.log(`  ${publicUrl.replace(/\/$/, "")}/?t=${token}`);
    else for (const nets of Object.values(os.networkInterfaces()))
      for (const n of nets ?? [])
        if (n.family === "IPv4" && !n.internal) console.log(`  http://${n.address}:${port}/?t=${token}`);
  });
}
