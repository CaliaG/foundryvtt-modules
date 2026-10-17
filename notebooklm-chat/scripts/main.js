const ID = "notebooklm-chat";
const get = key => game.settings.get(ID, key);
const MAX_TURNS = 30;

// notebooklm-server (REST di notebooklm-py) dietro lo stesso Caddy di Foundry: stessa origine, niente CORS.
async function api(path, body) {
  const res = await fetch(`${get("serverUrl").replace(/\/$/, "")}/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${get("token")}`, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c != null));
  return node;
};

const escapeHTML = s => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// Il markdown che usa NotebookLM -> HTML. Prima l'escape, poi solo tag nostri: niente HTML né link dalla risposta.
// ponytail: solo titoli, elenchi, **grassetto** e *corsivo*; tabelle e link restano testo.
export function md(text) {
  return escapeHTML(text)
    .replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^(\s*)[*-]\s+/gm, "$1• ")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
}

// Risposta -> messaggio di chat, senza i rimandi [1], [2-3] alle fonti.
export function chatHTML(text) {
  return `<p>${md(text.replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, "")).replace(/\n/g, "<br>")}</p>`;
}

class NotebookChat extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "notebooklm-chat",
    window: { title: "NotebookLM", icon: "fas fa-book-open", resizable: true },
    position: { width: 480, height: 640 }
  };

  notebooks = null;   // [{id, title}]
  sources = {};       // notebookId -> {sourceId: titolo}
  pending = null;     // domanda in attesa di risposta
  draft = null;       // domanda fallita da rimettere nel campo

  async loadSources(nb) {
    if (!this.sources[nb]) {
      const { sources } = await api(`/notebooks/${nb}/sources`);
      this.sources[nb] = Object.fromEntries(sources.map(s => [s.id, s.title ?? ""]));
    }
    return this.sources[nb];
  }

  async ask(question) {
    const nb = get("notebookId");
    this.pending = question;
    this.render();
    try {
      const history = foundry.utils.deepClone(get("history"));
      const h = history[nb] ??= { conversation: null, turns: [] };
      const [r, sources] = await Promise.all([
        api(`/notebooks/${nb}/chat`, { question, conversation_id: h.conversation }),
        this.loadSources(nb).catch(() => ({}))
      ]);
      h.conversation = r.conversation_id;
      const refs = (r.references ?? []).map(x => ({ n: x.citation_number, text: x.cited_text ?? "", source: sources[x.source_id] ?? "" }));
      h.turns = [...h.turns, { q: question, a: r.answer, refs }].slice(-MAX_TURNS);
      await game.settings.set(ID, "history", history);
    } catch (err) {
      console.error(`${ID} |`, err);
      ui.notifications.error(`NotebookLM: ${err.message}`);
      this.draft = question;   // la domanda torna nel campo, da riprovare
    }
    this.pending = null;
    this.render();
  }

  async clear() {
    const nb = get("notebookId");
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Svuota conversazione" },
      content: "<p>Cancella la cronologia mostrata qui. NotebookLM ricorda ancora la sua conversazione: per ripartire da zero, cancellala anche sul sito di NotebookLM.</p>"
    });
    if (!ok) return;
    const history = foundry.utils.deepClone(get("history"));
    delete history[nb];
    await game.settings.set(ID, "history", history);
    this.render();
  }

  async _renderHTML() {
    if (!get("token")) return el("p", { textContent: "Imposta il token di notebooklm-server nelle impostazioni del modulo." });
    try {
      this.notebooks ??= (await api("/notebooks")).notebooks;
    } catch (err) {
      return el("p", { className: "nlm-error", textContent: `Errore da notebooklm-server: ${err.message}` });
    }
    if (!this.notebooks.length) return el("p", { textContent: "Nessun notebook su questo account NotebookLM." });

    let nb = get("notebookId");
    if (!this.notebooks.some(n => n.id === nb)) {
      nb = this.notebooks[0].id;
      await game.settings.set(ID, "notebookId", nb);
    }

    const select = el("select", { disabled: !!this.pending },
      ...this.notebooks.map(n => el("option", { value: n.id, textContent: n.title || n.id, selected: n.id === nb })));
    select.addEventListener("change", async () => { await game.settings.set(ID, "notebookId", select.value); this.render(); });
    const clear = el("button", { type: "button", title: "Svuota conversazione", disabled: !!this.pending }, el("i", { className: "fas fa-broom" }));
    clear.addEventListener("click", () => this.clear());

    const turns = get("history")[nb]?.turns ?? [];
    const log = el("div", { className: "nlm-log" },
      ...turns.map(t => this.turnHTML(t)),
      this.pending && this.turnHTML({ q: this.pending }));

    const input = el("textarea", { placeholder: "Chiedi all'avventura… (Invio per inviare)", disabled: !!this.pending, rows: 3, value: this.draft ?? "" });
    this.draft = null;
    const form = el("form", { className: "nlm-form" }, input,
      el("button", { type: "submit", disabled: !!this.pending }, el("i", { className: "fas fa-paper-plane" })));
    form.addEventListener("submit", e => {
      e.preventDefault();
      const q = input.value.trim();
      if (q && !this.pending) this.ask(q);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });

    return el("div", { className: "nlm" }, el("div", { className: "nlm-head" }, select, clear), log, form);
  }

  turnHTML({ q, a, refs = [] }) {
    const answer = a == null
      ? el("div", { className: "nlm-a nlm-wait", textContent: "Sto pensando…" })
      : el("div", { className: "nlm-a", innerHTML: md(a) });
    const turn = el("div", { className: "nlm-turn" }, el("div", { className: "nlm-q", textContent: q }), answer);
    if (refs.length) turn.append(el("details", {},
      el("summary", { textContent: `Fonti (${refs.length})` }),
      ...refs.map(r => el("div", { className: "nlm-ref" },
        el("strong", { textContent: `[${r.n}] ${r.source}` }), el("span", { textContent: r.text })))));
    if (a != null) {
      const share = el("button", { type: "button", className: "nlm-share" }, el("i", { className: "fas fa-comment" }), " Invia in chat");
      share.addEventListener("click", () => ChatMessage.create({ content: chatHTML(a), speaker: ChatMessage.getSpeaker() }));
      turn.append(share);
    }
    return turn;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    const log = content.querySelector(".nlm-log");
    if (log) log.scrollTop = log.scrollHeight;
    content.querySelector("textarea:not(:disabled)")?.focus();
  }
}

let chat;

Hooks.once("init", () => {
  game.settings.register(ID, "serverUrl", {
    name: "URL di notebooklm-server",
    hint: "Indirizzo visto dal browser del GM. Con Caddy sullo stesso dominio di Foundry basta /notebooklm.",
    scope: "world", config: true, type: String, default: "/notebooklm"
  });
  // Per utente, non per mondo: i setting di mondo arrivano a tutti i client e il token apre gli spoiler dell'avventura.
  game.settings.register(ID, "token", {
    name: "Token", hint: "Il contenuto di ~/.notebooklm-server-token sul server.",
    scope: "user", config: true, type: String, default: ""
  });
  game.settings.register(ID, "notebookId", { scope: "client", config: false, type: String, default: "" });
  // {notebookId: {conversation, turns: [{q, a, refs}]}}: la cronologia resta dopo un reload.
  game.settings.register(ID, "history", { scope: "client", config: false, type: Object, default: {} });
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  const tools = controls.tokens.tools;
  tools.notebooklm = {
    name: "notebooklm", title: "NotebookLM", icon: "fas fa-book-open",
    order: Object.keys(tools).length, button: true,
    onChange: () => (chat ??= new NotebookChat()).render({ force: true })
  };
});
