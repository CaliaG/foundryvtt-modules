#!/usr/bin/env python3
"""Remote Deck -> LivePortrait: la webcam anima l'intero ritratto del "Volto" scelto sulla deck (capelli inclusi).

Alternativa a remote_deck_face.py (Deep-Live-Cam, solo volto): stessa deck, stesso tab Volti, uno alla volta.
Funziona con FasterLivePortrait (Windows + NVIDIA, TensorRT) e con fasterliveportrait-mlx (Mac Apple Silicon).
  - volto scelto   -> il ritratto si anima seguendo la tua faccia
  - "Faccia reale" -> la webcam passa invariata

Uso (con il Python dell'ambiente di FasterLivePortrait):
  DECK_URL=https://host/deck DECK_TOKEN=... python remote_deck_portrait.py --flp <cartella FasterLivePortrait>
      [--cfg configs/trt_infer.yaml] [--mlx-profile turbo] [--camera 0]
  python3 remote_deck_portrait.py --selftest

Mostra una finestra "Remote Deck" da catturare con OBS (Cattura finestra). Tasto q per uscire.
"""
import argparse
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from remote_deck_face import FaceSwitch, log  # noqa: E402  (client della deck e cache ritratti condivisi)

WINDOW = "Remote Deck"


class PortraitLoop:
    """Un frame della webcam -> il frame da mostrare. La pipeline si usa solo da questo thread (non è thread-safe)."""

    def __init__(self, pipe, cv2, switch):
        self.pipe, self.cv2, self.switch = pipe, cv2, switch
        self.lock = threading.Lock()
        self.pending = None    # ritratto in attesa, impostato dal thread della deck
        self.active = False    # c'è un ritratto preparato
        self.first = True      # LivePortrait usa il primo frame come posa neutra: si riparte a ogni cambio
        self.last = None       # ultimo frame del ritratto, mostrato se la webcam perde il volto
        self.was_off = False

    def set_source(self, path):
        with self.lock:
            self.pending = path

    def still(self):
        return self.cv2.cvtColor(self.pipe.src_imgs[0], self.cv2.COLOR_RGB2BGR)

    def step(self, frame):
        with self.lock:
            path, self.pending = self.pending, None
        if path:
            if self.pipe.prepare_source(path, realtime=True):
                self.active, self.first = True, True
                self.last = self.still()
            else:
                log(f"nessun volto riconosciuto in {Path(path).name}: tengo il ritratto precedente")
        if self.switch.off or not self.active:
            self.was_off = True
            return frame
        if self.was_off:
            self.first, self.was_off = True, False
        _, _, out_org, _ = self.pipe.run(frame, self.pipe.src_imgs[0], self.pipe.src_infos[0],
                                         first_frame=self.first, realtime=True)
        if out_org is None:  # nessun volto davanti alla webcam: niente "faccia vera" a sorpresa
            return self.last
        self.first = False
        self.last = self.cv2.cvtColor(out_org, self.cv2.COLOR_RGB2BGR)
        return self.last


def main(argv):
    ap = argparse.ArgumentParser(description="Remote Deck -> LivePortrait")
    ap.add_argument("--flp", required=True, help="cartella di FasterLivePortrait (o fasterliveportrait-mlx)")
    ap.add_argument("--cfg", help="config di inferenza (default: mlx_infer.yaml se c'è, altrimenti trt_infer.yaml)")
    ap.add_argument("--mlx-profile", default="turbo", help="solo versione MLX: quality|speed|turbo|ultra")
    ap.add_argument("--camera", type=int, default=0, help="indice della webcam")
    args = ap.parse_args(argv)
    base, token = os.environ.get("DECK_URL"), os.environ.get("DECK_TOKEN")
    if not base or not token:
        sys.exit("Imposta DECK_URL (es. https://host/deck) e DECK_TOKEN")

    flp = str(Path(args.flp).expanduser().resolve())
    os.chdir(flp)
    sys.path.insert(0, flp)
    mlx = Path("configs/mlx_infer.yaml").exists()
    if mlx:  # il profilo imposta variabili d'ambiente lette all'import della pipeline
        from src.utils.mlx_profiles import apply_mlx_profile
        apply_mlx_profile(args.mlx_profile)
    import cv2
    from omegaconf import OmegaConf
    cfg = OmegaConf.load(args.cfg or ("configs/mlx_infer.yaml" if mlx else "configs/trt_infer.yaml"))
    cfg.infer_params.flag_pasteback = True  # ritratto intero, non solo il ritaglio del volto
    if mlx:
        from src.runtime_assets import ensure_runtime_assets
        ensure_runtime_assets(cfg)
    from src.pipelines.faster_live_portrait_pipeline import FasterLivePortraitPipeline
    pipe = FasterLivePortraitPipeline(cfg=cfg, is_animal=False)

    loop = PortraitLoop(pipe, cv2, switch=None)
    loop.switch = FaceSwitch(base, token, loop.set_source)
    threading.Thread(target=loop.switch.run, daemon=True).start()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        sys.exit(f"webcam {args.camera} non disponibile")
    # Al modello basta il volto ritagliato: 640x480 basta e costa molto meno di 1080p.
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
    frames, t0 = 0, time.time()
    while True:
        ok, frame = cap.read()
        if not ok:
            time.sleep(0.01)
            continue
        cv2.imshow(WINDOW, loop.step(frame))
        frames += 1
        if time.time() - t0 >= 10:
            log(f"{frames / (time.time() - t0):.1f} fps")
            frames, t0 = 0, time.time()
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
    cap.release()
    cv2.destroyAllWindows()


def selftest():
    import types

    class Pipe:
        def __init__(self):
            self.src_imgs, self.src_infos, self.calls = [None], [None], []
        def prepare_source(self, path, realtime):
            if "noface" in path:
                return False
            self.src_imgs, self.src_infos = [f"img:{path}"], [f"info:{path}"]
            return True
        def run(self, frame, img, info, first_frame, realtime):
            self.calls.append(first_frame)
            return None, None, (None if frame == "lost" else f"out:{img}:{frame}"), None

    cv2 = types.SimpleNamespace(COLOR_RGB2BGR=1, cvtColor=lambda x, code: f"bgr({x})")
    switch = types.SimpleNamespace(off=False)
    pipe = Pipe()
    loop = PortraitLoop(pipe, cv2, switch)

    assert loop.step("cam") == "cam"                               # nessun ritratto: webcam
    loop.set_source("a.jpg")
    assert loop.step("cam") == "bgr(out:img:a.jpg:cam)"            # ritratto A animato
    assert loop.step("lost") == "bgr(out:img:a.jpg:cam)"           # volto perso: ultimo frame, non la webcam
    loop.set_source("noface.jpg")
    assert loop.step("cam") == "bgr(out:img:a.jpg:cam)"            # ritratto senza volto: resta A
    loop.set_source("b.jpg")
    assert loop.step("cam") == "bgr(out:img:b.jpg:cam)"            # cambio a caldo
    switch.off = True
    assert loop.step("cam") == "cam"                               # faccia reale
    switch.off = False
    loop.step("cam")
    assert pipe.calls == [True, False, False, True, True], pipe.calls  # posa neutra rifatta a ogni cambio/ripresa
    print("selftest ok")


if __name__ == "__main__":
    selftest() if sys.argv[1:] == ["--selftest"] else main(sys.argv[1:])
