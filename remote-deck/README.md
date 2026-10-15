# Remote Deck

Usa smartphone o iPad come una Stream Deck per FoundryVTT v13: playlist e suoni, Soundscape, personaggi (immagine condivisa o Boss Splash) e macro.

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
4. **Telefono**: apri l'URL stampato, ad esempio `http://192.168.1.10:3333/?t=…`. Telefono e PC devono essere sulla stessa rete. Su iPad: *Condividi → Aggiungi a Home* per averlo a schermo intero.

La barra sotto i tab è verde quando relay e Foundry sono connessi, rossa altrimenti.

## Cosa compare nella deck

| Tab | Da dove arriva | Tap |
|---|---|---|
| Audio | tutte le playlist | play/stop della playlist o del singolo suono |
| Soundscape | modulo `soundscape`, se attivo | cambia scena, start/stop, pad del soundboard |
| Personaggi | cartella attori "Deck", sottocartelle comprese | mostra l'immagine a tutti; il tasto **Splash** usa `boss-splash`, se attivo |
| Macro | cartella macro "Deck" | esegue la macro |

I nomi delle cartelle si cambiano nelle impostazioni. Con le macro puoi integrare qualsiasi altro modulo (Syrinscape, Moulinette, ecc.).

Solo il client del **GM attivo** si collega al relay ed esegue le azioni.

## Test

```bash
node --test remote-deck/server/server.test.mjs
```
