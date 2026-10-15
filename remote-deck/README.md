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
| Macro | cartella macro "Deck" | esegue la macro |

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
