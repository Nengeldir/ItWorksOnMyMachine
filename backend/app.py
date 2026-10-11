import asyncio
import os
import re
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Annotated
from urllib.parse import unquote

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, status
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool
from fastapi.sse import EventSourceResponse, ServerSentEvent

from models import (
    AdventureStartRequest,
    BuyRequest,
    ClientId,
    EquipRequest,
    FinishRequest,
    GhostRun,
    JoinRequest,
    LeaderboardEntry,
    MapRequest,
    PickupClaimRequest,
    Me,
    PetNameRequest,
    RunFinishRequest,
    RunReportRequest,
    RunFinishResponse,
    RunStartRequest,
    RunStartResponse,
    Seed,
    StateRequest,
    StyleRequest,
    TokenRequest,
    User,
)
from rooms import Listener, Player, Room, RoomError, RoomLimitError, RoomManager, check_finish_time, encode, now_ms
from store import Store
from profiles import Profiles

# Load the .env file from the project root (Docker passes the variables in directly)
load_dotenv()

ROOM_CODE = re.compile(r"^[A-Z0-9]{3,8}$")
RUN_TOKEN_TTL_MS = 60 * 60 * 1000
MAX_OPEN_RUNS = 10_000

rooms = RoomManager()
store = Store(os.path.join(os.getenv("DATA_DIR", "data"), "game.db"))
profiles = Profiles(store)
# Solo time trials in progress: run token -> (seed, server time the clock started)
solo_runs: dict[str, tuple[int, int]] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # The tick loop moves races along and relays positions ~15 times a second
    ticker = asyncio.create_task(rooms.run())
    yield
    ticker.cancel()


app = FastAPI(lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.middleware("http")
async def require_flight_rules(request: Request, call_next):
    path = request.url.path
    gameplay = path.startswith("/api/rooms/") or path.startswith("/api/runs/")
    if request.method == "POST" and gameplay and not path.endswith("/leave"):
        if request.headers.get("X-Flight-Rules") != "speed-control-v3":
            return JSONResponse(status_code=409, content={"detail": "Flight controls have changed. Reload the game to continue."})
    return await call_next(request)


def clean_name(name: str) -> str:
    return " ".join(name.split())[:24]


# Every endpoint that needs the current user calls this with its request
def trust_user_headers() -> bool:
    """The VIScon portal sets X-User-Id/X-User-Name in front of port 8080; anywhere else a browser
    could send them itself. Only trusted when TRUST_USER_HEADERS=1 (docker-compose.yml sets it)"""
    return os.getenv("TRUST_USER_HEADERS", "") == "1"


def extract_user(request: Request, client_id: str = "", nickname: str = "") -> User:
    id = request.headers.get("X-User-Id", "").strip() if trust_user_headers() else ""
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


class RateLimit:
    """At most `count` writes per `seconds` for one pilot (or address): a brake on scripted farming"""

    def __init__(self, count: int, seconds: float):
        self.count = count
        self.seconds = seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str):
        now = time.monotonic()
        hits = self.hits[key]
        while hits and now - hits[0] > self.seconds:
            hits.popleft()
        if len(hits) >= self.count:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Slow down a little and try again in a moment")
        hits.append(now)
        if len(self.hits) > 50_000:
            self.hits.clear()


LIMITS = {
    "claim": RateLimit(90, 60), "start": RateLimit(12, 60), "report": RateLimit(12, 60),
    "equip": RateLimit(60, 60), "shop": RateLimit(30, 60), "spin": RateLimit(6, 60),
}


def limited(kind: str, user: User):
    LIMITS[kind].check(user.id)
    return user


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


@app.get("/api/me", response_model=Me)
async def auth_me(request: Request, client_id: str = ""):
    user = extract_user(request, client_id)
    return Me(**user.model_dump(), has_played=await run_in_threadpool(store.has_played, user.id))


@app.get("/api/time")
def server_time():
    """The server clock, so clients can agree on when a race starts."""
    return {"t": now_ms()}


@app.get("/api/profile")
def get_profile(request: Request, client_id: ClientId, nickname: str = ""):
    return profiles.get(extract_user(request, client_id, nickname))


