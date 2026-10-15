#!/usr/bin/env python3
"""Remote Deck -> Deep-Live-Cam: cambia il volto in webcam quando sulla deck tocchi un "Volto".

Avvia Deep-Live-Cam (DLC) nello stesso processo e segue lo stato della deck (campo `face`):
  - volto scelto  -> scarica il ritratto e lo imposta come sorgente di DLC
  - "Faccia reale" -> lo scambio viene sospeso (la webcam passa invariata)

Uso (con il Python del venv di DLC):
  DECK_URL=https://host/deck DECK_TOKEN=... .venv/bin/python remote_deck_face.py \\
      --dlc ~/dev/personal/Deep-Live-Cam --execution-provider coreml
  python3 remote_deck_face.py --selftest

Tutto ciò che segue `--dlc <cartella>` viene passato a DLC. Solo stdlib.
"""
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path.home() / ".remote-deck" / "faces"


def log(msg):
    print(f"[remote-deck] {msg}", flush=True)


class FaceSwitch:
    """Segue lo stato della deck via SSE e decide quale volto usare."""

    def __init__(self, base, token, set_source, cache=CACHE):
        self.base, self.token, self.set_source, self.cache = base.rstrip("/"), token, set_source, Path(cache)
        self.off = False      # finché la deck non risponde, DLC si comporta normalmente
        self.current = None   # (id, img) del volto applicato

    def image_url(self, img):
        if re.match(r"https?://", img):
            return img
        return f"{self.base}/img?t={urllib.parse.quote(self.token)}&p={urllib.parse.quote(img)}"

    def download(self, face):
        # Un file diverso per volto: DLC ricarica la sorgente solo se cambia il percorso.
        ext = Path(urllib.parse.urlparse(face["img"]).path).suffix.lower() or ".png"
        if ext == ".svg":
            log(f"attenzione: {face['img']} è un SVG, DLC non lo legge: usa un ritratto PNG/JPG/WEBP")
        path = self.cache / f"{face['id']}-{hashlib.sha1(face['img'].encode()).hexdigest()[:8]}{ext}"
        if not path.exists():
            self.cache.mkdir(parents=True, exist_ok=True)
            req = urllib.request.Request(self.image_url(face["img"]), headers={"User-Agent": "RemoteDeck-face/0.7"})
            with urllib.request.urlopen(req, timeout=30) as r:
                path.write_bytes(r.read())
        return path

    def apply(self, face):
        key = face and (face.get("id"), face.get("img"))
        if key == self.current:
            return
        if not face or not face.get("img"):
            self.off, self.current = True, key
            return log("faccia reale")
        path = self.download(face)
        self.set_source(str(path))
        self.off, self.current = False, key
        log(f"volto: {path.name}")

    def run(self):
        url = f"{self.base}/events?role=deck&t={urllib.parse.quote(self.token)}"
        delay = 1
        while True:
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    log("collegato alla deck")
                    delay = 1
                    for raw in r:
                        line = raw.decode("utf-8", "replace").strip()
                        if not line.startswith("data: "):
                            continue
                        msg = json.loads(line[6:])
                        if msg.get("kind") == "state" and msg.get("state"):
                            try:
                                self.apply(msg["state"].get("face"))
                            except Exception as e:  # ritratto non scaricabile: riprova al prossimo stato
                                self.current = None
                                log(f"errore volto: {e}")
            except Exception as e:
                log(f"relay non raggiungibile ({e}), riprovo tra {delay}s")
                time.sleep(delay)
                delay = min(delay * 2, 30)


def install_hooks(switch, face_swapper):
    """Con "Faccia reale" (o ritratto senza volto) il frame passa invariato."""
    swap = face_swapper.swap_face
    face_swapper.swap_face = lambda src, target, frame: frame if switch.off or src is None else swap(src, target, frame)
    post = getattr(face_swapper, "apply_post_processing", None)
    if post:
        face_swapper.apply_post_processing = lambda frame, boxes: frame if switch.off else post(frame, boxes)


def main(argv):
    if "--dlc" not in argv[:-1]:
        sys.exit(__doc__)
    i = argv.index("--dlc")
    dlc = str(Path(argv[i + 1]).expanduser().resolve())
    base, token = os.environ.get("DECK_URL"), os.environ.get("DECK_TOKEN")
    if not base or not token:
        sys.exit("Imposta DECK_URL (es. https://host/deck) e DECK_TOKEN")

    # Come run.py di DLC: cartella di DLC come cwd, nel PATH e in sys.path; argomenti restanti a DLC.
    os.chdir(dlc)
    sys.path.insert(0, dlc)
    os.environ["PATH"] = dlc + os.pathsep + os.environ.get("PATH", "")
    sys.argv = [os.path.join(dlc, "run.py"), *argv[:i], *argv[i + 2:]]
    from modules import core  # prima di tutto: core imposta l'ambiente prima di importare torch/onnx
    import modules.globals as g
    import modules.processors.frame.face_swapper as fs
    # ponytail: dipende da nomi interni di DLC; se un aggiornamento li cambia, fallisce qui in modo chiaro.
    assert hasattr(g, "source_path") and hasattr(fs, "swap_face"), "Deep-Live-Cam è cambiato: aggiorna remote_deck_face.py"

    switch = FaceSwitch(base, token, lambda p: setattr(g, "source_path", p))
    install_hooks(switch, fs)
    threading.Thread(target=switch.run, daemon=True).start()
    core.run()


def selftest():
    import http.server
    import tempfile
    import types

    png = b"\x89PNG fake"
    states = [{"face": {"id": "a1", "img": "worlds/x/strahd.webp"}}, {"face": None}, {"face": {"id": "a1", "img": "worlds/x/strahd.webp"}}]

    class Relay(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(u.query)
            assert q["t"] == ["tok"]
            if u.path == "/deck/img":
                assert q["p"] == ["worlds/x/strahd.webp"]
                self.send_response(200); self.end_headers(); self.wfile.write(png)
            elif u.path == "/deck/events":
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
                for st in states:
                    self.wfile.write(f"data: {json.dumps({'kind': 'state', 'state': st, 'foundry': True})}\n\n".encode())
                    self.wfile.flush(); time.sleep(0.3)
                time.sleep(5)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Relay)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    sources, offs = [], []
    with tempfile.TemporaryDirectory() as tmp:
        sw = FaceSwitch(f"http://127.0.0.1:{srv.server_port}/deck", "tok", sources.append, cache=tmp)
        fs = types.SimpleNamespace(swap_face=lambda s, t, f: "swapped", apply_post_processing=lambda f, b: "post")
        install_hooks(sw, fs)
        threading.Thread(target=sw.run, daemon=True).start()
        deadline = time.time() + 5
        while time.time() < deadline and (len(sources) < 2 or len(offs) < 3):
            if not offs or offs[-1] != sw.off:
                offs.append(sw.off)
            time.sleep(0.02)
        assert len(sources) == 2 and sources[0] == sources[1], sources          # stesso volto -> stesso file in cache
        assert Path(sources[0]).read_bytes() == png and sources[0].endswith(".webp")
        assert offs == [False, True, False], offs                                 # volto -> faccia reale -> volto
        assert fs.swap_face("src", "t", "frame") == "swapped" and fs.swap_face(None, "t", "frame") == "frame"
        sw.off = True
        assert fs.swap_face("src", "t", "frame") == "frame" and fs.apply_post_processing("frame", []) == "frame"
    srv.shutdown()
    print("selftest ok")


if __name__ == "__main__":
    selftest() if sys.argv[1:] == ["--selftest"] else main(sys.argv[1:])
