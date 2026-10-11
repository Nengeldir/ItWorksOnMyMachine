"""Race rooms: who is in them, where everyone is, and the race state machine.

Everything lives in memory in this one process. Players never collide, so the
server does no physics: clients send their own state ~15 times a second and the
tick loop relays one snapshot of the whole room back to everyone over SSE.
"""

import asyncio
import json
import random
import secrets
import time
from dataclasses import dataclass, field

TICK_HZ = 15
COUNTDOWN_MS = 5_000
RACE_TIMEOUT_MS = 240_000
# Once the first pilot is through the finish, the others get this long before the race is called
FINISH_GRACE_MS = 60_000
# A racer whose stream is closed and who stopped sending state for this long no longer holds the race up
RACER_DROPPED_MS = 5_000
# A player whose stream is closed and who stopped sending state is dropped after this
PLAYER_TIMEOUT_MS = 15_000
EMPTY_ROOM_TIMEOUT_MS = 120_000
# Rooms live in memory: at most this many at once, and this many new ones per pilot an hour
MAX_ROOMS = 500
ROOMS_PER_CREATOR_HOUR = 20
# Snapshots go out when something moved, and at least this often
SNAPSHOT_KEEPALIVE_MS = 1_000
# A reported finish time must match the server's own clock within this much (network, clocks)
FINISH_TOLERANCE_MS = 3_000
# No course can be flown faster than this (~4 km at the 120 m/s top speed is 33 s)
MIN_RACE_MS = 25_000
MAX_PLAYERS = 12
MAX_PENDING_EVENTS = 100

COLORS = [
    "#ff5d73",
    "#4da3ff",
    "#ffc145",
    "#4cd6a0",
    "#b67cff",
    "#ff8a3d",
    "#5ee0e6",
    "#ff7ad9",
    "#c6e85a",
    "#ffffff",
    "#8f9bff",
    "#e0a872",
]


def now_ms() -> int:
    return int(time.time() * 1000)


def random_seed() -> int:
    return random.randint(1, 999_999)


def encode(message: dict) -> str:
    return json.dumps(message, separators=(",", ":"))


class Listener:
    """One open SSE stream. Room events queue up; snapshots replace each other.

    A slow client therefore never builds a backlog of stale positions.
    """

    def __init__(self):
        self.events: list[str] = []
        self.snapshot: str | None = None
        self.wake = asyncio.Event()

    def push_event(self, message: str):
        self.events.append(message)
        if len(self.events) > MAX_PENDING_EVENTS:
            self.events = self.events[-MAX_PENDING_EVENTS:]
        self.wake.set()

    def push_snapshot(self, message: str):
        self.snapshot = message
        self.wake.set()

    def take(self) -> list[str]:
        messages, self.events = self.events, []
        if self.snapshot is not None:
            messages.append(self.snapshot)
            self.snapshot = None
        return messages

    async def next(self) -> list[str]:
        await self.wake.wait()
        self.wake.clear()
        return self.take()


@dataclass
class Player:
    id: str
    token: str
    user_id: str
    name: str
    color: str
    last_seen: int
    # [x, y, z, qx, qy, qz, qw, speed, checkpoints, t]
    state: list[float] | None = None
    moved: bool = False
    listeners: set[Listener] = field(default_factory=set)
    racing: bool = False
    finish_ms: int | None = None

    @property
    def connected(self) -> bool:
        return bool(self.listeners)

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "racing": self.racing,
            "finish_ms": self.finish_ms,
        }


class RoomError(Exception):
    pass


class RoomLimitError(Exception):
    """Too many rooms, overall or created by one pilot (answered with 429)"""


def check_finish_time(time_ms: int, elapsed_ms: int):
    """The client's time has to match how long the server saw the run take.

    This doesn't make cheating impossible (the server doesn't fly the course),
    but you can't finish faster than you actually flew, or faster than physics allows.
    """
    if time_ms < MIN_RACE_MS:
        raise RoomError("that's faster than anyone can fly this course")
    if abs(time_ms - elapsed_ms) > FINISH_TOLERANCE_MS:
        raise RoomError("finish time doesn't match the server's clock")