def profile_call(kind: str, request: Request, body, action):
    """Runs a profile write for the requesting pilot: rate limited, rule breaks as 400, limits as 429"""
    user = limited(kind, extract_user(request, body.client_id, body.nickname))
    try:
        return action(user)
    except PermissionError as error:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(error))
    except ValueError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))


@app.post("/api/profile/adventures")
def start_adventure(body: AdventureStartRequest, request: Request):
    return profile_call("start", request, body, lambda user: profiles.start(user, body.seed))


@app.post("/api/profile/claim")
def claim_pickups(body: PickupClaimRequest, request: Request):
    return profile_call("claim", request, body, lambda user: profiles.claim(user, body.token, body.pickups))


@app.post("/api/profile/runs")
def report_run(body: RunReportRequest, request: Request):
    """A finished (or abandoned) adventure: gates become XP and the score crystals, once per adventure"""
    result = body.model_dump(include={"score", "levels", "completed", "gates", "time_ms", "crashes"})
    return profile_call("report", request, body, lambda user: profiles.report(user, body.token, result))


@app.post("/api/profile/equip")
def equip_cosmetic(body: EquipRequest, request: Request):
    return profile_call("equip", request, body, lambda user: profiles.equip(user, body.slot, body.asset))


@app.post("/api/profile/pets")
def name_pet(body: PetNameRequest, request: Request):
    return profile_call("equip", request, body, lambda user: profiles.name_pet(user, body.pet, body.name))


@app.post("/api/profile/style")
def set_style(body: StyleRequest, request: Request):
    return profile_call("equip", request, body, lambda user: profiles.set_style(user, body.style))


@app.get("/api/shop")
def get_shop(request: Request, client_id: ClientId, nickname: str = ""):
    return profiles.shop(extract_user(request, client_id, nickname))


@app.post("/api/shop/buy")
def buy(body: BuyRequest, request: Request):
    return profile_call("shop", request, body, lambda user: profiles.buy(user, body.key))


@app.post("/api/shop/spin")
def spin(body: JoinRequest, request: Request):
    return profile_call("spin", request, body, lambda user: profiles.spin(user))


@app.get("/api/players")
def players(limit: Annotated[int, Query(ge=1, le=100)] = 50):
    """The public leaderboard of pilots, by experience"""
    return profiles.players(limit)


@app.get("/api/players/{public_id}")
def player(public_id: Annotated[str, Path(pattern=r"^[0-9a-f]{16}$")]):
    found = profiles.player(public_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such pilot")
    return found


# --- Race rooms ---------------------------------------------------------------


@app.post("/api/rooms/{code}/join")
async def join_room(code: str, body: JoinRequest, request: Request):
    user = extract_user(request, body.client_id, body.nickname)
    try:
        room = rooms.get_or_create(room_code(code), body.seed, creator=user.id)
    except RoomLimitError as e:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(e))
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
    room.update_state(player, body.t, body.p, body.q, body.v, body.cp, boost=body.boost, brake=body.brake, dodge=body.dodge)


@app.post("/api/rooms/{code}/start", status_code=status.HTTP_204_NO_CONTENT)
async def start_race(code: str, body: TokenRequest):
    room, _ = room_player(code, body.token)
    try:
        room.start()
    except RoomError as e:
        raise room_error(e)


@app.post("/api/rooms/{code}/restart", status_code=status.HTTP_204_NO_CONTENT)
async def restart_race(code: str, body: TokenRequest):
    room, player = room_player(code, body.token)
    try:
        room.restart(player)
    except RoomError as e:
        raise room_error(e)


@app.post("/api/rooms/{code}/map", status_code=status.HTTP_204_NO_CONTENT)
async def new_map(code: str, body: MapRequest):
    room, _ = room_player(code, body.token)
    try:
        room.new_map(seed=body.seed)
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
    finisher = User(id=player.user_id, name=player.name, verified=not player.user_id.startswith("guest"))
    xp = await run_in_threadpool(profiles.race_finished, finisher, body.time_ms, body.gates)
    return {"place": place, "personal_best_ms": best, "xp": xp}


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
    xp = await run_in_threadpool(profiles.race_finished, user, body.time_ms, body.gates)
    return RunFinishResponse(
        rank=await run_in_threadpool(store.rank, seed, body.time_ms, user.id),
        personal_best_ms=best,
        leaderboard=await run_in_threadpool(store.leaderboard, seed, 10, user.id),
        xp=xp,
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
