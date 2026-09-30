"""0단계 점검 보고서: DB의 최신 수집분으로 건수·상태·지역·농업 판정을 요약한다.

실행: python collector/report.py
결과: reports/step0_YYYYMMDD.md (요약)
      data/export/notices_YYYYMMDD.csv (전체 목록, 엑셀용)
      data/export/agri_review_YYYYMMDD.csv (농업 판정 검수용 — '검수' 열에 O/X 기입)
"""
import csv
import datetime
import json
import sqlite3
import sys
from collections import Counter

from collect import DB_PATH
from common import ROOT
from normalize import NATIONWIDE, REGIONS, status_of

SOURCE_NAMES = {"bizinfo": "기업마당", "kstartup": "K-Startup", "gov24": "보조금24", "bojo": "국고보조금 공모"}
OPEN_STATUSES = ("접수 중", "접수 예정", "상시", "소진 시까지", "매년 정기")
STATUS_ORDER = ["접수 중", "접수 예정", "소진 시까지", "상시", "매년 정기", "신청 불필요", "확인 필요", "마감"]


def load(conn):
    """출처별 마지막 성공 수집일에 보였던 공고만 '현재 자료'로 본다."""
    last = {r["source"]: r["run_at"][:10] for r in conn.execute(
        "SELECT source, MAX(run_at) AS run_at FROM runs WHERE ok = 1 GROUP BY source")}
    rows = []
    for r in conn.execute("SELECT * FROM notices"):
        r = dict(r)
        if last.get(r["source"]) == r["last_seen"]:
            r["regions"] = json.loads(r["regions"] or "[]")
            r["agri"] = int(r["agri"] or 0)
            rows.append(r)
    runs = [dict(r) for r in conn.execute(
        "SELECT * FROM runs WHERE run_at = (SELECT MAX(run_at) FROM runs r2 WHERE r2.source = runs.source)")]
    return rows, runs


def pct(n, total):
    return f"{n:,} ({n / total:.0%})" if total else "0"


def table(header, rows):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(out)


def region_text(regions):
    return ", ".join(regions) if regions else "미상"


def build(rows, runs, today):
    for r in rows:
        r["status"] = status_of(r, today)
    by_src = {s: [r for r in rows if r["source"] == s] for s in SOURCE_NAMES}
    md = [f"# 0단계 점검 보고서 ({today})",
          "",
          "수집한 자료 기준의 집계입니다. 전국의 모든 지원사업 수가 아닙니다.",
          "지역·농업 판정은 규칙 기반 1차 판정이며, 검수 파일로 확인이 필요합니다.",
          "",
          "## 1. 수집 현황",
          table(["출처", "마지막 수집", "원본 건수", "정리된 건수", "소요(초)", "오류"],
                [[SOURCE_NAMES[r["source"]], r["run_at"].replace("T", " "), f"{r['fetched']:,}",
                  f"{r['notices']:,}", r["seconds"], r["error"] or "-"] for r in runs]),
          "",
          "- 기업마당: 현재 게시 중인 공고만 제공됩니다(마감 공고 없음).",
          "- K-Startup: 모집 중인 공고만 받았습니다. `민간` 주관 공고가 섞여 있습니다.",
          "- 보조금24: 모집 공고가 아니라 상시 제도 안내 성격입니다.",
          "- 국고보조금 공모: 올해 게시된 공모 공고 전체(마감 포함)입니다. 수행기관별 행을 공고 단위로 묶었습니다.",
          "",
          "## 2. 신청 상태"]
    md.append(table(["출처"] + STATUS_ORDER,
                    [[SOURCE_NAMES[s]] + [f"{Counter(r['status'] for r in rs)[k]:,}" for k in STATUS_ORDER]
                     for s, rs in by_src.items()]))
    md += ["", "상태는 원문 신청기간 문구로 판정했습니다. '소진 시까지'·'상시'에는 마감일을 만들지 않았습니다.", ""]

    md.append("## 3. 지역 추출")
    reg_rows = []
    for s, rs in by_src.items():
        n = len(rs)
        nat = sum(1 for r in rs if r["regions"] == [NATIONWIDE])
        unk = sum(1 for r in rs if not r["regions"])
        basis = Counter(r["region_basis"] or "-" for r in rs).most_common(3)
        reg_rows.append([SOURCE_NAMES[s], pct(nat, n), pct(n - nat - unk, n), pct(unk, n),
                         ", ".join(f"{b} {c:,}" for b, c in basis)])
    md.append(table(["출처", "전국", "특정 지역", "미상", "판정 근거(상위)"], reg_rows))
    open_rows = [r for r in rows if r["status"] in OPEN_STATUSES]
    md += ["", "신청 가능한 자료(접수 중·예정·상시·소진 시까지·매년 정기)의 지역별 건수입니다. 전국 자료는 모든 지역에 포함됩니다.", ""]
    nat_open = sum(1 for r in open_rows if r["regions"] == [NATIONWIDE])
    md.append(table(["지역", "해당 지역 한정", "+ 전국 포함"],
                    [[g, f"{sum(1 for r in open_rows if g in r['regions']):,}",
                      f"{sum(1 for r in open_rows if g in r['regions']) + nat_open:,}"] for g in REGIONS]))
    md.append("")

    md.append("## 4. 농업 관련 판정")
    ag_rows = []
    for s, rs in by_src.items():
        n = len(rs)
        ag_rows.append([SOURCE_NAMES[s], f"{n:,}", pct(sum(1 for r in rs if r["agri"] == 2), n),
                        f"{sum(1 for r in rs if r['agri'] == 1):,}", f"{sum(1 for r in rs if int(r['fish'])):,}",
                        f"{sum(1 for r in rs if r['agri'] == 2 and r['status'] in OPEN_STATUSES):,}"])
    md.append(table(["출처", "전체", "농업(확정 판정)", "농업 후보(본문 언급)", "수산 관련", "농업 중 신청 가능"], ag_rows))
    md += ["", "- 확정 판정: 소관·수행기관(농식품부·농진청·aT 등), 제목의 농업 용어, 해시태그에만 있으면 2개 이상, "
               "보조금24 분야 '농림축산어업'·지원조건 '농업인'.",
           "- 후보: 해시태그 용어가 1개뿐이거나 본문·지원대상 설명에만 나오는 경우, 산림청 기관명만 있는 경우. "
           "화면에는 넣지 않고 검수 대상으로만 둡니다.", ""]

    ag_open = [r for r in open_rows if r["agri"] == 2 and r["kind"] == "공고"]
    ag_open.sort(key=lambda r: (r["apply_end"] or "9999", r["title"]))
    md.append(f"### 지금 신청 가능한 농업 공고 ({len(ag_open)}건, 보조금24 상시 제도 제외)")
    md.append(table(["마감", "상태", "출처", "지역", "제목", "판정 근거"],
                    [[r["apply_end"] or "-", r["status"], SOURCE_NAMES[r["source"]], region_text(r["regions"]),
                      r["title"][:60].replace("|", "/"), r["agri_basis"][:40]] for r in ag_open]))
    md.append("")

    jb = [r for r in open_rows if r["agri"] == 2 and ("전북" in r["regions"] or r["regions"] == [NATIONWIDE])]
    md.append("### 예시: 전북에서 신청 가능한 농업 자료")
    md.append(table(["종류", "전북 한정", "전국", "합계"],
                    [[k, f"{sum(1 for r in jb if r['kind'] == k and r['regions'] != [NATIONWIDE]):,}",
                      f"{sum(1 for r in jb if r['kind'] == k and r['regions'] == [NATIONWIDE]):,}",
                      f"{sum(1 for r in jb if r['kind'] == k):,}"] for k in ("공고", "제도")]))
    md.append("")
    return "\n".join(md)


