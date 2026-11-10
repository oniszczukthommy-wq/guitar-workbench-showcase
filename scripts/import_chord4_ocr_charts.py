#!/usr/bin/env python3
"""Import chord-only timelines from OCR observations of local Chord4 chart images.

Temporary source images and OCR JSON stay outside the repository. This importer
stores only recognized chord labels, title/artist, timing estimates, and source
URLs; it never stores lyrics or chart images.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
import uuid
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.import_personal_chart_catalog import singalong_triads  # noqa: E402

CHORD = re.compile(
    r"(?<![A-Za-z])([A-G](?:#|b)?(?:maj(?:7|9|11|13)?|m(?:aj)?(?:7|9|11|13)?|"
    r"min(?:or)?(?:7)?|dim(?:7)?|aug(?:7)?|sus(?:2|4)?|add\d+|"
    r"\d+(?:b5|#5|b9|#9|#11)?|5)?(?:/[A-G](?:#|b)?)?)(?![A-Za-z])"
)
SECTION = re.compile(r"^(?:Intro|Verse|Chorus|Bridge|Solo|Outro|前奏|主歌|副歌|间奏|尾奏)\s*[:：]?\s*", re.I)
META = re.compile(r"key|capo|bpm|tempo|\d\s*/\s*\d", re.I)
SEPARATORS = re.compile(r"[|\s\-–—(){}\[\]<>/.,:;*]+")


def observations_to_chords(page: dict, observations: dict[str, list[dict]]) -> list[str]:
    sequence: list[str] = []
    for path in page.get("local_images", []):
        for item in sorted(observations.get(path, []), key=lambda row: (-row["y"], row["x"])):
            line = item["text"].strip().replace("♭", "b").replace("♯", "#")
            if not line or META.search(line):
                continue
            line = SECTION.sub("", line)
            tokens = CHORD.findall(line)
            residue = SEPARATORS.sub("", CHORD.sub("", line))
            # Reject prose and OCR snippets whose leftovers contain letters.
            if tokens and not re.search(r"[A-Za-z]", residue):
                sequence.extend(tokens)
    compact: list[str] = []
    for token in sequence:
        if not compact or token != compact[-1]:
            compact.append(token)
    return compact


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=Path, required=True)
    parser.add_argument("--ocr", type=Path, required=True)
    parser.add_argument("--min-chords", type=int, default=6)
    parser.add_argument("--min-unique", type=int, default=3)
    args = parser.parse_args()
    pages = json.loads(args.pages.read_text())
    ocr = json.loads(args.ocr.read_text())
    observed: dict[str, list[dict]] = defaultdict(list)
    for item in ocr:
        observed[item["path"]].append(item)

    con = sqlite3.connect(ROOT / "data/library.sqlite3")
    existing = {row[0].strip().casefold() for row in con.execute("SELECT title FROM songs")}
    added = []
    for page in pages:
        sequence = observations_to_chords(page, observed)
        if len(sequence) < args.min_chords or len(set(sequence)) < args.min_unique:
            continue
        title = page["title"].strip()
        if title.casefold() in existing:
            continue
        beat_seconds = 60 / 80
        measure_seconds = beat_seconds * 4
        original = [
            {"start_time": round(i * measure_seconds, 3), "end_time": round((i + 1) * measure_seconds, 3), "chord": chord, "confidence": None}
            for i, chord in enumerate(sequence)
        ]
        playable = singalong_triads(sequence)
        timeline = []
        for i, chord in enumerate(playable):
            event = {**original[i], "chord": chord}
            if timeline and timeline[-1]["chord"] == chord:
                timeline[-1]["end_time"] = event["end_time"]
            else:
                timeline.append(event)
        song = {
            "id": str(uuid.uuid4()), "title": title, "artist": page.get("artist", ""),
            "bpm": 80, "lyrics": "", "chords": timeline, "original_chords": original,
            "source": (
                f"Chord4 · {page['group']} · page retrieved 2026-10-24 · chord symbols OCR from source chart image; "
                f"no lyrics stored · simplified to at most 8 major/minor triads; original OCR chord sequence retained · "
                f"timing estimated at one chord per 4 beats at 80 BPM · {page['source']}"
            ),
            "reviewed": False,
        }
        con.execute("INSERT INTO songs VALUES (?,?,?,?)", (song["id"], title, json.dumps(song, ensure_ascii=False), time.time()))
        existing.add(title.casefold())
        added.append({"id": song["id"], "title": title, "artist": song["artist"], "chord_labels": len(sequence), "source": page["source"]})
    con.commit()
    con.close()
    print(json.dumps({"added": len(added), "songs": added, "lyrics_stored": False}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
