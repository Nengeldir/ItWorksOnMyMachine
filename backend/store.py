"""Finished runs, per seed, in a SQLite file (kept on a Docker volume)."""

import json
import os
import sqlite3
import time

from models import Ghost, GhostRun, LeaderboardEntry


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        # Only used from the event loop thread, one statement at a time
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY,
                seed INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                time_ms INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                ghost TEXT
            )
            """
        )
        self.db.execute("CREATE INDEX IF NOT EXISTS runs_seed_time ON runs (seed, time_ms)")
        self.db.commit()

    def best(self, seed: int, user_id: str) -> int | None:
        row = self.db.execute(
            "SELECT MIN(time_ms) AS best FROM runs WHERE seed = ? AND user_id = ?", (seed, user_id)
        ).fetchone()
        return row["best"]

    def add_run(self, seed: int, user_id: str, name: str, time_ms: int, ghost: Ghost | None) -> int:
        """Stores a run. Only a user's best run per seed keeps its ghost, to save space."""
        previous_best = self.best(seed, user_id)
        is_best = previous_best is None or time_ms < previous_best
        if is_best:
            self.db.execute("UPDATE runs SET ghost = NULL WHERE seed = ? AND user_id = ?", (seed, user_id))
        self.db.execute(
            "INSERT INTO runs (seed, user_id, name, time_ms, created_at, ghost) VALUES (?, ?, ?, ?, ?, ?)",
            (
                seed,
                user_id,
                name,
                time_ms,
                int(time.time()),
                ghost.model_dump_json() if ghost and is_best else None,
            ),
        )
        self.db.commit()
        return time_ms if is_best else previous_best

    def leaderboard(self, seed: int, limit: int = 10, me: str | None = None) -> list[LeaderboardEntry]:
        # SQLite fills the bare columns (name) from the row that holds MIN(time_ms)
        rows = self.db.execute(
            """
            SELECT user_id, name, MIN(time_ms) AS time_ms FROM runs
            WHERE seed = ? GROUP BY user_id ORDER BY time_ms LIMIT ?
            """,
            (seed, limit),
        ).fetchall()
        return [
            LeaderboardEntry(rank=i, name=row["name"], time_ms=row["time_ms"], is_me=row["user_id"] == me)
            for i, row in enumerate(rows, 1)
        ]

    def rank(self, seed: int, time_ms: int) -> int:
        """The place a time takes among every user's best on this seed."""
        row = self.db.execute(
            """
            SELECT COUNT(*) AS faster FROM (
                SELECT MIN(time_ms) AS best FROM runs WHERE seed = ? GROUP BY user_id
            ) WHERE best < ?
            """,
            (seed, time_ms),
        ).fetchone()
        return row["faster"] + 1

    def ghosts(self, seed: int, limit: int = 3) -> list[GhostRun]:
        rows = self.db.execute(
            """
            SELECT name, time_ms, ghost FROM runs
            WHERE seed = ? AND ghost IS NOT NULL ORDER BY time_ms LIMIT ?
            """,
            (seed, limit),
        ).fetchall()
        return [
            GhostRun(name=row["name"], time_ms=row["time_ms"], ghost=Ghost(**json.loads(row["ghost"])))
            for row in rows
        ]
