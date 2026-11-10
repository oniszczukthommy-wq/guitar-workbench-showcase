#!/usr/bin/env python3
"""Import chords-only lead sheets from the user's selected personal source.

This importer is intentionally local-only. It stores no lyrics or source page
HTML, only title, performer, chord sequence, and an attribution URL.
"""
from __future__ import annotations

import html
import argparse
import json
import re
import sqlite3
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "library.sqlite3"
OUT_PATH = ROOT / "data" / "personal-chart-import.json"
BASE = "https://chord4.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    "Referer": BASE + "/",
}

# Recent-song lists first; the other lists add singalong staples if needed.
PLAYLISTS = [
    (320, "2026 华语热门歌曲"),
    (319, "2025 华语热门歌曲"),
    (20, "2016–2019 卖唱组"),
    (13, "四五个和弦的新手歌"),
    (6, "纪念一个人"),
    (197, "单恋博物馆"),
    (216, "粤语童年回忆"),
    (204, "708090"),
    (321, "林夕作品精选"),
    (322, "姚若龙词作精选"),
    (323, "陈乐融金曲精选"),
    (324, "黄霑作品精选"),
]
RANKED_PAGES = [
    ("/hot100", "近30天热门吉他谱 Top 100"),
    ("/hot100/rising", "正在上升吉他谱 Top 100"),
]

CHORD_RE = re.compile(
    r"(?<![A-Za-z])([A-G](?:#|b|s(?=(?:maj|m|min|dim|aug|add|\d)))?(?:maj(?:7|9|11|13)?|m(?:aj)?(?:7|9|11|13)?|min(?:or)?(?:7)?|"
    r"dim(?:7)?|aug(?:7)?|sus(?:2|4)?|add\d+|\d+(?:b5|#5|b9|#9|#11)?|5)?"
    r"(?:/[A-G](?:#|b|s(?=(?:maj|m|min|dim|aug|add|\d)))?)?)(?![A-Za-z])"
)
CJK_RE = re.compile(r"[\u3400-\u9fff]")
ROOT_RE = re.compile(r"^([A-G](?:#|b|s(?=(?:maj|m|min|dim|aug|add|\d)))?)(.*)$")
PITCH_CLASS = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11}
PITCH_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def fetch(url: str, tries: int = 4) -> str:
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=25) as response:
                return response.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
            time.sleep(1.0 + attempt * 1.5)
    raise RuntimeError(f"fetch failed: {url}: {last}")


def text_from_markup(markup: str) -> str:
    markup = re.sub(r"(?is)<br\s*/?>", "\n", markup)
    markup = re.sub(r"(?is)</(?:p|div|li|tr)>", "\n", markup)
    markup = re.sub(r"(?is)<[^>]+>", "", markup)
    return html.unescape(markup).replace("\xa0", " ")


def playlist_entries(ranked_only: bool = False) -> list[dict]:
    entries, seen = [], set()
    sources = [(BASE + path, label, None) for path, label in RANKED_PAGES]
    if not ranked_only:
        sources.extend((f"{BASE}/tablist/{playlist_id}", label, playlist_id) for playlist_id, label in PLAYLISTS)
    for page_url, label, playlist_id in sources:
        page = fetch(page_url)
        time.sleep(.15)
        for href, title in re.findall(r'href="(https?://chord4\.com/tabs/\d+/?)[^"]*"[^>]*>(.*?)</a>', page, re.S):
            match = re.search(r"/tabs/(\d+)", href)
            if not match or match.group(1) in seen:
                continue
            seen.add(match.group(1))
            entries.append({"id": match.group(1), "title_hint": text_from_markup(title).strip(), "playlist": label, "playlist_id": playlist_id})
    return entries


def normalize_note(note: str) -> str:
    return note[:-1] + "#" if note.endswith("s") else note


