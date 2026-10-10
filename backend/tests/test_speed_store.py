import sqlite3
from store import Store


def test_legacy_results_are_preserved_but_excluded(tmp_path):
    path = str(tmp_path / "scores.db")
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE runs (id INTEGER PRIMARY KEY, seed INTEGER NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, time_ms INTEGER NOT NULL, created_at INTEGER NOT NULL, ghost TEXT)")
    db.execute("INSERT INTO runs VALUES (1, 42, 'pilot', 'Old', 30000, 0, NULL)")
    db.commit()
    db.close()
    store = Store(path)
    store.db.execute("INSERT INTO runs (seed,user_id,name,time_ms,created_at,rules) VALUES (42,'v1','V1',25000,0,'speed-control-v1')")
    store.db.commit()
    assert store.leaderboard(42) == []
    assert store.add_run(42, "pilot", "New", 40000, None) == 40000
    assert store.leaderboard(42)[0].time_ms == 40000
    assert store.db.execute("SELECT time_ms FROM runs WHERE rules='legacy'").fetchone()[0] == 30000
    assert store.rank(42, 35000, "other") == 1
    store.db.close()
