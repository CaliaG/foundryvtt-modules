import qrcode from "./vendor/qrcode.mjs";

const ID = "remote-deck";
const get = key => game.settings.get(ID, key);
const phoneUrl = () => `${get("serverUrl").replace(/\/$/, "")}/?t=${encodeURIComponent(get("token"))}`;

// Finestra con il QR da inquadrare col telefono (aperta dal pulsante nelle impostazioni del modulo).
class PhoneQR extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "remote-deck-qr", window: { title: "Remote Deck — telefono" }, position: { width: 340 } };

  async _renderHTML() {
    const div = document.createElement("div");
    div.style.cssText = "display:flex; flex-direction:column; gap:8px; text-align:center;";
    if (!get("token")) {
      div.textContent = "Imposta prima il token nelle impostazioni del modulo.";
      return div;
    }
    const qr = qrcode(0, "M");
    qr.addData(phoneUrl());
    qr.make();
    const img = Object.assign(document.createElement("img"), { src: qr.createDataURL(8, 2), alt: "QR Remote Deck" });
    img.style.cssText = "width:100%; image-rendering:pixelated; border:0; background:#fff;";
    const link = Object.assign(document.createElement("code"), { textContent: phoneUrl() });
    link.style.cssText = "word-break:break-all; user-select:all;";
    div.append(img, link);
    if (/\/\/(localhost|127\.)/.test(get("serverUrl")))
      div.append(Object.assign(document.createElement("p"), { textContent: "Attenzione: l'URL del relay è localhost, il telefono non può raggiungerlo." }));
    return div;
  }

  _replaceHTML(result, content) { content.replaceChildren(result); }
}

Hooks.once("init", () => {
  const reg = (key, name, hint, def) =>
    game.settings.register(ID, key, { name, hint, scope: "world", config: true, type: String, default: def, requiresReload: true });
  reg("serverUrl", "URL del relay", "Indirizzo del server Remote Deck visto dal PC del GM.", "http://localhost:3333");
  reg("token", "Token", "Il token stampato dal relay all'avvio.", "");
  reg("actorFolder", "Cartella personaggi", "Nome della cartella di attori mostrata nella deck.", "Deck");
  reg("macroFolder", "Cartella macro", "Nome della cartella di macro mostrata nella deck.", "Deck");
  game.settings.registerMenu(ID, "qr", {
    name: "Telefono", label: "QR per il telefono", hint: "Inquadra il QR con il telefono per aprire la deck.",
    icon: "fas fa-qrcode", type: PhoneQR, restricted: true
  });
});

Hooks.once("ready", () => {
  if (game.user !== game.users.activeGM || !get("token")) return;
  const base = get("serverUrl").replace(/\/$/, "");
  const q = `t=${encodeURIComponent(get("token"))}`;

  const push = foundry.utils.debounce(() => {
    fetch(`${base}/state?${q}`, { method: "POST", body: JSON.stringify(buildState()) })
      .catch(err => console.warn(`${ID} | invio stato fallito`, err));
  }, 200);

  let warned = false;
  const es = new EventSource(`${base}/events?role=foundry&${q}`);
  es.onopen = () => { warned = false; ui.notifications.info("Remote Deck connesso"); push(); };
  es.onerror = () => { if (!warned) ui.notifications.warn(`Remote Deck: relay non raggiungibile (${base})`); warned = true; };
  es.onmessage = async e => {
    try { await handleAction(JSON.parse(e.data)); }
    catch (err) { console.error(`${ID} |`, err); ui.notifications.error(`Remote Deck: ${err.message}`); }
    push();
  };

  for (const doc of ["Playlist", "PlaylistSound", "Actor", "Macro", "Folder", "Scene"])
    for (const op of ["create", "update", "delete"]) Hooks.on(`${op}${doc}`, push);
  Hooks.on("pauseGame", push);
  Hooks.on("canvasReady", push);
  Hooks.on("clientSettingChanged", key => { if (key.startsWith(MSB)) push(); });
});

/* ---------- stato inviato alla deck ---------- */

// Stesso ordine della sidebar: alfabetico o manuale, secondo la cartella che li contiene.
const sortIn = (folder, docs) => [...docs].sort(folder.sorting === "a"
  ? (a, b) => a.name.localeCompare(b.name)
  : (a, b) => a.sort - b.sort);
const subfolders = folder => sortIn(folder, folder.getSubfolders());
const walk = folder => [folder, ...subfolders(folder).flatMap(walk)];
const findFolder = (type, name) => {
  const all = game.folders.filter(f => f.type === type && f.name === name);
  return all.find(f => !f.folder) ?? all[0]; // preferisce quella al primo livello
};
const missing = (type, name) => [{ title: `Crea una cartella ${type} chiamata "${name}"`, buttons: [] }];

