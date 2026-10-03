"""정기 점검: 하루 두 번(09:30·16:30 KST, 수집 30분 뒤) 운영 상태를 보고 결과를 저장소에 기록해 올린다.

실행: deploy/check.sh (flock으로 매일 갱신과 겹치지 않게 감싼다)
  CHECK_DRY=1        기록·커밋·올리기 없이 결과 줄만 출력
  CHECK_SLOT=HH:MM   기준 수집 시각을 직접 정할 때(시험용)

보는 것
  1. 이번 수집: 기준 시각(09:00 또는 16:00) 뒤에 4개 출처가 모두 성공했는지, 일부만 받은 출처가 있는지
  2. 화면 자료: site/data/*.js가 이번 수집 뒤에 만들어졌는지, id 중복·이미 마감된 공고가 없는지
  3. 운영 사이트: 첫 화면·자료 파일이 200으로 열리는지, 보안 헤더(CSP)가 첫 화면 스크립트를 허용하는지
  4. 규칙 테스트(tests/)가 통과하는지
결과는 status/checks.md 맨 위에 한 줄, README의 '최근 점검' 줄에 반영하고 그 두 파일만 커밋한다.
GitLab(gov) 먼저 올리고 통과하면 GitHub(origin). 이상이 있거나 올리기에 실패하면 표준 출력에 알림을 쓴다
(Hermes 예약 작업이 이 출력을 텔레그램으로 보낸다 — 정상이면 아무것도 쓰지 않는다).
"""
import base64
import datetime
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://jiwonmoa.orfa.shop"
SOURCES = {"bizinfo": "기업마당", "kstartup": "K-Startup", "gov24": "보조금24", "bojo": "국고보조금"}
SLOTS = ("09:00", "16:00")
KEEP_ROWS = 60  # status/checks.md에 남길 줄 수(한 달)
WEEKDAY = "월화수목금토일"
README_MARK = re.compile(r"^- 최근 점검: .*$", re.M)


def now_kst():
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=9)


def slot_time(now):
    """지금 기준으로 가장 최근 예정 수집 시각."""
    forced = os.environ.get("CHECK_SLOT")
    if forced:
        h, m = map(int, forced.split(":"))
        t = now.replace(hour=h, minute=m, second=0, microsecond=0)
        return t if t <= now else t - datetime.timedelta(days=1)
    cands = []
    for d in (0, 1):
        for s in SLOTS:
            h, m = map(int, s.split(":"))
            t = (now - datetime.timedelta(days=d)).replace(hour=h, minute=m, second=0, microsecond=0)
            if t <= now:
                cands.append(t)
    return max(cands)


def stamp(t):
    return f"{t.month}.{t.day}({WEEKDAY[t.weekday()]}) {t:%H:%M}"


def read_js(name, var):
    text = (ROOT / "site" / "data" / name).read_text(encoding="utf-8")
    return json.loads(text[len(f"window.{var}="):].rstrip().rstrip(";"))


SITE_PATHS = ("/", "/data/meta.js", "/data/notices.js", "/app.js")


def http_codes():
    """운영 사이트 고정 주소들의 응답 코드(curl, https만)."""
    args = ["curl", "-s", "--proto", "=https", "--max-time", "20", "-o", "/dev/null", "-w", "%{http_code}\\n"]
    for path in SITE_PATHS:
        args += ["-o", "/dev/null", SITE + path] if path != SITE_PATHS[0] else [SITE + path]
    out = subprocess.run(args, capture_output=True, text=True).stdout.split()
    return dict(zip(SITE_PATHS, out + ["000"] * (len(SITE_PATHS) - len(out))))


def inline_script_hash():
    """index.html의 첫 화면 인라인 스크립트 sha256(CSP 헤더에 같은 값이 있어야 실행된다)."""
    html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
    bodies = re.findall(r"<script>(.*?)</script>", html, re.S)
    return ["sha256-" + base64.b64encode(hashlib.sha256(b.encode("utf-8")).digest()).decode() for b in bodies]


def csp_header():
    """운영 첫 화면의 Content-Security-Policy 헤더 값(curl, https만). 없으면 빈 문자열."""
    out = subprocess.run(["curl", "-sI", "--proto", "=https", "--max-time", "20", SITE + "/"],
                         capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.lower().startswith("content-security-policy:"):
            return line.split(":", 1)[1].strip()
    return ""


def git(*args, check=True):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=check)


