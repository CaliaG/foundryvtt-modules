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

test("chatHTML", () => {
  assert.equal(chatHTML("Elias muore [1].\nVedi **Parigi** [2-3]."), "<p>Elias muore.<br>Vedi <strong>Parigi</strong>.</p>");
});