// Una sezione per la cartella e per ogni sua sottocartella (ricorsivo).
const treeSections = (folder, toButton) => walk(folder)
  .map(f => ({ title: f.name, buttons: sortIn(f, f.contents).map(toButton) }))
  .filter(s => s.buttons.length);

// Cartella "Deck" (attori o macro): i documenti diretti vanno nel tab principale; ogni sottocartella diretta
// diventa un tab a sé (es. Deck/Combattimento), con le sue sottocartelle come sezioni.
function folderPages(type, name, id, title, toButton) {
  const root = findFolder(type, name);
  if (!root) return [{ id, title, sections: missing(type, name) }];
  const pages = subfolders(root).map(f => ({ id: `${id}-${f.id}`, title: f.name, sections: treeSections(f, toButton) }));
  if (root.contents.length || !pages.length)
    pages.unshift({ id, title, sections: [{ title: root.name, buttons: sortIn(root, root.contents).map(toButton) }] });
  return pages;
}

// Soundboard & Soundpad (by Moulinette): nessuna API pubblica, leggiamo le sue board (setting client del GM)
// e suoniamo come fa lui, nella playlist "⚙ Soundboard: <utente>".
const MSB = "moulinette-soundboards";
const msbBoards = () => { const d = game.settings.get(MSB, "soundboards"); return d.boards ?? [d]; };
const msbPlaylistName = () => `${game.i18n.localize("MOUSND.soundboard_name")}: ${game.user.name}`;
const fileName = path => decodeURIComponent(path.split("/").pop()).replace(/\.[^/.]+$/, "");

function soundboardSections() {
  const playing = new Set(game.playlists.getName(msbPlaylistName())?.sounds.filter(s => s.playing).map(s => s.path));
  return msbBoards().map((b, board) => ({
    title: b.name || "Default",
    buttons: Object.keys(b).filter(k => k.startsWith("audio-"))
      .sort((x, y) => x.slice(6) - y.slice(6))
      .map(k => {
        const a = b[k], paths = [].concat(a.path ?? []);
        return {
          label: a.name || fileName(paths[0] ?? "?"),
          img: !a.faIcon && a.icon ? a.icon : undefined,
          active: paths.some(p => playing.has(p)),
          action: { type: "msb", board, slot: k.slice(6) }
        };
      })
  })).filter(s => s.buttons.length);
}

async function playSoundboardSlot(board, slot) {
  const audio = need(msbBoards()[board]?.[`audio-${slot}`], "Suono della soundboard");
  const paths = [].concat(audio.path ?? []);
  let playlist = game.playlists.getName(msbPlaylistName());
  const current = playlist?.sounds.find(s => s.playing && paths.includes(s.path));
  if (current) return playlist.stopSound(current);
  if (!playlist) {
    const folder = await game.modules.get("moulinette")?.utils?.foundry.getOrCreateFolder("Playlist", "Moulinette");
    playlist = await Playlist.create({ name: msbPlaylistName(), mode: CONST.PLAYLIST_MODES.DISABLED, folder });
  }
  const path = need(paths[Math.floor(Math.random() * paths.length)], "File audio");
  const volume = Number(audio.volume ?? 1);
  const sound = playlist.sounds.find(s => s.path === path)
    ?? (await playlist.createEmbeddedDocuments("PlaylistSound", [{ name: fileName(path), path, volume }]))[0];
  await sound.update({ volume, repeat: !!audio.repeat, channel: audio.channel ?? "environment", fade: audio.fade });
  return playlist.playSound(sound);
}

