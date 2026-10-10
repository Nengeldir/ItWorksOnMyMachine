from typing import Annotated

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


class TokenRequest(BaseModel):
    token: str


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


class LeaderboardEntry(BaseModel):
    rank: int
    name: str
    time_ms: int
    is_me: bool = False


class RunFinishResponse(BaseModel):
    rank: int
    personal_best_ms: int
    leaderboard: list[LeaderboardEntry]


class GhostRun(BaseModel):
    name: str
    time_ms: int
    ghost: Ghost
