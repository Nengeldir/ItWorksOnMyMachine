import asyncio
import json

import pytest

from rooms import (
    COUNTDOWN_MS,
    FINISH_GRACE_MS,
    PLAYER_TIMEOUT_MS,
    RACE_TIMEOUT_MS,
    RACER_DROPPED_MS,
    Listener,
    Room,
    RoomError,
)

T0 = 1_000_000


def messages(listener: Listener) -> list[dict]:
    return [json.loads(m) for m in listener.take()]


def test_join_assigns_distinct_colors_and_notifies():
    room = Room("ABC", now=T0)
    alice = room.join("u1", "Alice", now=T0)
    listener = Listener()
    alice.listeners.add(listener)
    bob = room.join("u2", "Bob", now=T0)

    assert alice.color != bob.color
    [event] = messages(listener)
    assert event["type"] == "room"
    assert [p["name"] for p in event["players"]] == ["Alice", "Bob"]


def test_snapshots_coalesce_for_slow_clients():
    room = Room("ABC", now=T0)
    alice = room.join("u1", "Alice", now=T0)
    listener = Listener()
    alice.listeners.add(listener)
    listener.take()

    for i in range(5):
        room.update_state(alice, T0 + i, [i, 2, 3], [0, 0, 0, 1], 40, 0, now=T0 + i)
        room.tick(T0 + 100 * (i + 1))

    [snap] = messages(listener)  # only the newest snapshot is kept
    assert snap["type"] == "snap"
    assert snap["players"] == [[alice.id, 4, 2, 3, 0, 0, 0, 1, 40, 0, T0 + 4, 0, 0, 0]]


def test_race_runs_from_countdown_to_results():
    room = Room("ABC", now=T0)
    alice = room.join("u1", "Alice", now=T0)
    bob = room.join("u2", "Bob", now=T0)
    for player in (alice, bob):
        player.listeners.add(Listener())

    room.start(now=T0)
    assert room.phase == "countdown"
    with pytest.raises(RoomError):
        room.start(now=T0)
    with pytest.raises(RoomError):
        room.finish(alice, 60_000, now=T0)

    room.tick(T0 + COUNTDOWN_MS)
    assert room.phase == "racing"

    start = room.start_at
    assert room.finish(bob, 62_000, now=start + 62_100) == 1
    assert room.finish(alice, 61_000, now=start + 62_200) == 1
    assert room.phase == "lobby"
    assert [r["name"] for r in room.results] == ["Alice", "Bob"]


def test_finish_faster_than_race_clock_is_rejected():
    room = Room("ABC", now=T0)
    alice = room.join("u1", "Alice", now=T0)
    room.start(now=T0)
    room.tick(T0 + COUNTDOWN_MS)

    with pytest.raises(RoomError):
        room.finish(alice, 10_000, now=room.start_at + 60_000)


def test_late_joiners_spectate_and_race_times_out():
    room = Room("ABC", now=T0)
    alice = room.join("u1", "Alice", now=T0)
    alice.listeners.add(Listener())
    room.start(now=T0)
    late = room.join("u2", "Late", now=T0 + 1)
    room.tick(T0 + COUNTDOWN_MS)

    assert alice.racing and not late.racing
    with pytest.raises(RoomError):
        room.finish(late, 30_000, now=room.start_at + 30_000)

    room.tick(room.start_at + RACE_TIMEOUT_MS + 1)
    assert room.phase == "lobby"


def test_disconnected_players_are_dropped():
    room = Room("ABC", now=T0)
    alice = room.join("u1", "Alice", now=T0)
    bob = room.join("u2", "Bob", now=T0)
    bob.listeners.add(Listener())

    room.tick(T0 + PLAYER_TIMEOUT_MS + 1)
    assert alice.id not in room.players
    assert bob.id in room.players


def test_listener_wakes_on_events():
    async def scenario():
        listener = Listener()
        waiter = asyncio.create_task(listener.next())
        await asyncio.sleep(0)
        listener.push_event("a")
        listener.push_snapshot("s1")
        listener.push_snapshot("s2")
        return await asyncio.wait_for(waiter, 1)

    assert asyncio.run(scenario()) == ["a", "s2"]


