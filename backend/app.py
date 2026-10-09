import asyncio
import os
import re
import secrets
from contextlib import asynccontextmanager
from typing import Annotated
from urllib.parse import unquote

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.sse import EventSourceResponse, ServerSentEvent

from models import (
    FinishRequest,
    GhostRun,
    JoinRequest,
    LeaderboardEntry,
    RunFinishRequest,
    RunFinishResponse,
    RunStartRequest,
    RunStartResponse,
    Seed,
    StateRequest,
    TokenRequest,
    User,
)
from rooms import Listener, Player, Room, RoomError, RoomManager, check_finish_time, encode, now_ms
from store import Store

# Load the .env file from the project root (Docker passes the variables in directly)
load_dotenv()

ROOM_CODE = re.compile(r"^[A-Z0-9]{3,8}$")
RUN_TOKEN_TTL_MS = 60 * 60 * 1000
MAX_OPEN_RUNS = 10_000

rooms = RoomManager()
store = Store(os.path.join(os.getenv("DATA_DIR", "data"), "game.db"))
# Solo time trials in progress: run token -> (seed, server time the clock started)
solo_runs: dict[str, tuple[int, int]] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # The tick loop moves races along and relays positions ~15 times a second
    ticker = asyncio.create_task(rooms.run())
    yield
    ticker.cancel()


