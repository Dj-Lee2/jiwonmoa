"""수집 실행: 출처별 전체 목록을 받아 원본을 보관하고, 공통 형식으로 바꿔 DB에 반영한다.

실행: python collector/collect.py              (전체)
      python collector/collect.py bizinfo gov24 (일부 출처만)
      python collector/collect.py --reprocess   (새로 받지 않고 마지막 원본으로 판정만 다시)

한 출처가 실패해도 나머지는 계속한다. 실패한 출처의 기존 자료는 건드리지 않고,
runs 표에 오류를 남긴다(화면의 '수집 오류' 표시용).
"""
import datetime
import gzip
import json
import shutil
import sqlite3
import sys
import time

from common import RAW_DIR, ROOT, load_service_key
from normalize import normalize
from sources import SOURCES, FetchError

DB_PATH = ROOT / "data" / "hub.db"
KEEP_RAW_DAYS = 14

FIELDS = ["uid", "source", "kind", "title", "agency", "operator", "category", "target", "summary",
          "content", "how", "audience", "personas", "posted", "views", "support",
          "period_text", "period_type", "apply_start", "apply_end", "regions", "region_basis",
          "agri", "agri_basis", "fish", "is_private", "url", "apply_url", "contact", "files",
          "conditions", "details", "purpose", "attachments", "source_updated", "content_hash"]

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS notices (
    {", ".join(f + " TEXT" for f in FIELDS)},
    first_seen TEXT, last_seen TEXT, changed_at TEXT, seen_at TEXT,
    PRIMARY KEY (uid)
);
CREATE TABLE IF NOT EXISTS runs (
    run_at TEXT, source TEXT, ok INTEGER, fetched INTEGER, expected INTEGER,
    notices INTEGER, seconds REAL, error TEXT
);
"""


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    have = {r["name"] for r in conn.execute("PRAGMA table_info(notices)")}
    # 항목이 늘어난 경우 기존 DB에 열을 더한다. seen_at = 마지막으로 보인 수집 시각(하루 여러 번 수집하므로
    # 날짜(last_seen)만으로는 오전에 있다가 오후에 사라진 공고를 가릴 수 없다)
    for f in FIELDS + ["seen_at"]:
        if f not in have:
            conn.execute(f"ALTER TABLE notices ADD COLUMN {f} TEXT")
    return conn


def save_raw(day, source, items):
    out = RAW_DIR / day
    out.mkdir(parents=True, exist_ok=True)
    with gzip.open(out / f"{source}.json.gz", "wt", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)


def prune_raw():
    days = sorted(p for p in RAW_DIR.glob("20??-??-??") if p.is_dir())
    for old in days[:-KEEP_RAW_DAYS]:
        shutil.rmtree(old)


def upsert(conn, records, day, seen_at=None):
    """새 공고는 first_seen, 내용이 바뀐 공고는 changed_at을 오늘로 기록한다. seen_at은 이번 수집 시각
    (없으면 — 다시 정리할 때 — 그대로 둔다)."""
    for rec in records:
        row = conn.execute("SELECT content_hash FROM notices WHERE uid = ?", (rec["uid"],)).fetchone()
        values = [rec.get(f) for f in FIELDS]
        if row is None:
            conn.execute(
                f"INSERT INTO notices ({', '.join(FIELDS)}, first_seen, last_seen, changed_at, seen_at) "
                f"VALUES ({', '.join('?' * len(FIELDS))}, ?, ?, NULL, ?)", values + [day, day, seen_at])
        else:
            changed = row["content_hash"] != rec["content_hash"]
            conn.execute(
                f"UPDATE notices SET {', '.join(f + ' = ?' for f in FIELDS)}, last_seen = ?, seen_at = COALESCE(?, seen_at)"
                + (", changed_at = ?" if changed else "") + " WHERE uid = ?",
                values + [day, seen_at] + ([day] if changed else []) + [rec["uid"]])


def main(selected):
    key = load_service_key()
    now = datetime.datetime.now()
    day, run_at = now.date().isoformat(), now.isoformat(timespec="seconds")
    conn = connect()

    for source in selected:
        started = time.time()
        try:
            items, expected = SOURCES[source](key)
            save_raw(day, source, items)
            records = normalize(source, items)
            upsert(conn, records, day, run_at)
            ok, error = 1, "" if len(items) >= expected else f"일부만 수집 ({len(items)}/{expected})"
            print(f"{source}: 원본 {len(items)}건 → 공고 {len(records)}건 {error}")
        except FetchError as e:
            items, expected, records, ok, error = [], 0, [], 0, str(e)[:500]
            print(f"{source}: 실패 — {error}")
        conn.execute("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (run_at, source, ok, len(items), expected, len(records),
                      round(time.time() - started, 1), error))
        conn.commit()

    prune_raw()
    conn.close()


def reprocess(selected):
    """판정 규칙을 고친 뒤, 출처별 마지막 원본으로 다시 정리한다. 수집 기록(runs)은 남기지 않는다."""
    conn = connect()
    for source in selected:
        runs = sorted(RAW_DIR.glob(f"20??-??-??/{source}.json.gz"))
        if not runs:
            print(f"{source}: 보관된 원본 없음")
            continue
        path = runs[-1]
        with gzip.open(path, "rt", encoding="utf-8") as f:
            items = json.load(f)
        records = normalize(source, items)
        # 원본은 날마다 마지막 수집만 남으므로, 그날 마지막 성공 수집 시각을 그대로 붙인다
        last = conn.execute("SELECT MAX(run_at) FROM runs WHERE source = ? AND ok = 1 AND run_at LIKE ?",
                            (source, path.parent.name + "%")).fetchone()[0]
        upsert(conn, records, path.parent.name, last)
        conn.commit()
        print(f"{source}: {path.parent.name} 원본 {len(items)}건 → {len(records)}건 다시 정리")
    conn.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(errors="replace")
    args = sys.argv[1:]
    redo = "--reprocess" in args
    args = [a for a in args if a != "--reprocess"] or list(SOURCES)
    unknown = [a for a in args if a not in SOURCES]
    if unknown:
        raise SystemExit(f"모르는 출처: {unknown}. 가능한 값: {list(SOURCES)}")
    if redo:
        reprocess(args)
    else:
        main(args)
