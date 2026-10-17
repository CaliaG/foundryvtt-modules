# NotebookLM Chat

Fai domande ai tuoi notebook di [NotebookLM](https://notebooklm.google.com) direttamente da Foundry v13: carichi l'avventura (PDF, Google Docs…) in un notebook e la interroghi da una finestra nel gioco, con le citazioni delle fonti. Solo il GM la vede.

```
Foundry (browser del GM) ──► https://<foundry>/notebooklm/ ──Caddy──► notebooklm-server (127.0.0.1:3334) ──► NotebookLM
```

> **Attenzione**: NotebookLM non ha un'API pubblica per la chat. Il modulo usa [notebooklm-py](https://github.com/teng-lin/notebooklm-py), una libreria **non ufficiale** che usa API interne di Google: può smettere di funzionare senza preavviso. Usa un **account Google dedicato**, perché il master token dà accesso completo all'account.

## Uso

- Pulsante **NotebookLM** (icona libro) nei controlli dei token, visibile solo al GM.
- In alto scegli il notebook. Scrivi la domanda e premi **Invio** (Shift+Invio va a capo).
- **Fonti**: con due fonti o più, spunta i libri da usare (ad esempio solo *Book 2 – Through the Alps*). Se non ne spunti nessuno, la ricerca usa tutte le fonti. La scelta viene ricordata per ogni notebook.
- **Tasto destro → Chiedi a NotebookLM** su un attore, una scena (anche nella barra delle scene in alto), un journal o un oggetto. La domanda parte già scritta: ad esempio "Chi è Jackson Elias? Descrivi il suo ruolo nell'avventura…".
- La risposta è numerata come in NotebookLM. **Fonti** mostra i passaggi citati e il documento da cui vengono.
- **Invia in chat** pubblica la risposta, senza citazioni, nella chat di Foundry. Utile per le informazioni da dare ai giocatori.
- **Salva nel journal** aggiunge domanda, risposta e fonti come pagina del journal "NotebookLM – *nome del notebook*". Il journal viene creato al primo salvataggio ed è visibile solo al GM. Così la preparazione resta in Foundry.
- La cronologia è salvata nel browser del GM, un notebook alla volta. 🧹 la cancella.
- **Stile e lunghezza delle risposte** si scelgono nelle impostazioni del modulo. Di default: in italiano, pratiche, adatte al Custode. Il modulo li applica al notebook su NotebookLM prima della prima domanda. Lasciando lo stile vuoto e la lunghezza "Normali" torna lo stile predefinito di NotebookLM.

I notebook vanno creati, con le loro fonti, sul sito di NotebookLM con l'account dedicato.

## Installazione sul server Foundry

Serve Python 3.10 o superiore.

1. **notebooklm-py** sul server:
   ```bash
   python3 -m venv ~/.venvs/notebooklm
   ~/.venvs/notebooklm/bin/pip install "notebooklm-py[server,headless]"
   ```
2. **Login Google con master token**. Va fatto una volta sola, sul Mac, perché serve un browser:
   ```bash
   uv tool install "notebooklm-py[browser,headless]"
   notebooklm login --master-token --account <account-dedicato>@gmail.com
   scp ~/.notebooklm/profiles/default/master_token.json <server>:.notebooklm/profiles/default/
   ```
   Sul server, crea la cartella (`mkdir -p ~/.notebooklm/profiles/default`) e poi verifica:
   ```bash
   chmod 600 ~/.notebooklm/profiles/default/master_token.json
   ~/.venvs/notebooklm/bin/notebooklm auth refresh --verify
   ~/.venvs/notebooklm/bin/notebooklm list
   ```
   Con il master token le sessioni scadute vengono rigenerate da sole, quindi non serve un cron. Per revocarlo: Account Google → Sicurezza → I tuoi dispositivi.
3. **Token del server**. È diverso dal login Google: protegge il server REST.
   ```bash
   (umask 077; openssl rand -hex 16 > ~/.notebooklm-server-token)
   ```
4. **pm2**. [`server/notebooklm_chat_server.py`](server/notebooklm_chat_server.py) è notebooklm-server con una route in più, la chat limitata ad alcune fonti, che il server ufficiale non ha. Si avvia direttamente dalla cartella del modulo installato. Con `NOTEBOOKLM_HL=it` le domande suggerite arrivano in italiano; senza, in inglese.
   ```bash
   NOTEBOOKLM_HL=it NOTEBOOKLM_SERVER_TOKEN_FILE=$HOME/.notebooklm-server-token pm2 start \
     ~/foundryuserdata/Data/modules/notebooklm-chat/server/notebooklm_chat_server.py \
     --name notebooklm --interpreter ~/.venvs/notebooklm/bin/python -- --port 3334 && pm2 save
   ```
   - **Controllo**: `~/.venvs/notebooklm/bin/python …/notebooklm_chat_server.py --selftest` deve stampare `selftest ok`. Ripetilo dopo ogni aggiornamento di notebooklm-py: lo script usa moduli interni della libreria.
   - **Variabili**: per cambiarne una in seguito, usa `pm2 restart notebooklm --update-env` con le variabili davanti, poi `pm2 save`.
   - **Senza filtro sulle fonti**: si può usare anche `~/.venvs/notebooklm/bin/notebooklm-server` al posto dello script.
5. **Caddyfile**: aggiungi questo blocco nel sito di Foundry, prima del `handle` finale.
   - `header_up Host localhost` serve perché notebooklm-server accetta solo richieste indirizzate a localhost.
   - Il filtro sui percorsi lascia passare solo l'elenco dei notebook, le fonti e la chat.
   ```
   handle_path /notebooklm/* {
       @api path_regexp ^/v1/notebooks(/[^/]+/(sources|chat|chat/configure|chat/sources|suggested-prompts))?$
       handle @api {
           reverse_proxy localhost:3334 {
               header_up Host localhost
           }
       }
       handle {
           respond 403
       }
   }
   ```
   Poi esegui `sudo systemctl reload caddy`.
6. **Foundry**: attiva il modulo.
   - In *Impostazioni → NotebookLM Chat*, lascia l'URL `/notebooklm`: è sullo stesso dominio di Foundry.
   - Incolla nel campo **Token** il contenuto di `~/.notebooklm-server-token`.
   - Il token è salvato per utente: i giocatori non lo ricevono.

Dopo aver aggiornato notebooklm-py (`pip install -U`) esegui `pm2 restart notebooklm`.

## Cambiare account Google

Il modulo in Foundry e il token del server restano gli stessi: cambia solo il master token.

1. **Sul Mac**: fai il login con il nuovo account. `--force` serve perché il profilo appartiene all'account vecchio.
   ```bash
   notebooklm login --master-token --account <nuovo-account>@gmail.com --browser chrome --force
   ```
2. **Copia il token sul server**:
   ```bash
   scp -p ~/.notebooklm/profiles/default/master_token.json <server>:.notebooklm/profiles/default/master_token.json
   ```
3. **Sul server**: cancella la sessione vecchia, rigenerala e riavvia. `notebooklm list` deve mostrare i notebook del nuovo account.
   ```bash
   rm ~/.notebooklm/profiles/default/storage_state.json
   ~/.venvs/notebooklm/bin/notebooklm auth refresh --verify
   ~/.venvs/notebooklm/bin/notebooklm list
   pm2 restart notebooklm
   ```
4. **Revoca il token vecchio**, perché non scade da solo. Con l'account vecchio vai su Account Google → Sicurezza → I tuoi dispositivi e rimuovi il dispositivo creato dal login.

Il nuovo account vede solo i suoi notebook: ricrea l'avventura lì, oppure condividila dall'account vecchio. In Foundry la finestra seleziona da sola il primo notebook disponibile.

## Problemi comuni

| Messaggio | Causa |
|---|---|
| `Invalid or missing bearer token` | Il token nelle impostazioni non corrisponde a `~/.notebooklm-server-token` |
| `Host not allowed` | Manca `header_up Host localhost` nel Caddyfile |
| `HTTP 403` senza dettagli | Il percorso non è tra quelli permessi dal Caddyfile |
| Errori `auth` / `Missing required cookies` | Login Google scaduto o revocato: ripeti il passo 2 |
| `HTTP 502` | notebooklm-server è spento: controlla `pm2 logs notebooklm` |