app = FastAPI(lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")


def clean_name(name: str) -> str:
    return " ".join(name.split())[:24]


# Every endpoint that needs the current user calls this with its request
def extract_user(request: Request, client_id: str = "", nickname: str = "") -> User:
    id = request.headers.get("X-User-Id", "").strip()
    if id:
        name = request.headers.get("X-User-Name")
        # The VIScon proxy percent-encodes non-ASCII characters (e.g. "Zo%C3%AB" -> "Zoë")
        name = unquote(name) if name else id
        return User(id=id, name=clean_name(name) or id, verified=True)

    # No portal login (local development, or access control disabled): trust the
    # browser's own id and nickname. Good enough for a leaderboard among friends.
    if client_id:
        return User(id=f"guest:{client_id}", name=clean_name(nickname) or "Guest")
    return User(id="guest", name="Guest")


def room_code(code: str) -> str:
    code = code.upper()
    if not ROOM_CODE.fullmatch(code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Room codes are 3 to 8 letters or digits")
    return code


def room_player(code: str, token: str) -> tuple[Room, Player]:
    found = rooms.find(room_code(code), token)
    if found is None:
        # The room or player is gone (e.g. the backend restarted): the client rejoins
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in this room, join again")
    return found


def room_error(e: RoomError) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, str(e))


@app.get("/api/me", response_model=User)
def auth_me(request: Request):
    return extract_user(request)


@app.get("/api/time")
def server_time():
    """The server clock, so clients can agree on when a race starts."""
    return {"t": now_ms()}


# --- Race rooms ---------------------------------------------------------------


@app.post("/api/rooms/{code}/join")
async def join_room(code: str, body: JoinRequest, request: Request):
    user = extract_user(request, body.client_id, body.nickname)
    room = rooms.get_or_create(room_code(code))
    try:
        player = room.join(user.id, user.name)
    except RoomError as e:
        raise room_error(e)
    return {"id": player.id, "token": player.token, "room": room.info()}


@app.get("/api/rooms/{code}")
async def get_room(code: str):
    room = rooms.rooms.get(room_code(code))
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such room")
    return room.info()


def stream_player(code: str, token: Annotated[str, Query()]) -> tuple[Room, Player]:
    # Runs before the stream opens, so a stale token gets a proper 404
    return room_player(code, token)


# Server-Sent Events: the response stays open and every yield sends an event to the browser.
@app.get("/api/rooms/{code}/stream", response_class=EventSourceResponse)
async def room_stream(found: Annotated[tuple[Room, Player], Depends(stream_player)]):
    room, player = found
    listener = Listener()
    player.listeners.add(listener)
    listener.push_event(encode(room.info()))
    try:
        # Send something right away, as some proxies (like Vite's) hold the response until then
        yield ServerSentEvent(comment="connected")
        while True:
            for message in await listener.next():
                yield ServerSentEvent(raw_data=message)
    finally:
        player.listeners.discard(listener)
        player.last_seen = now_ms()


@app.post("/api/rooms/{code}/state", status_code=status.HTTP_204_NO_CONTENT)
async def post_state(code: str, body: StateRequest):
    room, player = room_player(code, body.token)
    room.update_state(player, body.t, body.p, body.q, body.v, body.cp)


@app.post("/api/rooms/{code}/start", status_code=status.HTTP_204_NO_CONTENT)
async def start_race(code: str, body: TokenRequest):
    room, _ = room_player(code, body.token)
    try:
        room.start()
    except RoomError as e:
        raise room_error(e)


@app.post("/api/rooms/{code}/map", status_code=status.HTTP_204_NO_CONTENT)
async def new_map(code: str, body: TokenRequest):
    room, _ = room_player(code, body.token)
    try:
        room.new_map()
    except RoomError as e:
        raise room_error(e)


@app.post("/api/rooms/{code}/finish")
async def finish_race(code: str, body: FinishRequest):
    room, player = room_player(code, body.token)
    try:
        place = room.finish(player, body.time_ms)
    except RoomError as e:
        raise room_error(e)
    # SQLite and the ghost's JSON run in a worker thread, so the room relay doesn't stall
    best = await run_in_threadpool(store.add_run, room.seed, player.user_id, player.name, body.time_ms, body.ghost)
    return {"place": place, "personal_best_ms": best}


@app.post("/api/rooms/{code}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_room(code: str, body: TokenRequest):
    found = rooms.find(room_code(code), body.token)
    if found:
        room, player = found
        room.leave(player)


# --- Solo time trials and leaderboards ------------------------------------------


@app.post("/api/runs/start", response_model=RunStartResponse)
async def start_run(body: RunStartRequest):
    """Called when a solo run's clock starts, so the server can check the finish time."""
    now = now_ms()
    # Oldest first (dicts keep insertion order): drop expired runs, and the oldest when full
    while solo_runs:
        token, (_, started) = next(iter(solo_runs.items()))
        if now - started <= RUN_TOKEN_TTL_MS and len(solo_runs) < MAX_OPEN_RUNS:
            break
        del solo_runs[token]
    token = secrets.token_urlsafe(16)
    solo_runs[token] = (body.seed, now)
    return RunStartResponse(run_token=token)


@app.post("/api/runs/finish", response_model=RunFinishResponse)
async def finish_run(body: RunFinishRequest, request: Request):
    run = solo_runs.pop(body.run_token, None)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown or already finished run")
    seed, started = run
    try:
        check_finish_time(body.time_ms, now_ms() - started)
    except RoomError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))

    user = extract_user(request, body.client_id, body.nickname)
    best = await run_in_threadpool(store.add_run, seed, user.id, user.name, body.time_ms, body.ghost)
    return RunFinishResponse(
        rank=await run_in_threadpool(store.rank, seed, body.time_ms, user.id),
        personal_best_ms=best,
        leaderboard=await run_in_threadpool(store.leaderboard, seed, 10, user.id),
    )


@app.get("/api/leaderboard", response_model=list[LeaderboardEntry])
async def leaderboard(
    request: Request,
    seed: Seed,
    client_id: str = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
):
    user = extract_user(request, client_id)
    return await run_in_threadpool(store.leaderboard, seed, limit, user.id)


@app.get("/api/ghosts", response_model=list[GhostRun])
async def ghosts(seed: Seed, limit: Annotated[int, Query(ge=1, le=5)] = 3):
    return await run_in_threadpool(store.ghosts, seed, limit)


if __name__ == "__main__":
    print("Starting server")
    uvicorn.run(
        "__main__:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