class Room:
    def __init__(self, code: str, now: int | None = None, seed: int | None = None):
        self.code = code
        # The map: the one picked in the map select, or any
        self.seed = seed if seed is not None else random_seed()
        self.phase = "lobby"  # lobby -> countdown -> racing -> lobby
        self.start_at: int | None = None
        self.race_id = 0
        self.first_finish_at: int | None = None
        # The first pilot in; passed on when they leave. Only the host can restart a running race
        self.host_id: str | None = None
        self.players: dict[str, Player] = {}
        self.by_token: dict[str, Player] = {}
        self.results: list[dict] = []
        self.last_snapshot = 0
        self.empty_since: int | None = now if now is not None else now_ms()

    # --- messages -----------------------------------------------------------

    def info(self, now: int | None = None) -> dict:
        return {
            "type": "room",
            "code": self.code,
            "seed": self.seed,
            "phase": self.phase,
            "start_at": self.start_at,
            "race_id": self.race_id,
            "host": self.host_id,
            "players": [p.public() for p in self.players.values()],
            "results": self.results,
            "server_time": now if now is not None else now_ms(),
        }

    def listeners(self):
        for player in self.players.values():
            yield from player.listeners

    def notify(self, now: int | None = None):
        message = encode(self.info(now))
        for listener in self.listeners():
            listener.push_event(message)

    def snapshot(self, now: int) -> str:
        return encode(
            {
                "type": "snap",
                "t": now,
                "players": [[p.id, *p.state] for p in self.players.values() if p.state],
            }
        )

    # --- player actions -----------------------------------------------------

    def join(self, user_id: str, name: str, now: int | None = None) -> Player:
        now = now if now is not None else now_ms()
        # Coming back after a reload or a dropped connection: carry on as the same player
        for player in self.players.values():
            if player.user_id == user_id and not player.connected:
                player.name = name
                player.last_seen = now
                self.notify(now)
                return player
        if len(self.players) >= MAX_PLAYERS:
            raise RoomError("room is full")
        used = {p.color for p in self.players.values()}
        color = next((c for c in COLORS if c not in used), COLORS[len(self.players) % len(COLORS)])
        player = Player(
            id=secrets.token_hex(4),
            token=secrets.token_urlsafe(16),
            user_id=user_id,
            name=name,
            color=color,
            last_seen=now,
        )
        self.players[player.id] = player
        self.by_token[player.token] = player
        self.empty_since = None
        if self.host_id is None:
            self.host_id = player.id
        self.notify(now)
        return player

    def leave(self, player: Player, now: int | None = None):
        now = now if now is not None else now_ms()
        self.remove(player, now)
        self.check_race_over(now)
        self.notify(now)

    def remove(self, player: Player, now: int):
        self.players.pop(player.id, None)
        self.by_token.pop(player.token, None)
        if not self.players:
            self.empty_since = now
        if self.host_id == player.id:
            # The longest-standing pilot who is still connected takes over
            heirs = sorted(self.players.values(), key=lambda p: not p.connected)
            self.host_id = heirs[0].id if heirs else None

    def update_state(self, player: Player, t: float, p: list[float], q: list[float], v: float, cp: int, now: int | None = None, boost: float = 0, brake: float = 0, dodge: float = 0):
        player.state = [
            round(p[0], 2),
            round(p[1], 2),
            round(p[2], 2),
            round(q[0], 4),
            round(q[1], 4),
            round(q[2], 4),
            round(q[3], 4),
            round(v, 1),
            cp,
            round(t),
            round(boost, 2),
            round(brake, 2),
            round(dodge, 4),
        ]
        player.moved = True
        player.last_seen = now if now is not None else now_ms()

    def new_map(self, now: int | None = None, seed: int | None = None):
        """Another map: the one picked in the map select, or a random one"""
        if self.phase != "lobby":
            raise RoomError("the map can only change in the lobby")
        self.seed = seed if seed is not None else random_seed()
        self.results = []
        self.notify(now)

    def start(self, now: int | None = None):
        now = now if now is not None else now_ms()
        if self.phase != "lobby":
            raise RoomError("a race is already running")
        self.begin(now)

    def restart(self, player: Player, now: int | None = None):
        """The host calls the race off and puts everyone back on the start line, whatever the phase"""
        if player.id != self.host_id:
            raise RoomError("only the host can restart the race")
        self.begin(now if now is not None else now_ms())

    def begin(self, now: int):
        self.phase = "countdown"
        self.start_at = now + COUNTDOWN_MS
        self.race_id += 1
        self.first_finish_at = None
        self.results = []
        for player in self.players.values():
            player.racing = True
            player.finish_ms = None
        self.notify(now)

    def finish(self, player: Player, time_ms: int, now: int | None = None) -> int:
        """Records a finish and returns the place (1 = winner)."""
        now = now if now is not None else now_ms()
        if self.phase != "racing" or not player.racing or self.start_at is None:
            raise RoomError("you are not in a running race")
        if player.finish_ms is not None:
            raise RoomError("you already finished")
        check_finish_time(time_ms, now - self.start_at)
        player.finish_ms = time_ms
        if self.first_finish_at is None:
            self.first_finish_at = now
        self.results.append({"id": player.id, "name": player.name, "color": player.color, "time_ms": time_ms})
        self.results.sort(key=lambda r: r["time_ms"])
        place = next(i for i, r in enumerate(self.results, 1) if r["id"] == player.id)
        self.check_race_over(now)
        self.notify(now)
        return place

    # --- clock --------------------------------------------------------------

    def check_race_over(self, now: int):
        if self.phase != "racing" or self.start_at is None:
            return
        # A racer who dropped out (no stream, no state) is not waited for; they stay in the room meanwhile
        still_flying = [
            p
            for p in self.players.values()
            if p.racing and p.finish_ms is None and (p.connected or now - p.last_seen <= RACER_DROPPED_MS)
        ]
        called = self.first_finish_at is not None and now - self.first_finish_at > FINISH_GRACE_MS
        if not still_flying or called or now - self.start_at > RACE_TIMEOUT_MS:
            self.phase = "lobby"
            for player in self.players.values():
                player.racing = False

    def tick(self, now: int):
        changed = False

        if self.phase == "countdown" and self.start_at is not None and now >= self.start_at:
            self.phase = "racing"
            changed = True
        if self.phase == "racing":
            before = self.phase
            self.check_race_over(now)
            changed |= self.phase != before

        stale = [
            p for p in self.players.values() if not p.connected and now - p.last_seen > PLAYER_TIMEOUT_MS
        ]
        for player in stale:
            self.remove(player, now)
            changed = True
        if stale:
            self.check_race_over(now)

        if changed:
            self.notify(now)

        moved = any(p.moved for p in self.players.values())
        if moved or now - self.last_snapshot >= SNAPSHOT_KEEPALIVE_MS:
            message = self.snapshot(now)
            for player in self.players.values():
                player.moved = False
                if player.connected:
                    player.last_seen = now
            for listener in self.listeners():
                listener.push_snapshot(message)
            self.last_snapshot = now


