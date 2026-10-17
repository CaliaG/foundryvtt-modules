// node --test notebooklm-chat/scripts/main.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

// Quanto basta di Foundry per importare il modulo.
globalThis.foundry = { applications: { api: { ApplicationV2: class {} } } };
globalThis.Hooks = { once() {}, on() {} };
const { md, chatHTML } = await import("./main.js");

test("md", () => {
  assert.equal(md("**Horror** è per *Call of Cthulhu* [1, 2]"), "<strong>Horror</strong> è per <em>Call of Cthulhu</em> [1, 2]");
  assert.equal(md("### Tappe\n* Parigi\n- Losanna"), "<strong>Tappe</strong>\n• Parigi\n• Losanna");
  assert.equal(md("2 * 3 * 4"), "2 * 3 * 4");
  assert.equal(md("<img src=x onerror=alert(1)> *ok*"), "&#60;img src=x onerror=alert(1)&#62; <em>ok</em>");
});

test("md: rimandi alle fonti come tooltip", () => {
  const refs = [{ n: 1, source: "Book 1.pdf", text: "Elias <morto>" }, { n: 3, source: "Book 2.pdf", text: "Losanna" }];
  const html = md("Vedi [1] e [2-3], non [9].", refs);
  const tips = [...html.matchAll(/data-tooltip-html="([^"]*)">(\[[^\]]+\])/g)].map(m => [m[2], m[1]]);
  assert.deepEqual(tips, [
    ["[1]", "&#60;p&#62;&#60;strong&#62;[1] Book 1.pdf&#60;/strong&#62;&#60;br&#62;Elias &#38;#60;morto&#38;#62;&#60;/p&#62;"],
    ["[2-3]", "&#60;p&#62;&#60;strong&#62;[3] Book 2.pdf&#60;/strong&#62;&#60;br&#62;Losanna&#60;/p&#62;"]
  ]);
  assert.ok(html.endsWith("non [9]."));   // nessuna fonte -> resta testo
});

test("chatHTML", () => {
  assert.equal(chatHTML("Elias muore [1].\nVedi **Parigi** [2-3]."), "<p>Elias muore.<br>Vedi <strong>Parigi</strong>.</p>");
});
