import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "./server.mjs";

const T = "secret";

// Apre uno stream SSE e restituisce una funzione che attende il prossimo messaggio "data:".
function sse(base, role) {
  const queue = [], waiters = [];
  let buf = "";
  const req = http.get(`${base}/events?role=${role}&t=${T}`, res => {
    res.setEncoding("utf8");
    res.on("data", chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!line.startsWith("data: ")) continue;
        const msg = JSON.parse(line.slice(6));
        waiters.length ? waiters.shift()(msg) : queue.push(msg);
      }
    });
  });
  return { next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(r => waiters.push(r)), close: () => req.destroy() };
}

const post = (base, path, body, t = T) =>
  fetch(`${base}${path}?t=${t}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.status);

test("relay", async () => {
  const server = createServer(T);
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/events?role=deck&t=wrong`)).status, 401);
    assert.equal(await post(base, "/action", { type: "x" }), 503);

    const deck = sse(base, "deck");
    assert.deepEqual(await deck.next(), { kind: "state", state: null, foundry: false });

    const foundry = sse(base, "foundry");
    assert.deepEqual(await deck.next(), { kind: "foundry", foundry: true });

    assert.equal(await post(base, "/state", { origin: "http://example.invalid", pages: [] }), 204);
    assert.equal((await deck.next()).state.pages.length, 0);

    assert.equal(await post(base, "/action", { type: "macro", id: "abc" }), 204);
    assert.deepEqual(await foundry.next(), { type: "macro", id: "abc" });

    assert.equal((await fetch(`${base}/img?t=${T}&p=${encodeURIComponent("http://evil.invalid/x.png")}`)).status, 403);

    deck.close(); foundry.close();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