def normalize_chord(raw: str) -> str:
    raw = raw.strip().replace("♭", "b").replace("♯", "#").replace("−", "-")
    raw = raw.rstrip("*.,;:)")
    raw = re.sub(r"^\(([^()]*)\)$", r"\1", raw)
    match = ROOT_RE.match(raw)
    if not match:
        return ""
    root, suffix = match.groups()
    root = normalize_note(root)
    if suffix.startswith("/"):
        bass = suffix[1:]
        bm = re.match(r"^([A-G](?:#|b|s(?=(?:maj|m|min|dim|aug|add|\d)))?)$", bass)
        if bm:
            suffix = "/" + normalize_note(bm.group(1))
    suffix = re.sub(r"^min(?:or)?", "m", suffix)
    suffix = suffix.replace("major7", "maj7").replace("major", "")
    return root + suffix


def singalong_triads(chords: list[str], max_chords: int = 8) -> list[str]:
    """Reduce extensions/slash basses to accessible major/minor triads, then cap the palette."""
    triads = []
    for chord in chords:
        match = ROOT_RE.match(chord)
        if not match:
            triads.append(chord)
            continue
        root, suffix = match.groups()
        root = normalize_note(root)
        pc = PITCH_CLASS.get(root)
        if pc is None:
            triads.append(chord)
            continue
        canonical_root = PITCH_NAMES[pc]
        is_minor = suffix.startswith("m") and not suffix.startswith("maj")
        triads.append(canonical_root + ("m" if is_minor else ""))
    counts = {}
    first_seen = {}
    for index, chord in enumerate(triads):
        counts[chord] = counts.get(chord, 0) + 1
        first_seen.setdefault(chord, index)
    if len(counts) <= max_chords:
        return triads
    chosen = sorted(counts, key=lambda chord: (-counts[chord], first_seen[chord]))[:max_chords]
    chosen_info = []
    for chord in chosen:
        match = ROOT_RE.match(chord)
        root, suffix = match.groups()
        chosen_info.append((chord, PITCH_CLASS[root], suffix == "m", counts[chord]))
    result = []
    for chord in triads:
        if chord in chosen:
            result.append(chord)
            continue
        match = ROOT_RE.match(chord)
        root, suffix = match.groups()
        pc, minor = PITCH_CLASS[root], suffix == "m"
        # Keep quality where possible, then choose the closest retained chord.
        same_quality = [x for x in chosen_info if x[2] == minor] or chosen_info
        target = min(same_quality, key=lambda x: (min((pc - x[1]) % 12, (x[1] - pc) % 12), -x[3]))
        result.append(target[0])
    return result


def parse_chords(pre: str) -> list[str]:
    sequence: list[str] = []
    for original in pre.splitlines():
        line = original.strip()
        if not line or re.match(r"^(?:key\b|曲[:：]|词[:：]|编配者?[:：]|capo\b|play=|\[?(?:intro|verse|chorus|bridge|outro|solo|前奏|主歌|副歌|间奏|尾奏)\]?)", line, re.I):
            continue
        # The source often prints lyrics beneath chord labels in one pre block.
        # Keep only the chord-side prefix when a CJK lyric starts on the line.
        cjk = CJK_RE.search(line)
        if cjk:
            line = line[:cjk.start()]
        if not line.strip():
            continue
        tokens = [normalize_chord(m.group(1)) for m in CHORD_RE.finditer(line)]
        tokens = [x for x in tokens if x]
        if not tokens:
            continue
        residue = CHORD_RE.sub("", line)
        residue = re.sub(r"[|\s\-–—(){}\[\]<>/.,:;*]+", "", residue)
        # Discard prose lines (especially English lyrics); only accept lines
        # whose non-punctuation content consists of chord symbols.
        if re.search(r"[A-Za-z]", residue):
            continue
        # Bar marks group chord changes into measures; preserve the written order.
        sequence.extend(tokens)
    # Compress adjacent duplicates without altering the harmonic order.
    compact = []
    for chord in sequence:
        if not compact or chord != compact[-1]:
            compact.append(chord)
    return compact


