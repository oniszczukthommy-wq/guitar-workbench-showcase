#!/usr/bin/env python3
"""Attach current chart-list evidence to existing Chord4 songs without duplicates."""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("catalog", ROOT / "scripts/import_personal_chart_catalog.py")
catalog = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = catalog
spec.loader.exec_module(catalog)


def main() -> None:
    entries = catalog.playlist_entries(ranked_only=True)
    evidence: dict[str, list[dict]] = {}
    errors = 0
    for index, entry in enumerate(entries, 1):
        try:
            parsed = catalog.parse_song(entry)
            if not parsed:
                continue
            title = parsed["title"].strip().casefold()
            chart = "https://chord4.com/hot100/rising" if "上升" in entry["playlist"] else "https://chord4.com/hot100"
            item = {"name": entry["playlist"], "chart_url": chart, "score_url": f"https://chord4.com/tabs/{entry['id']}", "retrieved_at": "2026-10-24"}
            if item not in evidence.setdefault(title, []):
                evidence[title].append(item)
        except Exception:
            errors += 1
        if index % 40 == 0:
            print(f"checked {index}/{len(entries)}; playable chart entries {len(evidence)}", flush=True)
        time.sleep(.04)

    con = sqlite3.connect(ROOT / "data/library.sqlite3")
    rows = con.execute("SELECT id,document FROM songs").fetchall()
    matched = 0
    for song_id, raw in rows:
        song = json.loads(raw)
        current = evidence.get(song["title"].strip().casefold())
        if not current:
            continue
        prior = song.get("chart_evidence", [])
        merged = prior + [item for item in current if item not in prior]
        if merged != prior:
            song["chart_evidence"] = merged
            con.execute("UPDATE songs SET document=?,updated=? WHERE id=?", (json.dumps(song, ensure_ascii=False), time.time(), song_id))
        matched += 1
    con.commit()
    con.close()
    print(json.dumps({"rank_candidates": len(entries), "playable_unique_titles": len(evidence), "matched_library_titles": matched, "unmatched_playable_titles": sorted(set(evidence)-{json.loads(row[1])["title"].strip().casefold() for row in rows}), "errors": errors}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