def test_finish_must_match_the_race_clock():
    room = Room("ABC", now=T0)
    alice = room.join("u1", "Alice", now=T0)
    room.start(now=T0)
    room.tick(T0 + COUNTDOWN_MS)

    # Claiming to have taken longer than the server saw is rejected too
    with pytest.raises(RoomError):
        room.finish(alice, 60_000, now=room.start_at + 40_000)
    # And nobody flies a course in 10 s, even if they wait 10 s to say so
    with pytest.raises(RoomError):
        room.finish(alice, 10_000, now=room.start_at + 10_000)


def test_rejoin_resumes_a_disconnected_player():
    room = Room("ABC", now=T0)
    first = room.join("u1", "Alice", now=T0)
    again = room.join("u1", "Alice B.", now=T0 + 1000)
    assert again is first and again.name == "Alice B."

    # A second tab that is still connected gets its own pilot
    first.listeners.add(Listener())
    other_tab = room.join("u1", "Alice", now=T0 + 2000)
    assert other_tab is not first
    assert len(room.players) == 2


def racing_room(*names: str) -> tuple[Room, list]:
    """A room whose pilots all have a stream open, with the race just under way"""
    room = Room("ABC", now=T0)
    players = [room.join(f"u{i}", name, now=T0) for i, name in enumerate(names)]
    for player in players:
        player.listeners.add(Listener())
    room.start(now=T0)
    room.tick(T0 + COUNTDOWN_MS)
    return room, players


def test_first_pilot_in_is_host_and_it_passes_on():
    room = Room("ABC", now=T0)
    alice = room.join("u1", "Alice", now=T0)
    bob = room.join("u2", "Bob", now=T0)
    carol = room.join("u3", "Carol", now=T0)
    carol.listeners.add(Listener())
    assert room.info(T0)["host"] == alice.id

    # Bob has no stream open, so Carol is the one who can act as host
    room.leave(alice, now=T0)
    assert room.host_id == carol.id
    room.leave(carol, now=T0)
    assert room.host_id == bob.id
    room.leave(bob, now=T0)
    assert room.host_id is None
    assert room.join("u4", "Dave", now=T0).id == room.host_id


def test_only_the_host_restarts_a_running_race():
    room, [alice, bob] = racing_room("Alice", "Bob")
    start = room.start_at
    room.finish(alice, 40_000, now=start + 40_000)

    with pytest.raises(RoomError):
        room.restart(bob, now=start + 41_000)
    room.restart(alice, now=start + 41_000)
    assert room.phase == "countdown"
    assert room.start_at == start + 41_000 + COUNTDOWN_MS
    assert room.results == [] and alice.finish_ms is None
    assert alice.racing and bob.racing

    # From the lobby it starts the next race like anyone's Start
    room.tick(room.start_at)
    room.finish(alice, 30_000, now=room.start_at + 30_000)
    room.finish(bob, 31_000, now=room.start_at + 31_000)
    assert room.phase == "lobby"
    room.restart(alice, now=room.start_at + 40_000)
    assert room.phase == "countdown"


def test_race_is_called_a_while_after_the_first_finish():
    room, [alice, bob] = racing_room("Alice", "Bob")
    start = room.start_at
    room.finish(alice, 40_000, now=start + 40_000)

    room.tick(start + 40_000 + FINISH_GRACE_MS)
    assert room.phase == "racing"
    room.tick(start + 40_000 + FINISH_GRACE_MS + 1)
    assert room.phase == "lobby"
    assert not bob.racing and [r["name"] for r in room.results] == ["Alice"]


def test_a_dropped_racer_does_not_hold_the_race_up():
    room, [alice, bob] = racing_room("Alice", "Bob")
    start = room.start_at
    room.finish(alice, 40_000, now=start + 40_000)

    # Bob's stream closes: a blip is forgiven, silence is not
    bob.listeners.clear()
    bob.last_seen = start + 41_000
    room.tick(start + 41_000 + RACER_DROPPED_MS)
    assert room.phase == "racing"
    room.tick(start + 41_000 + RACER_DROPPED_MS + 1)
    assert room.phase == "lobby"
    assert bob.id in room.players  # still in the room, for the next race