def parse_song(entry: dict) -> dict | None:
    url = f"{BASE}/tabs/{entry['id']}"
    page = fetch(url)
    # Some pages are image-only or require a browser challenge. Skip rather
    # than inventing a playable chart.
    match = re.search(r'<div class="tabs_content"[^>]*>\s*<pre[^>]*>(.*?)</pre>', page, re.S | re.I)
    if not match:
        return None
    pre = text_from_markup(match.group(1))
    chords = parse_chords(pre)
    if len(chords) < 6:
        return None
    title = entry["title_hint"].replace("吉他谱", "").strip()
    artist = ""
    title_match = re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S | re.I)
    if title_match:
        title = re.sub(r"\s+", " ", text_from_markup(title_match.group(1))).strip()
    jsonld = re.search(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S | re.I)
    if jsonld:
        try:
            doc = json.loads(html.unescape(jsonld.group(1)))
            entity = doc.get("mainEntity", {})
            title = entity.get("name", title)
            artist_obj = entity.get("byArtist", {})
            artist = artist_obj.get("name", "") if isinstance(artist_obj, dict) else str(artist_obj)
        except (json.JSONDecodeError, AttributeError):
            pass
    if not title:
        return None

    bpm_match = re.search(r"(?:tempo|bpm)\s*[=:：]?\s*(\d{2,3})", pre, re.I)
    bpm = float(bpm_match.group(1)) if bpm_match else 80.0
    bpm = min(180.0, max(50.0, bpm))
    measure = 240.0 / bpm
    # Imported pages do not consistently annotate timing. Represent each
    # chord change on a four-beat measure grid and disclose the estimate.
    original_timeline = [
        {"start_time": round(i * measure, 3), "end_time": round((i + 1) * measure, 3), "chord": chord, "confidence": None}
        for i, chord in enumerate(chords)
    ]
    playable_chords = singalong_triads(chords)
    timeline = []
    for source_event, chord in zip(original_timeline, playable_chords):
        event = {**source_event, "chord": chord}
        if timeline and timeline[-1]["chord"] == chord:
            timeline[-1]["end_time"] = event["end_time"]
        else:
            timeline.append(event)
    return {
        "title": title,
        "artist": artist,
        "bpm": bpm,
        "lyrics": "",
        "chords": timeline,
        "original_chords": original_timeline,
        "source": f"Chord4 · {entry['playlist']} · page retrieved 2026-10-24 · chords-only personal import · simplified to at most 8 major/minor triads; original chord sequence retained · timing estimated at one chord per 4 beats · {url}",
        "reviewed": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ranked-only", action="store_true", help="Fetch only Chord4's current 30-day and rising chart pages")
    args = parser.parse_args()
    if not DB_PATH.exists():
        raise SystemExit(f"Local library not found: {DB_PATH}")
    candidates = playlist_entries(ranked_only=args.ranked_only)
    accepted = []
    errors = []
    for index, entry in enumerate(candidates, 1):
        try:
            song = parse_song(entry)
            if song:
                accepted.append(song)
        except Exception as exc:
            errors.append({"url": f"{BASE}/tabs/{entry['id']}", "error": str(exc)})
        if index % 20 == 0:
            print(f"scanned {index}/{len(candidates)} charts; playable {len(accepted)}", flush=True)
        time.sleep(.12)

    with sqlite3.connect(DB_PATH) as con:
        existing = {row[0].strip().casefold() for row in con.execute("SELECT title FROM songs")}
        added = []
        for song in accepted:
            key = song["title"].strip().casefold()
            if key in existing:
                continue
            song["id"] = str(uuid.uuid4())
            con.execute("INSERT INTO songs VALUES (?,?,?,?)", (song["id"], song["title"], json.dumps(song, ensure_ascii=False), time.time()))
            existing.add(key)
            added.append(song)
        con.commit()

    report = {
        "source": "Chord4 public singalong chart pages; local personal-use library import",
        "playlists": [{"id": p, "title": title} for p, title in PLAYLISTS],
        "ranked_pages": [{"path": p, "title": title} for p, title in RANKED_PAGES],
        "candidates": len(candidates),
        "playable_parsed": len(accepted),
        "added": len(added),
        "songs": [{"title": x["title"], "artist": x["artist"], "id": x["id"], "source": x["source"], "chords": len(x["chords"])} for x in added],
        "skipped_or_failed": errors,
        "lyrics_copied": False,
    }
    OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({k: report[k] for k in ["candidates", "playable_parsed", "added", "lyrics_copied"]}, ensure_ascii=False))
    print(f"report: {OUT_PATH}")


if __name__ == "__main__":
    main()