// FXMaster: toggle on/off sulla scena che il GM sta guardando, con i parametri di default dell'effetto.
function fxSections() {
  const flags = canvas.scene?.flags.fxmaster ?? {};
  const list = (registry, isOn, type) => Object.entries(registry ?? {})
    .filter(([, cls]) => !cls.hidden)
    .map(([key, cls]) => ({ label: game.i18n.localize(cls.label), active: isOn(key), action: { type, fx: key } }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [
    { title: `Particelle — ${canvas.scene?.name ?? "nessuna scena"}`, buttons: list(CONFIG.fxmaster.particleEffects, k => `core_${k}` in (flags.effects ?? {}), "fx-particle") },
    { title: "Filtri", buttons: list(CONFIG.fxmaster.filterEffects, k => k in (flags.filters ?? {}), "fx-filter") }
  ];
}

function buildState() {
  const splash = game.modules.get("boss-splash")?.active;
  const portraits = game.modules.get("ginzzzu-portraits")?.active;
  const pages = [{
    id: "scenes", title: "Scene",
    sections: [{
      title: "Navigazione",
      buttons: game.scenes.filter(sc => sc.navigation).sort((a, b) => a.navOrder - b.navOrder)
        .map(sc => ({ label: sc.navName || sc.name, img: sc.thumb, active: sc.active, action: { type: "scene", id: sc.id } }))
    }]
  }, {
    id: "audio", title: "Audio",
    sections: game.playlists.contents.map(p => ({
      title: p.name,
      // Volume della playlist = volume dei suoi suoni (sincronizzato a tutti), in scala slider 0..1.
      volume: p.sounds.size ? {
        value: foundry.audio.AudioHelper.volumeToInput(Math.max(...p.sounds.map(s => s.volume))),
        action: { type: "volume", id: p.id }
      } : undefined,
      buttons: [
        { label: `Playlist: ${p.name}`, active: p.playing, action: { type: "playlist", id: p.id } },
        ...p.sounds.contents.map(s => ({ label: s.name, active: s.playing, action: { type: "sound", id: p.id, sid: s.id } }))
      ]
    }))
  }];
  if (game.modules.get(MSB)?.active) pages.push({ id: "soundboard", title: "Soundboard", sections: soundboardSections() });
  if (game.modules.get("fxmaster")?.active && canvas.scene) pages.push({ id: "fx", title: "Atmosfera", sections: fxSections() });
  pages.push(...folderPages("Actor", get("actorFolder"), "actors", "Personaggi", a => ({
    label: a.name, img: a.img,
    ...(portraits
      ? { active: !!a.getFlag("ginzzzu-portraits", "portraitShown"), action: { type: "portrait", id: a.id } }
      : { action: { type: "show", id: a.id } }),
    alt: splash ? { label: "Splash", action: { type: "splash", id: a.id } } : undefined
  })));
  pages.push(...folderPages("Macro", get("macroFolder"), "macros", "Macro",
    m => ({ label: m.name, img: m.img, action: { type: "macro", id: m.id } })));
  return { origin: location.origin, paused: game.paused, pages };
}

/* ---------- azioni ricevute dalla deck ---------- */

const need = (doc, what) => { if (!doc) throw new Error(`${what} non trovato`); return doc; };

const ACTIONS = {
  playlist: ({ id }) => {
    const p = need(game.playlists.get(id), "Playlist");
    return p.playing ? p.stopAll() : p.playAll();
  },
  sound: ({ id, sid }) => {
    const p = need(game.playlists.get(id), "Playlist");
    const s = need(p.sounds.get(sid), "Suono");
    return s.playing ? p.stopSound(s) : p.playSound(s);
  },
  volume: ({ id, v }) => {
    const p = need(game.playlists.get(id), "Playlist");
    const volume = foundry.audio.AudioHelper.inputToVolume(Math.min(1, Math.max(0, Number(v) || 0)));
    return p.updateEmbeddedDocuments("PlaylistSound", p.sounds.map(s => ({ _id: s.id, volume })));
  },
  scene: ({ id }) => need(game.scenes.get(id), "Scena").activate(),
  pause: () => game.togglePause(!game.paused, { broadcast: true }),
  "fx-particle": ({ fx }) => {
    const cls = need(CONFIG.fxmaster.particleEffects[fx], "Effetto");
    Hooks.call("fxmaster.switchParticleEffect", { name: `core_${fx}`, type: fx, options: cls.default });
  },
  "fx-filter": ({ fx }) => FXMASTER.filters.switch(fx, fx, need(CONFIG.fxmaster.filterEffects[fx], "Filtro").default),
  stopAllAudio: () => Promise.all(game.playlists.playing.map(p => p.stopAll())),
  msb: ({ board, slot }) => playSoundboardSlot(Number(board), slot),
  show: ({ id }) => {
    const a = need(game.actors.get(id), "Attore");
    const popout = new foundry.applications.apps.ImagePopout({ src: a.img, uuid: a.uuid, window: { title: a.name } });
    popout.render(true);
    return popout.shareImage();
  },
  portrait: ({ id }) => globalThis.GinzzzuPortraits?.togglePortrait(need(game.actors.get(id), "Attore")),
  splash: ({ id }) => game.bossSplash?.splashBoss({ actor: need(game.actors.get(id), "Attore").id }),
  macro: ({ id }) => need(game.macros.get(id), "Macro").execute()
};

function handleAction(action) {
  const fn = ACTIONS[action?.type];
  if (!fn) throw new Error(`azione sconosciuta: ${action?.type}`);
  return fn(action);
}
