# Remote Deck

Usa smartphone o iPad come una Stream Deck per FoundryVTT v13: playlist e suoni, soundboard di Moulinette, personaggi (Ginzzzu Portraits o Boss Splash) e macro.

```
Telefono ──► relay Node (PC del GM, porta 3333) ◄── Foundry (browser del GM, modulo)
```

## Installazione

1. **Modulo**: collega la cartella nei moduli di Foundry, poi attiva *Remote Deck* nel mondo.
   ```bash
   ln -s "$PWD/remote-deck" "<FoundryData>/Data/modules/remote-deck"
   ```
2. **Relay** (Node 18+, nessuna dipendenza), da avviare sul PC dove il GM apre Foundry:
   ```bash
   node remote-deck/server/server.mjs
   ```
   Il relay stampa il token e gli URL da aprire sul telefono. Il token viene salvato in `server/.deck-token`, che non va condiviso. In alternativa puoi impostarlo con la variabile d'ambiente `DECK_TOKEN`; la porta si cambia con `PORT`.
3. **Impostazioni modulo** in Foundry: incolla il token. L'URL del relay di default è `http://localhost:3333`.
4. **Telefono**: in Foundry vai su *Impostazioni → Remote Deck → QR per il telefono* e inquadra il QR. In alternativa apri l'URL stampato dal relay.
5. **Installa come app**: con la deck aperta tramite l'URL con il token, scegli *Condividi → Aggiungi a Home* su iPhone/iPad, oppure *Installa app* su Android/Chrome. Si apre a schermo intero con la sua icona.

La barra sotto i tab è verde quando relay e Foundry sono connessi, rossa altrimenti. In basso ci sono sempre **Pausa/Riprendi** e **Stop audio**. Lo schermo del telefono resta acceso finché la deck è aperta.

## Cosa compare nella deck

| Tab | Da dove arriva | Tap |
|---|---|---|
| Scene | scene presenti nella barra di navigazione | attiva la scena per tutti; quella attiva è evidenziata |
| ★ | i tuoi preferiti | **tieni premuto** un pulsante in qualsiasi tab per aggiungerlo o toglierlo; sono salvati sul telefono |
| Audio | tutte le playlist | play/stop della playlist o del singolo suono; lo slider accanto al titolo regola il volume della playlist per tutti |
| Soundboard | board di *Soundboard & Soundpad (by Moulinette)*, se attivo: una sezione per board | play/stop dello slot, come il tasto in Moulinette. Le board sono salvate nel browser del GM: vanno create in quel browser |
| Atmosfera | effetti di `fxmaster`, se attivo | accende/spegne particelle e filtri, con i parametri di default, sulla scena che il GM sta guardando |
| Personaggi | cartella attori "Deck", sottocartelle comprese | toggle Show/Hide Character di `ginzzzu-portraits` (il tile evidenziato è il personaggio mostrato); senza quel modulo mostra l'immagine a tutti. Il tasto **Splash** usa `boss-splash`, se attivo |
| Macro | cartella macro "Deck", sottocartelle comprese | esegue la macro |
| Volti | cartella attori "Volti", se esiste | cambia la **tua faccia in webcam** con quella del personaggio (Deep-Live-Cam, vedi sotto); **Faccia reale** o un secondo tap tornano normali |

Personaggi e Macro: ogni sottocartella di "Deck" diventa una sezione dello stesso tab, nell'ordine della sidebar di Foundry.

I nomi delle cartelle si cambiano nelle impostazioni. Con le macro puoi integrare qualsiasi altro modulo (Syrinscape, Moulinette, ecc.).

Solo il client del **GM attivo** si collega al relay ed esegue le azioni.

## Test

```bash
node --test remote-deck/server/server.test.mjs
```

## Deploy sul server Foundry (Caddy + pm2)

Configurazione usata su `richiamodicthulhu.sytes.net`: il relay gira accanto a Foundry, dietro lo stesso HTTPS, all'indirizzo `/deck/`.

- **Caddyfile**:
  ```
  richiamodicthulhu.sytes.net {
      redir /deck /deck/
      handle_path /deck/* {
          reverse_proxy localhost:3333
      }
      handle {
          reverse_proxy localhost:30000
          encode zstd gzip
      }
  }
  ```
