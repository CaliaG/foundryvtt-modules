# FoundryVTT modules

Moduli per FoundryVTT v13, uno per cartella.

| Modulo | Descrizione | Manifest |
|---|---|---|
| [remote-deck](remote-deck/) | Smartphone/iPad come Stream Deck (audio, Soundscape, personaggi, macro) | `https://raw.githubusercontent.com/CaliaG/foundryvtt-modules/main/remote-deck/module.json` |
| [notebooklm-chat](notebooklm-chat/) | Domande ai notebook di NotebookLM (l'avventura) da una finestra in Foundry, solo GM | `https://raw.githubusercontent.com/CaliaG/foundryvtt-modules/main/notebooklm-chat/module.json` |

## Rilasciare una versione

1. Aggiorna `version` e `download` in `<modulo>/module.json`.
2. Fai commit su `main`, poi crea e pubblica il tag:
   ```bash
   git tag <modulo>-v<versione> && git push origin main --tags
   ```

La GitHub Action crea la release con `module.json` e `<modulo>.zip`. Foundry vede l'aggiornamento dal manifest.