class RoomManager:
    def __init__(self):
        self.rooms: dict[str, Room] = {}
        # When each pilot created their recent rooms (ms), for the per-hour limit
        self.created: dict[str, list[int]] = {}

    def get_or_create(self, code: str, seed: int | None = None, creator: str | None = None) -> Room:
        """The room with this code; a new one flies `seed` (if given), an existing one keeps its map"""
        room = self.rooms.get(code)
        if room is None:
            if len(self.rooms) >= MAX_ROOMS:
                raise RoomLimitError("All race rooms are busy right now. Try again in a few minutes.")
            if creator is not None:
                now = now_ms()
                recent = [t for t in self.created.get(creator, []) if now - t < 3_600_000]
                if len(recent) >= ROOMS_PER_CREATOR_HOUR:
                    raise RoomLimitError("You've opened a lot of rooms this hour. Join one, or try again later.")
                self.created[creator] = recent + [now]
            room = self.rooms[code] = Room(code, seed=seed)
        return room

    def find(self, code: str, token: str) -> tuple[Room, Player] | None:
        room = self.rooms.get(code)
        player = room.by_token.get(token) if room else None
        if room is None or player is None:
            return None
        return room, player

    def tick(self, now: int):
        for code, room in list(self.rooms.items()):
            room.tick(now)
            if room.empty_since is not None and now - room.empty_since > EMPTY_ROOM_TIMEOUT_MS:
                del self.rooms[code]

    async def run(self):
        while True:
            try:
                self.tick(now_ms())
            except Exception as e:  # keep relaying even if one tick fails
                print(f"Room tick failed: {e!r}")
            await asyncio.sleep(1 / TICK_HZ)
