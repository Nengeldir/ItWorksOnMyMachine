from fastapi.testclient import TestClient

import app as app_module
from app import app, rooms
from rooms import COUNTDOWN_MS

client = TestClient(app)


def ghost(n=3):
    return {"hz": 15, "samples": [[i * 66, 0, 10, i, 0, 0, 0, 1] for i in range(n)]}


def test_time_and_me():
    assert client.get("/api/time").json()["t"] > 0
    me = client.get("/api/me", headers={"X-User-Id": "zoe@ethz.ch", "X-User-Name": "Zo%C3%AB"}).json()
    assert me == {"id": "zoe@ethz.ch", "name": "Zoë", "verified": True}


def test_room_flow():
    joined = client.post("/api/rooms/race1/join", json={"client_id": "c1", "nickname": "  Ace   Pilot "}).json()
    assert joined["room"]["code"] == "RACE1"
    assert joined["room"]["players"][0]["name"] == "Ace Pilot"
    token = joined["token"]

    state = {"token": token, "t": 1.0, "p": [1, 2, 3], "q": [0, 0, 0, 1], "v": 42.0, "cp": 0}
    assert client.post("/api/rooms/RACE1/state", json=state).status_code == 204
    assert client.post("/api/rooms/RACE1/state", json={**state, "p": [1, 2]}).status_code == 422
    assert client.post("/api/rooms/RACE1/state", json={**state, "token": "nope"}).status_code == 404

    assert client.post("/api/rooms/RACE1/start", json={"token": token}).status_code == 204
    room = rooms.rooms["RACE1"]
    room.start_at -= COUNTDOWN_MS + 60_000  # pretend the race has been running for a minute
    room.tick(room.start_at + COUNTDOWN_MS + 60_000)

    finished = client.post(
        "/api/rooms/RACE1/finish", json={"token": token, "time_ms": 59_000, "ghost": ghost()}
    ).json()
    assert finished["place"] == 1
    assert client.get("/api/rooms/RACE1").json()["phase"] == "lobby"

    board = client.get("/api/leaderboard", params={"seed": room.seed, "client_id": "c1"}).json()
    assert board[0]["name"] == "Ace Pilot" and board[0]["is_me"]

    assert client.post("/api/rooms/RACE1/leave", json={"token": token}).status_code == 204
    assert client.get("/api/rooms/RACE1").json()["players"] == []


def test_bad_room_code():
    assert client.post("/api/rooms/no!/join", json={"client_id": "c1"}).status_code == 400
    assert client.post("/api/rooms/ABC%0A/join", json={"client_id": "c1"}).status_code == 400


def test_stream_with_stale_token_is_404():
    assert client.get("/api/rooms/RACE1/stream", params={"token": "stale"}).status_code == 404


def test_solo_runs_and_ghosts():
    seed = 4242
    for client_id, time_ms in [("a", 70_000), ("b", 65_000), ("a", 68_000)]:
        token = client.post("/api/runs/start", json={"seed": seed}).json()["run_token"]
        # Pretend the clock started long enough ago
        s, started = app_module.solo_runs[token]
        app_module.solo_runs[token] = (s, started - time_ms)
        result = client.post(
            "/api/runs/finish",
            json={"run_token": token, "time_ms": time_ms, "client_id": client_id, "nickname": client_id.upper(), "ghost": ghost()},
        ).json()

    # 68 s against B's 65 s; A's own earlier 70 s doesn't count against it
    assert result["rank"] == 2
    assert result["personal_best_ms"] == 68_000
    assert [(e["name"], e["time_ms"]) for e in result["leaderboard"]] == [("B", 65_000), ("A", 68_000)]

    ghosts = client.get("/api/ghosts", params={"seed": seed}).json()
    assert [(g["name"], g["time_ms"]) for g in ghosts] == [("B", 65_000), ("A", 68_000)]


def test_solo_finish_faster_than_server_clock_is_rejected():
    token = client.post("/api/runs/start", json={"seed": 7}).json()["run_token"]
    s, started = app_module.solo_runs[token]
    app_module.solo_runs[token] = (s, started - 90_000)
    response = client.post("/api/runs/finish", json={"run_token": token, "time_ms": 30_000, "client_id": "x"})
    assert response.status_code == 409


def test_solo_finish_right_after_start_is_rejected():
    token = client.post("/api/runs/start", json={"seed": 7}).json()["run_token"]
    response = client.post("/api/runs/finish", json={"run_token": token, "time_ms": 1_000, "client_id": "x"})
    assert response.status_code == 409


def test_own_slower_run_ranks_against_others_only():
    seed = 999
    for time_ms in (60_000, 70_000):
        token = client.post("/api/runs/start", json={"seed": seed}).json()["run_token"]
        s, started = app_module.solo_runs[token]
        app_module.solo_runs[token] = (s, started - time_ms)
        result = client.post(
            "/api/runs/finish", json={"run_token": token, "time_ms": time_ms, "client_id": "solo"}
        ).json()
    assert result["rank"] == 1
    assert result["personal_best_ms"] == 60_000