- **pm2**, che esegue il relay direttamente dalla cartella del modulo installato:
  ```bash
  HOST=127.0.0.1 PUBLIC_URL=https://richiamodicthulhu.sytes.net/deck pm2 start ~/foundryuserdata/Data/modules/remote-deck/server/server.mjs --name remote-deck && pm2 save
  ```
  Il token si trova in `~/.remote-deck-token`, cioè fuori da `Data`, che è servita pubblicamente. Dopo aver aggiornato il modulo lancia `pm2 restart remote-deck`.
- **Impostazioni modulo**: URL del relay `https://richiamodicthulhu.sytes.net/deck`.
- **Telefono**: `https://richiamodicthulhu.sytes.net/deck/?t=<token>`. Funziona da qualsiasi rete.

## Volti in webcam (Deep-Live-Cam)

Toccando un personaggio nel tab **Volti**, la tua faccia in webcam diventa la sua. Lo scambio lo fa [Deep-Live-Cam](https://github.com/hacksider/Deep-Live-Cam), che gira sul **tuo Mac**. Lo script [`face/remote_deck_face.py`](face/remote_deck_face.py) lo avvia e segue la deck:
- volto scelto → scarica il ritratto dell'attore e lo imposta come sorgente;
- "Faccia reale" → la webcam passa invariata.

```
deck ─► Foundry (volto corrente) ─► relay ─► remote_deck_face.py ─► Deep-Live-Cam "Live Preview"
                                                                        └► OBS Window Capture ─► OBS Virtual Camera ─► vdo.ninja
```

1. **Installazione** (una volta), in `~/dev/personal/Deep-Live-Cam`:
   ```bash
   git clone https://github.com/hacksider/Deep-Live-Cam && cd Deep-Live-Cam
   python3.14 -m venv .venv && .venv/bin/pip install -r requirements.txt
   curl -L -o models/inswapper_128.onnx "https://huggingface.co/hacksider/deep-live-cam/resolve/main/inswapper_128.onnx?download=true"
   ```
   I modelli per riconoscere i volti (insightface `buffalo_l`) li scarica DLC al primo avvio.
2. **Foundry**: crea una cartella attori **"Volti"** (il nome si cambia nelle impostazioni) e mettici i personaggi da interpretare.
3. **Avvio** (dalla cartella di Deep-Live-Cam):
   ```bash
   DECK_URL=https://richiamodicthulhu.sytes.net/deck DECK_TOKEN=<token> .venv/bin/python <repo>/remote-deck/face/remote_deck_face.py --dlc . --execution-provider coreml
   ```
   Nella finestra di Deep-Live-Cam scegli la webcam e premi **Live**. Lascia disattivato "Map faces". Al primo avvio macOS chiede il permesso per la fotocamera.
4. **OBS**: *Sorgente → Cattura finestra* "Live Preview", poi **Avvia videocamera virtuale**.
5. **vdo.ninja**: nel link di invio (push) scegli come camera **"OBS Virtual Camera"**. Se serve, aggiungi `&width=1280&height=720&framerate=30`.

Note:
- **Ritratti**: servono volti frontali, ben illuminati e realistici. Con disegni o stili molto illustrati il volto spesso non viene riconosciuto e la webcam resta invariata. Gli SVG (es. l'icona di default) non vanno bene: usa PNG, JPG o WEBP.
- **Cache**: i ritratti vengono salvati in `~/.remote-deck/faces/`.
- **Ripresa automatica**: lo script si ricollega da solo se il relay cade, e mantiene il volto attivo anche se ricarichi Foundry.
- **Volti da usare**: solo volti di personaggi inventati o generati, o di persone che hanno dato il consenso.
- **Licenze**: Deep-Live-Cam (AGPL-3.0) e i suoi modelli (uso non commerciale) non sono inclusi in questo repo.
- **Aggiornamenti di Deep-Live-Cam**: lo script usa nomi interni di DLC (`modules.globals.source_path`, `face_swapper.swap_face`). Se un aggiornamento li cambia, lo script si ferma all'avvio con un messaggio chiaro. Verificato con DLC `a924275`.
