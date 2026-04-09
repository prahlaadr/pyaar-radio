"""DuckDB schema initialization and helpers for Pyaar Radar."""

import json
from datetime import datetime, UTC
from pathlib import Path

import duckdb

RADAR_DIR = Path(__file__).parent
DB_PATH = RADAR_DIR / "state.db"
PROJECT_DIR = RADAR_DIR.parent
ALBUMS_DIR = PROJECT_DIR / "albums"


def get_db(db_path: Path = DB_PATH) -> duckdb.DuckDBPyConnection:
    db = duckdb.connect(str(db_path))
    _init_schema(db)
    return db


def _init_schema(db: duckdb.DuckDBPyConnection):
    db.execute("""
        CREATE TABLE IF NOT EXISTS known_albums (
            browse_id TEXT PRIMARY KEY,
            title TEXT,
            artist TEXT,
            year TEXT,
            track_count INTEGER,
            source TEXT,
            first_seen_at TIMESTAMP
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS release_alerts (
            id INTEGER PRIMARY KEY,
            artist TEXT,
            title TEXT,
            browse_id TEXT,
            year TEXT,
            release_type TEXT,
            detected_at TIMESTAMP,
            status TEXT DEFAULT 'new',
            source TEXT
        )
    """)
    db.execute("""
        CREATE SEQUENCE IF NOT EXISTS release_alerts_seq START 1
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS discovery_suggestions (
            id INTEGER PRIMARY KEY,
            suggested_artist TEXT,
            reason TEXT,
            related_to TEXT,
            genres TEXT,
            popularity INTEGER,
            suggested_at TIMESTAMP,
            status TEXT DEFAULT 'new'
        )
    """)


def seed_from_albums(db: duckdb.DuckDBPyConnection, albums_dir: Path = ALBUMS_DIR):
    """Seed known_albums from individual album JSON files."""
    existing = db.execute("SELECT browse_id FROM known_albums").fetchall()
    existing_ids = {row[0] for row in existing}

    index_path = albums_dir / "_index.json"
    if not index_path.exists():
        print(f"ERROR: {index_path} not found")
        return 0

    with open(index_path, "r", encoding="utf-8") as f:
        index_data = json.load(f)

    now = datetime.now(UTC)
    inserted = 0

    for album in index_data.get("albums", []):
        browse_id = album.get("browseId", "")
        if not browse_id or browse_id in existing_ids:
            continue

        # Try to get year from individual album JSON (index doesn't have it)
        year = ""
        album_file = albums_dir / f"{browse_id}.json"
        if album_file.exists():
            try:
                with open(album_file, "r", encoding="utf-8") as f:
                    detail = json.load(f)
                year = detail.get("year", "")
            except (json.JSONDecodeError, KeyError):
                pass

        db.execute(
            "INSERT INTO known_albums (browse_id, title, artist, year, track_count, source, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [browse_id, album.get("title", ""), album.get("artist", ""), year, album.get("trackCount", 0), "library_seed", now],
        )
        inserted += 1

    return inserted


def get_known_browse_ids(db: duckdb.DuckDBPyConnection) -> set[str]:
    rows = db.execute("SELECT browse_id FROM known_albums").fetchall()
    return {row[0] for row in rows}
