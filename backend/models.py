from typing import Annotated, Any

from pydantic import BaseModel, Field, FiniteFloat, field_validator

# Ids the browser makes up for itself (stored in localStorage)
ClientId = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
Nickname = Annotated[str, Field(max_length=40)]
Seed = Annotated[int, Field(ge=1, le=2_147_483_647)]
# A race takes between a few seconds and an hour
RaceTime = Annotated[int, Field(ge=1_000, le=3_600_000)]

GHOST_HZ_MAX = 30
GHOST_SAMPLES_MAX = 15 * 600  # 10 minutes at 15 Hz; clients thin out longer recordings


class User(BaseModel):
    id: str
    name: str
    # True when the VIScon portal vouched for the user (login headers present)
    verified: bool = False


class Me(User):
    # Ever finished a race or time trial (this account, or this browser for guests): newcomers get the tutorial
    has_played: bool = False


class Ghost(BaseModel):
    """A recorded run: samples of [t_ms, x, y, z, qx, qy, qz, qw, boost?, brake?, dodge?]."""

    hz: Annotated[int, Field(ge=1, le=GHOST_HZ_MAX)]
    samples: Annotated[list[list[FiniteFloat]], Field(max_length=GHOST_SAMPLES_MAX)]

    @field_validator("samples")
    @classmethod
    def check_samples(cls, samples: list[list[float]]) -> list[list[float]]:
        if any(len(sample) not in (8, 10, 11) for sample in samples):
            raise ValueError("each ghost sample must have 8, 10 or 11 numbers")
        if any(len(sample) >= 10 and any(not 0 <= value <= 1 for value in sample[8:10]) for sample in samples):
            raise ValueError("ghost boost and brake must be between 0 and 1")
        if any(len(sample) == 11 and not -1 <= sample[10] <= 1 for sample in samples):
            raise ValueError("ghost dodge progress must be between -1 and 1")
        return samples


class JoinRequest(BaseModel):
    client_id: ClientId
    nickname: Nickname = ""
    # Creating the room: fly this map (picked in the map select). Joining one that exists: ignored
    seed: Seed | None = None


class TokenRequest(BaseModel):
    token: str


class MapRequest(TokenRequest):
    # The map picked in the map select; none picks one at random
    seed: Seed | None = None


class StateRequest(BaseModel):
    token: str
    t: FiniteFloat  # when the state was sampled, in server time (ms)
    p: Annotated[list[FiniteFloat], Field(min_length=3, max_length=3)]
    q: Annotated[list[FiniteFloat], Field(min_length=4, max_length=4)]
    boost: Annotated[FiniteFloat, Field(ge=0, le=1)] = 0
    brake: Annotated[FiniteFloat, Field(ge=0, le=1)] = 0
    dodge: Annotated[FiniteFloat, Field(ge=-1, le=1)] = 0
    v: FiniteFloat
    cp: Annotated[int, Field(ge=-1, le=1000)]  # checkpoints passed


class FinishRequest(BaseModel):
    token: str
    time_ms: RaceTime
    ghost: Ghost | None = None
    # Gates on the course, for the finisher's XP (older clients send none)
    gates: Annotated[int, Field(ge=0, le=60)] = 0


class RunStartRequest(BaseModel):
    seed: Seed


class RunStartResponse(BaseModel):
    run_token: str


class RunFinishRequest(BaseModel):
    run_token: str
    time_ms: RaceTime
    client_id: ClientId
    nickname: Nickname = ""
    ghost: Ghost | None = None
    gates: Annotated[int, Field(ge=0, le=60)] = 0


class LeaderboardEntry(BaseModel):
    rank: int
    name: str
    time_ms: int
    is_me: bool = False


class RunFinishResponse(BaseModel):
    rank: int
    personal_best_ms: int
    leaderboard: list[LeaderboardEntry]
    xp: int = 0


class GhostRun(BaseModel):
    name: str
    time_ms: int
    ghost: Ghost


class AdventureStartRequest(JoinRequest):
    seed: Seed


class PickupClaimRequest(JoinRequest):
    token: Annotated[str, Field(min_length=1, max_length=128)]
    pickups: Annotated[list[Annotated[str, Field(max_length=32)]], Field(min_length=1, max_length=24)]


class InventoryActionsRequest(JoinRequest):
    """A batch of inventory actions (inventory.py checks each one: kinds, ids, counts)"""
    actions: Annotated[list[dict[str, Any]], Field(min_length=1, max_length=50)]


class EquipRequest(JoinRequest):
    slot: Annotated[str, Field(pattern=r"^(cape|hat|shoes|wings|pet|jar|charm)$")]
    asset: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]


class RunReportRequest(JoinRequest):
    """A finished or abandoned adventure, as the client flew it (checked on the server)"""
    token: Annotated[str, Field(min_length=1, max_length=128)]
    score: Annotated[int, Field(ge=0, le=400_000)]
    levels: Annotated[int, Field(ge=1, le=8)]
    completed: bool = False
    gates: Annotated[int, Field(ge=0, le=300)]
    time_ms: Annotated[int, Field(ge=0, le=7_200_000)]
    crashes: Annotated[int, Field(ge=0, le=1000)] = 0


class PetNameRequest(JoinRequest):
    pet: Annotated[str, Field(pattern=r"^[a-z]{2,16}$")]
    name: Annotated[str, Field(max_length=40)] = ""


class StyleRequest(JoinRequest):
    style: Annotated[int, Field(ge=1, le=2)]


class BuyRequest(JoinRequest):
    key: Annotated[str, Field(min_length=3, max_length=48, pattern=r"^[a-z]+:[A-Za-z0-9_-]+$")]