def run_checks(now, slot):
    problems, facts = [], {}
    # 1. 이번 수집
    conn = sqlite3.connect(ROOT / "data" / "hub.db")
    conn.row_factory = sqlite3.Row
    since = slot.isoformat(timespec="seconds")
    ok_n = 0
    for src, label in SOURCES.items():
        r = conn.execute("SELECT * FROM runs WHERE source = ? AND run_at >= ? ORDER BY run_at DESC LIMIT 1",
                         (src, since)).fetchone()
        if r is None:
            problems.append(f"{label} 수집 기록 없음")
        elif not r["ok"]:
            problems.append(f"{label} 수집 실패")
        else:
            ok_n += 1
            if r["error"]:
                problems.append(f"{label} {r['error']}")
    conn.close()
    facts["runs"] = f"{ok_n}/{len(SOURCES)}"
    # 2. 화면 자료
    try:
        meta = read_js("meta.js", "HUB_META")
        notices = read_js("notices.js", "HUB_NOTICES")
        built = datetime.datetime.fromisoformat(meta["builtAt"])
        if built < slot:
            problems.append(f"화면 자료가 이번 수집 전({meta['builtAt']})에 만들어짐")
        today = now.date().isoformat()
        ids = [n["id"] for n in notices]
        if len(ids) != len(set(ids)):
            problems.append(f"공고 id 중복 {len(ids) - len(set(ids))}건")
        closed = sum(1 for n in notices if n.get("e") and n["e"] < today)
        if closed:
            problems.append(f"이미 마감된 공고 {closed}건이 목록에 남음")
        facts["notices"] = len(notices)
        facts["services"] = (meta.get("counts") or {}).get("services", 0)
        if not notices or not facts["services"]:
            problems.append("공고 또는 제도가 0건")
    except Exception as e:  # 파일이 깨졌거나 없음
        problems.append(f"화면 자료를 읽지 못함: {str(e)[:80]}")
        facts.setdefault("notices", 0)
        facts.setdefault("services", 0)
    # 3. 운영 사이트
    for path, code in http_codes().items():
        if code != "200":
            problems.append(f"사이트 {path} 응답 이상({code})")
    csp = csp_header()
    if not csp:
        problems.append("보안 헤더(CSP) 없음")
    elif any(h not in csp for h in inline_script_hash()):
        problems.append("보안 헤더(CSP)가 첫 화면 스크립트를 막음 — Caddy의 sha256 값을 index.html에 맞출 것")
    # 4. 테스트
    t = subprocess.run(["/usr/bin/python3", "-m", "unittest", "discover", "-s", "tests"], cwd=ROOT,
                       capture_output=True, text=True, env={**os.environ, "TZ": "Asia/Seoul"})
    m = re.search(r"Ran (\d+) test", t.stderr)
    facts["tests"] = m.group(1) if m else "?"
    if t.returncode != 0:
        problems.append("규칙 테스트 실패")
    return problems, facts


def record(now, slot, problems, facts):
    result = "정상" if not problems else "이상"
    body = (f"공고 {facts['notices']:,} · 제도 {facts['services']:,} · 수집 {facts['runs']} 성공 · 테스트 {facts['tests']}건 통과"
            if not problems else " / ".join(problems))
    row = f"| {stamp(now)} | {slot:%H:%M} 수집 | {result} | {body} |"
    path = ROOT / "status" / "checks.md"
    path.parent.mkdir(exist_ok=True)
    head = ("# 운영 점검 기록\n\n하루 두 번(09:30·16:30 한국 시간) 수집·화면 자료·사이트 응답·규칙 테스트를 자동으로 점검한 결과입니다. "
            f"최근 {KEEP_ROWS}회만 남깁니다.\n\n| 점검 시각 | 기준 | 결과 | 내용 |\n|---|---|---|---|\n")
    rows = []
    if path.exists():
        rows = [l for l in path.read_text(encoding="utf-8").splitlines() if l.startswith("| ") and "---" not in l
                and not l.startswith("| 점검 시각")]
    path.write_text(head + "\n".join([row] + rows[:KEEP_ROWS - 1]) + "\n", encoding="utf-8")
    readme = ROOT / "README.md"
    line = f"- 최근 점검: {result} ({stamp(now)}, [점검 기록](status/checks.md))"
    text = readme.read_text(encoding="utf-8")
    readme.write_text(README_MARK.sub(line, text, count=1) if README_MARK.search(text) else text, encoding="utf-8")
    return result


def prepare():
    """기록하기 전에: 누가 작업 중(커밋 안 한 변경)이면 건드리지 않고, 아니면 최신을 받는다. 문제면 알림 문장."""
    dirty = git("status", "--porcelain", "--untracked-files=no", check=False).stdout.strip()
    if dirty:
        return "작업 중인 변경이 있어 점검 기록을 올리지 않음(다른 곳에서 작업 중일 수 있음)"
    if git("pull", "--ff-only", "-q", "origin", "main", check=False).returncode != 0:
        return "점검 기록을 올리지 못함: 최신 내용을 받지 못했습니다(다른 곳의 커밋과 갈림)."
    return ""


def publish(now, result):
    """status·README만 커밋해 GitLab → GitHub 순서로 올린다. 실패하면 알림 문장을 돌려준다."""
    paths = ["status/checks.md", "README.md"]
    git("add", "--", *paths)
    msg = f"점검 {now.month}.{now.day} {now:%H:%M}: {result}"
    c = git("commit", "-q", "-m", msg, "--", *paths, check=False)
    if c.returncode != 0:
        return f"점검 기록 커밋 실패: {(c.stderr or c.stdout).strip()[:160]}"
    for remote in ("gov", "origin"):
        p = git("push", "-q", remote, "main", check=False)
        if p.returncode != 0:
            return f"점검 기록을 {('GitLab' if remote == 'gov' else 'GitHub')}에 올리지 못함: {p.stderr.strip()[-160:]}"
    return ""


def main():
    now = now_kst()
    slot = slot_time(now)
    problems, facts = run_checks(now, slot)
    if os.environ.get("CHECK_DRY"):
        print(("정상" if not problems else "이상"), facts, problems)
        return
    push_error = prepare()
    result = "정상" if not problems else "이상"
    if not push_error:
        result = record(now, slot, problems, facts)
        push_error = publish(now, result)
    if problems or push_error:
        lines = [f"⚠️ 지원모아 점검 {stamp(now)} ({slot:%H:%M} 수집 기준)"]
        lines += [f"- {p}" for p in problems]
        if push_error:
            lines.append(f"- {push_error}")
        print("\n".join(lines))


if __name__ == "__main__":
    sys.exit(main())
