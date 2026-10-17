#!/usr/bin/env python3
"""notebooklm-server con una route in più per NotebookLM Chat.

POST /v1/notebooks/{id}/chat/sources  {question, conversation_id?, source_ids?}
È la chat di notebooklm-server limitata ad alcune fonti del notebook: notebooklm-py lo supporta
(`client.chat.ask(..., source_ids=...)`) ma il suo server REST non lo espone.

Argomenti e variabili sono quelli di notebooklm-server, che resta invariato (token, solo localhost, profili):
  NOTEBOOKLM_HL=it NOTEBOOKLM_SERVER_TOKEN_FILE=~/.notebooklm-server-token \\
      ~/.venvs/notebooklm/bin/python notebooklm_chat_server.py --port 3334
  ~/.venvs/notebooklm/bin/python notebooklm_chat_server.py --selftest
"""
import sys
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from notebooklm import NotebookLMClient
import notebooklm.server.__main__ as server_main
# ponytail: moduli interni di notebooklm-py (verificati con 0.8.5); se un aggiornamento li cambia, fallisce
# all'avvio con un ImportError chiaro. Da togliere se il server ufficiale aggiunge source_ids alla chat.
from notebooklm._app.views import ask_result_view
from notebooklm.server._auth import require_auth
from notebooklm.server._context import get_client, limit_chat, require_profile


class ChatSourcesAsk(BaseModel):
    question: str
    conversation_id: str | None = None
    source_ids: list[str] | None = None   # None = tutte le fonti


# Stesse dipendenze del router /v1 ufficiale: bearer token + Host di loopback + profilo.
router = APIRouter(prefix="/v1", dependencies=[Depends(require_auth), Depends(require_profile)])


@router.post("/notebooks/{notebook_id}/chat/sources", dependencies=[Depends(limit_chat)])
async def ask_sources(notebook_id: str, body: ChatSourcesAsk,
                      client: Annotated[NotebookLMClient, Depends(get_client)]) -> dict:
    result = await client.chat.ask(notebook_id, body.question,
                                   source_ids=body.source_ids or None, conversation_id=body.conversation_id)
    return ask_result_view(result)


def with_sources_route(create_app):
    def create(*args, **kwargs):
        app = create_app(*args, **kwargs)
        app.include_router(router)
        return app
    return create


def selftest():
    import os
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from notebooklm import AskResult

    calls = []

    class FakeChat:
        async def ask(self, notebook_id, question, source_ids=None, conversation_id=None):
            calls.append((notebook_id, question, source_ids, conversation_id))
            return AskResult(answer="ok [1]", conversation_id="c1", turn_number=1, is_follow_up=False, references=[])

    class FakeClient:
        chat = FakeChat()

    os.environ["NOTEBOOKLM_SERVER_TOKEN"] = "tok"
    app = with_sources_route(lambda: FastAPI())()
    app.dependency_overrides[get_client] = lambda: FakeClient()
    app.dependency_overrides[require_profile] = lambda: None
    app.dependency_overrides[limit_chat] = lambda: None
    http = TestClient(app, headers={"Host": "localhost"}, client=("127.0.0.1", 50000))
    url = "/v1/notebooks/nb1/chat/sources"

    assert http.post(url, json={"question": "q"}).status_code == 401              # senza token
    auth = {"Authorization": "Bearer tok"}
    r = http.post(url, json={"question": "Chi è?", "source_ids": ["s2"]}, headers=auth)
    assert r.status_code == 200 and r.json()["answer"] == "ok [1]", r.text
    assert "raw_response" not in r.json()
    http.post(url, json={"question": "tutte", "source_ids": [], "conversation_id": "c1"}, headers=auth)
    assert calls == [("nb1", "Chi è?", ["s2"], None), ("nb1", "tutte", None, "c1")], calls
    assert http.post(url, json={"question": "q"}, headers={**auth, "Host": "evil.example"}).status_code == 403
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    else:
        server_main.create_app = with_sources_route(server_main.create_app)
        server_main.main()
