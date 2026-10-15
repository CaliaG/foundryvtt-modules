const ID = "remote-deck";
const get = key => game.settings.get(ID, key);

Hooks.once("init", () => {
  const reg = (key, name, hint, def) =>
    game.settings.register(ID, key, { name, hint, scope: "world", config: true, type: String, default: def, requiresReload: true });
  reg("serverUrl", "URL del relay", "Indirizzo del server Remote Deck visto dal PC del GM.", "http://localhost:3333");
  reg("token", "Token", "Il token stampato dal relay all'avvio.", "");
  reg("actorFolder", "Cartella personaggi", "Nome della cartella di attori mostrata nella deck.", "Deck");
  reg("macroFolder", "Cartella macro", "Nome della cartella di macro mostrata nella deck.", "Deck");
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

  for (const doc of ["Playlist", "PlaylistSound", "Actor", "Macro", "Folder"])
    for (const op of ["create", "update", "delete"]) Hooks.on(`${op}${doc}`, push);
  Hooks.on("soundscape", push);
  Hooks.on("setSoundscape", push);
});

/* ---------- stato inviato alla deck ---------- */

function folderSections(type, name, toButton) {
  const root = game.folders.find(f => f.type === type && f.name === name);
  if (!root) return [{ title: `Crea una cartella ${type} chiamata "${name}"`, buttons: [] }];
  return [root, ...root.getSubfolders(true)]
    .map(f => ({ title: f.name, buttons: f.contents.map(toButton) }))
    .filter(s => s.buttons.length);
}

function soundscapeSections() {
  const ss = game.soundscape;
  const all = game.settings.get("soundscape", "soundscapes") ?? [];
  const scenes = all.map((s, n) => ({
    label: s?.name || `Soundscape ${n + 1}`,
    active: ss.playing && ss.currentSoundscape === n,
    action: { type: "ss-scene", n }
  }));
  scenes.push({ label: "▶ Start", action: { type: "ss-start" } }, { label: "■ Stop", action: { type: "ss-stop" } });
  const pads = (all[ss.currentSoundscape]?.soundboard ?? [])
    .map((p, n) => p?.name && { label: p.name, img: p.imageSrc, action: { type: "ss-pad", n } })
    .filter(Boolean);
  pads.push({ label: "■ Stop soundboard", action: { type: "ss-padStop" } });
  return [{ title: "Soundscape", buttons: scenes }, { title: "Soundboard", buttons: pads }];
}

function buildState() {
  const splash = game.modules.get("boss-splash")?.active;
  const pages = [{
    id: "audio", title: "Audio",
    sections: game.playlists.contents.map(p => ({
      title: p.name,
      buttons: [
        { label: `Playlist: ${p.name}`, active: p.playing, action: { type: "playlist", id: p.id } },
        ...p.sounds.contents.map(s => ({ label: s.name, active: s.playing, action: { type: "sound", id: p.id, sid: s.id } }))
      ]
    }))
  }];
  if (game.soundscape) pages.push({ id: "soundscape", title: "Soundscape", sections: soundscapeSections() });
  pages.push({
    id: "actors", title: "Personaggi",
    sections: folderSections("Actor", get("actorFolder"), a => ({
      label: a.name, img: a.img, action: { type: "show", id: a.id },
      alt: splash ? { label: "Splash", action: { type: "splash", id: a.id } } : undefined
    }))
  });
  pages.push({
    id: "macros", title: "Macro",
    sections: folderSections("Macro", get("macroFolder"), m => ({ label: m.name, img: m.img, action: { type: "macro", id: m.id } }))
  });
  return { origin: location.origin, pages };
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
  stopAllAudio: () => Promise.all(game.playlists.playing.map(p => p.stopAll())),
  "ss-scene": ({ n }) => game.soundscape?.setSoundscape(Number(n), true),
  "ss-start": () => game.soundscape?.start(),
  "ss-stop": () => game.soundscape?.stop(),
  "ss-pad": ({ n }) => game.soundscape?.soundboard.playSound(Number(n)),
  "ss-padStop": () => game.soundscape?.soundboard.stopAll(),
  show: ({ id }) => {
    const a = need(game.actors.get(id), "Attore");
    const popout = new foundry.applications.apps.ImagePopout({ src: a.img, uuid: a.uuid, window: { title: a.name } });
    popout.render(true);
    return popout.shareImage();
  },
  splash: ({ id }) => game.bossSplash?.splashBoss({ actor: need(game.actors.get(id), "Attore").id }),
  macro: ({ id }) => need(game.macros.get(id), "Macro").execute()
};

function handleAction(action) {
  const fn = ACTIONS[action?.type];
  if (!fn) throw new Error(`azione sconosciuta: ${action?.type}`);
  return fn(action);
}
