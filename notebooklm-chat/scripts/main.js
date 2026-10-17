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
const waitText = start => `Sto pensando… ${Math.round((Date.now() - start) / 1000)} s`;
// Orienta le domande suggerite verso il lavoro del Custode. La lingua la decide NOTEBOOKLM_HL sul server.
const TIPS_QUERY = "Domande utili al Custode che prepara o conduce la sessione: PNG, indizi, luoghi, regole";

// "1, 2" / "2-4" -> [1, 2] / [2, 3, 4]
const citeNumbers = s => s.split(",").flatMap(part => {
  const [a, b = a] = part.split("-").map(Number);
  return Array.from({ length: Math.max(0, b - a) + 1 }, (_, i) => a + i);
});

// Il markdown che usa NotebookLM -> HTML. Prima l'escape, poi solo tag nostri: niente HTML né link dalla risposta.
// I rimandi [n] diventano tooltip di Foundry con il passaggio citato.
// ponytail: solo titoli, elenchi, **grassetto** e *corsivo*; tabelle e link restano testo.
export function md(text, refs = []) {
  return escapeHTML(text)
    .replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^(\s*)[*-]\s+/gm, "$1• ")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g, (marker, nums) => {
      const tip = citeNumbers(nums).flatMap(n => refs.filter(r => r.n === n).map(r =>
        `<p><strong>[${n}] ${escapeHTML(r.source)}</strong><br>${escapeHTML(r.text.length > 400 ? `${r.text.slice(0, 400)}…` : r.text)}</p>`
      )).join("");
      return tip ? `<span class="nlm-cite" data-tooltip-html="${escapeHTML(tip)}">${marker}</span>` : marker;
    });
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
  started = 0;        // quando è partita la domanda in attesa
  tips = {};          // notebookId -> [{title, prompt}] oppure "loading"
  showTips = false;   // suggerimenti mostrati anche con la conversazione già avviata

  async loadTips(nb) {
    this.tips[nb] = "loading";
    try {
      this.tips[nb] = (await api(`/notebooks/${nb}/suggested-prompts?query=${encodeURIComponent(TIPS_QUERY)}`)).suggestions ?? [];
    } catch (err) {
      console.warn(`${ID} | domande suggerite`, err);
      this.tips[nb] = [];
    }
    this.render();
  }

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
    this.showTips = false;
    this.started = Date.now();
    this.render();
    const tick = setInterval(() => {
      const wait = this.element?.querySelector(".nlm-a.nlm-wait");
      if (wait) wait.textContent = waitText(this.started);
    }, 1000);
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
    clearInterval(tick);
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
    const tipsButton = el("button", { type: "button", title: "Domande suggerite", disabled: !!this.pending }, el("i", { className: "fas fa-lightbulb" }));
    tipsButton.addEventListener("click", () => { this.showTips = !this.showTips; this.render(); });

    const turns = get("history")[nb]?.turns ?? [];
    const log = el("div", { className: "nlm-log" },
      ...turns.map(t => this.turnHTML(t)),
      this.pending && this.turnHTML({ q: this.pending }));

    const input = el("textarea", { placeholder: "Chiedi all'avventura… (Invio per inviare)", disabled: !!this.pending, rows: 3,
      // Un nuovo render (es. suggerimenti arrivati) non cancella quello che si sta scrivendo.
      value: this.draft ?? this.element?.querySelector(".nlm-form textarea")?.value ?? "" });
    this.draft = null;
    const tips = (!turns.length || this.showTips) && !this.pending ? this.tipsHTML(nb, input) : null;
    const form = el("form", { className: "nlm-form" }, input,
      el("button", { type: "submit", disabled: !!this.pending }, el("i", { className: "fas fa-paper-plane" })));
    form.addEventListener("submit", e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q || this.pending) return;
      input.value = "";
      this.ask(q);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });

    return el("div", { className: "nlm" }, el("div", { className: "nlm-head" }, select, tipsButton, clear), log, tips, form);
  }

  // Domande suggerite da NotebookLM: un clic le mette nel campo, da rileggere o tradurre prima di inviarle.
  tipsHTML(nb, input) {
    if (this.tips[nb] === undefined) this.loadTips(nb);
    const tips = this.tips[nb];
    if (!Array.isArray(tips)) return el("div", { className: "nlm-tips nlm-wait", textContent: "Carico domande suggerite…" });
    if (!tips.length) return null;
    return el("div", { className: "nlm-tips" }, ...tips.map(t => {
      const chip = el("button", { type: "button", textContent: t.title, title: t.prompt });
      chip.addEventListener("click", () => { input.value = t.prompt; input.focus(); });
      return chip;
    }));
  }

  turnHTML({ q, a, refs = [] }) {
    const answer = a == null
      ? el("div", { className: "nlm-a nlm-wait", textContent: waitText(this.started) })
      : el("div", { className: "nlm-a", innerHTML: md(a, refs) });
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

// Tasto destro su attori, scene (anche nella barra in alto), journal e oggetti: domanda pronta, inviata subito.
export const ASK_ABOUT = {
  Actor: name => `Chi è ${name}? Descrivi il suo ruolo nell'avventura, cosa vuole, cosa sa e dove compare.`,
  Scene: name => `Cosa succede in "${name}"? Riassumi luoghi, PNG presenti, indizi da trovare e possibili sviluppi.`,
  JournalEntry: name => `Cosa dice l'avventura su "${name}"? Riassumi le informazioni utili al Custode.`,
  Item: name => `Cos'è "${name}" nell'avventura e come si usa? Riporta regole ed effetti rilevanti.`
};

async function askAbout(question) {
  chat ??= new NotebookChat();
  await chat.render({ force: true });   // sceglie il notebook se non c'è ancora
  if (!get("token") || !get("notebookId")) return;   // la finestra spiega cosa manca
  if (chat.pending) return ui.notifications.warn("NotebookLM: aspetta la risposta in corso.");
  chat.ask(question);
}

for (const [type, question] of Object.entries(ASK_ABOUT)) {
  Hooks.on(`get${type}ContextOptions`, (app, options) => {
    if (!game.user.isGM) return;
    options.push({
      name: "Chiedi a NotebookLM",
      icon: '<i class="fas fa-book-open"></i>',
      callback: li => {
        const id = li.closest("[data-entry-id]")?.dataset.entryId ?? li.dataset.sceneId;
        const doc = game.collections.get(type)?.get(id);
        if (doc) askAbout(question(doc.name));
      }
    });
  });
}

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