def export_csv(rows, today):
    out = ROOT / "data" / "export"
    out.mkdir(parents=True, exist_ok=True)
    stamp = today.replace("-", "")
    cols = [("출처", lambda r: SOURCE_NAMES[r["source"]]), ("종류", lambda r: r["kind"]),
            ("상태", lambda r: r["status"]), ("시작", lambda r: r["apply_start"] or ""),
            ("마감", lambda r: r["apply_end"] or ""), ("신청기간 원문", lambda r: r["period_text"]),
            ("지역", lambda r: region_text(r["regions"])), ("지역 근거", lambda r: r["region_basis"]),
            ("제목", lambda r: r["title"]), ("소관", lambda r: r["agency"]), ("수행", lambda r: r["operator"]),
            ("분야", lambda r: r["category"]), ("대상", lambda r: (r["target"] or "")[:200]),
            ("농업", lambda r: {2: "농업", 1: "후보"}.get(r["agri"], "")),
            ("농업 근거", lambda r: r["agri_basis"]), ("민간", lambda r: "민간" if int(r["is_private"]) else ""),
            ("원문", lambda r: r["url"])]
    with open(out / f"notices_{stamp}.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow([c for c, _ in cols])
        for r in sorted(rows, key=lambda r: (r["source"], r["apply_end"] or "9999")):
            w.writerow([fn(r) for _, fn in cols])
    with open(out / f"agri_review_{stamp}.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["검수(O/X)"] + [c for c, _ in cols])
        # 검수 우선순위: 지금 신청 가능한 공고 → 본문 언급 후보 → 나머지
        def priority(r):
            open_notice = r["kind"] == "공고" and r["status"] in OPEN_STATUSES
            return (not open_notice, r["agri"] != 1, r["source"], r["title"])
        for r in sorted((r for r in rows if r["agri"]), key=priority):
            w.writerow([""] + [fn(r) for _, fn in cols])
    return out


def main():
    sys.stdout.reconfigure(errors="replace")
    today = datetime.date.today().isoformat()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows, runs = load(conn)
    conn.close()
    if not rows:
        raise SystemExit("DB에 자료가 없습니다. 먼저 python collector/collect.py 를 실행하세요.")
    text = build(rows, runs, today)
    rep_dir = ROOT / "reports"
    rep_dir.mkdir(exist_ok=True)
    path = rep_dir / f"step0_{today.replace('-', '')}.md"
    path.write_text(text, encoding="utf-8")
    out = export_csv(rows, today)
    print(text)
    print(f"\n보고서: {path}\n엑셀용 목록: {out}")


if __name__ == "__main__":
    main()
