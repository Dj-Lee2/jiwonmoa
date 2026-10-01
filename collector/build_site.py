"""DB의 현재 자료로 웹 화면용 데이터 파일(site/data/*.js)을 만든다.

실행: python collector/build_site.py
확인: site/index.html 을 브라우저로 연다 (서버 없이 열린다)

데이터를 .json이 아닌 .js(window 변수)로 쓰는 것은 파일을 더블클릭으로 열어도 읽히게 하기 위해서다.
"""
import datetime
import json
import re
import sqlite3
import sys

from collect import DB_PATH
from common import ROOT
from normalize import PERSONAS, REGIONS, SUPPORTS, status_of
from report import SOURCE_NAMES, load

SITE_DATA = ROOT / "site" / "data"
GOV24_URL = "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/"  # 화면에서 서비스ID로 주소를 만든다
DETAIL_BUCKETS = 64  # 보조금24 상세 글은 목록과 떼어 64개 파일로 나눠 둔다 (열 때만 읽음)
DETAIL_KEYS = ("tg", "ct", "how", "cn", "op", "ap", "cd", "dt")

# 목록 파일 크기를 줄이려고 긴 글은 자른다. 전체 내용은 원문 링크로 안내한다.
LIMITS = {
    "공고": {"target": 600, "summary": 600, "content": 400, "how": 300, "detail": 500},
    "제도": {"target": 400, "summary": 80, "content": 400, "how": 150, "detail": 600},
}

# 농업 세부 분야 칩(농업인을 골랐을 때): 제목(+분류명)에 들어 있는 말로 나눈다. 한 사업이 여러 분야에 들 수 있다.
AGRI_TOPICS = [
    ("과수·원예·특작", ["과수", "과원", "과실", "사과", "포도", "복숭아", "감귤", "블루베리", "복분자", "원예", "채소",
                   "화훼", "꽃가루", "시설하우스", "특용작물", "특화작목", "작목", "인삼", "약초", "버섯", "고추",
                   "마늘", "쪽파", "양파", "감자", "오미자", "산채", "과채", "수실", "딸기", "수박", "참외", "무병묘"]),
    ("식량·밭작물", ["벼", "쌀", "밭작물", "콩", "두류", "잡곡", "보리", "못자리", "육묘", "종자", "곡물", "전략작물",
                "식량", "양정", "수매", "우리밀"]),
    ("축산·방역", ["축산", "가축", "한우", "육우", "송아지", "소 사육", "소 농가", "칡소", "양돈", "한돈", "돼지", "모돈", "자돈",
               "양계", "가금", "육계", "산란계", "닭", "낙농", "젖소", "원유", "염소", "축사", "폐사축", "동물사체", "랜더링", "살처분", "방역", "구제역",
               "럼피스킨", "브루셀라", "조류", "백신", "예방접종", "헬퍼", "정액", "초지", "사료", "사일리지", "양봉",
               "꿀벌", "말벌", "수정벌", "곤충", "말산업", "사슴", "양록", "동물용"]),
    ("임업·산림", ["산림", "임산물", "임업", "산양삼", "조림", "목재", "숲", "표고", "백두대간"]),
    ("친환경·인증", ["친환경", "유기농", "유기질", "퇴비", "미생물", "생분해", "폐비닐", "GAP", "인증", "저탄소",
                "토양", "농토", "객토", "비료", "녹비"]),
    ("스마트팜·기술", ["스마트팜", "스마트", "농기계", "기계", "드론", "AI", "로봇", "데이터", "기술", "자동화",
                  "시설현대화", "컨설팅", "품종"]),
    ("영농자재·시설", ["영농자재", "자재", "기자재", "상토", "비닐", "멀칭", "하우스", "저온", "저장고", "양수", "관정",
                  "관수", "방제", "병해충", "농약", "생육", "봉지", "지주대", "유류"]),
    ("가공·유통·수출", ["가공", "유통", "수출", "판로", "판매", "출하", "선별", "택배", "특산물", "식품", "포장재",
                   "브랜드", "마케팅", "직거래", "로컬푸드", "박람회", "전통주", "푸드", "HMR"]),
    ("청년·귀농·교육", ["청년", "젊은", "귀농", "귀촌", "후계", "창업농", "도시농부", "도시농업", "교육", "아카데미",
                   "정착", "멘토", "학자금", "유학"]),
    ("농가 경영·복지", ["여성농업인", "여성 농업인", "결혼이민자", "건강", "검진", "바우처", "보험", "재해", "직불", "직접지불", "농지",
                   "수당", "연금", "노후", "월급제", "소득", "가격", "융자", "자금", "경영", "도우미", "출산", "주택",
                   "민박", "인력", "근로자", "면세유", "피해", "봉사"]),
]
AGRI_TOPIC_OTHER = "기타 농업"


def trim(text, limit):
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def agri_topics(r):
    # 보조금24의 분류명('농림축산어업')은 모든 농업 제도에 붙어 있어 분야 구분에 쓰지 않는다
    category = "" if r["source"] == "gov24" else r["category"]
    text = f"{r['title']} {category}".replace("ㆍ", "").replace("·", "")
    found = [name for name, words in AGRI_TOPICS if any(w in text for w in words)]
    return found or [AGRI_TOPIC_OTHER]


def compact(r):
    """화면에서 쓰는 짧은 키로 줄이고, 빈 값은 뺀다."""
    lim = LIMITS[r["kind"]]
    out = {
        "id": r["uid"], "src": r["source"], "k": "n" if r["kind"] == "공고" else "s",
        "t": r["title"], "ag": r["agency"], "op": trim(r["operator"], 120), "cat": r["category"],
        "tg": trim(r["target"], lim["target"]), "sm": trim(r["summary"], lim["summary"]),
        "ct": trim(r["content"], lim["content"]), "how": trim(r["how"], lim["how"]),
        "au": json.loads(r["audience"] or "[]"),
        "pp": json.loads(r["personas"] or "[]"),
        "pd": r["posted"], "vw": int(r["views"] or 0),
        "sp": json.loads(r["support"] or "[]"),
        "pt": r["period_text"], "py": r["period_type"], "s": r["apply_start"], "e": r["apply_end"],
        "rg": r["regions"], "rb": r["region_basis"],
        "a": 1 if r["agri"] == 2 else 0, "p": int(r["is_private"] or 0),
        "u": r["url"], "ap": r["apply_url"], "cn": trim(r["contact"], 200),
        "up": r["source_updated"],
        # 상세 화면의 조건 줄 [이름, 값(, 덧붙임)]과 글 칸 [제목, 글] (normalize.py의 conditions, details)
        "cd": json.loads(r.get("conditions") or "[]"),
        "dt": [[title, trim(text, lim["detail"])] for title, text in json.loads(r.get("details") or "[]")],
    }
    if r["kind"] == "제도":
        out["fs"] = r["first_seen"]  # 상시 제도 '신규' 배지(공고는 게시일 pd로 판단)
    if out["a"]:
        out["tp"] = agri_topics(r)
    return {k: v for k, v in out.items() if v not in (None, "", [], 0)}


def bucket_of(uid):
    """app.js의 bucketOf와 같은 계산이어야 한다."""
    return sum(ord(c) for c in uid) % DETAIL_BUCKETS


def split_services(services):
    """보조금24 항목에서 상세 글을 떼어 버킷별로 모은다. 목록 파일에는 검색·필터용 항목만 남긴다."""
    buckets = [dict() for _ in range(DETAIL_BUCKETS)]
    for item in services:
        detail = {k: item.pop(k) for k in DETAIL_KEYS if k in item}
        if item.get("u") == GOV24_URL + item["id"].split(":", 1)[1]:
            del item["u"]
        if detail:
            buckets[bucket_of(item["id"])][item["id"]] = detail
    return buckets


def service_counts(services):
    """홈 화면용 보조금24 제도 건수. 홈에서 큰 목록(services.js)을 읽지 않고도 지역별 숫자를 보이려고 미리 센다.

    반환: (전체, 지역 한정 {지역: 건수}, 전국 대상). 각 건수는 {"all", 대상 이름, "sp:"지원 방식, "cat:"분야}.
    """
    def empty():
        return {k: 0 for k in ["all"] + PERSONAS + ["sp:" + s for s in SUPPORTS]}
    total, national = empty(), empty()
    per_region = {r: empty() for r in REGIONS}
    for item in services:
        keys = ["all"] + item.get("pp", []) + ["sp:" + s for s in item.get("sp", [])] + \
            (["cat:" + item["cat"]] if item.get("cat") else [])
        rg = item.get("rg") or []
        targets = [total] + ([national] if rg == ["전국"] else [per_region[r] for r in rg if r in per_region])
        for t in targets:
            for k in keys:
                t[k] = t.get(k, 0) + 1
    return total, per_region, national


def service_cats(services):
    """상시 제도 분야(보조금24 서비스분야) 목록. 많은 순."""
    count = {}
    for item in services:
        if item.get("cat"):
            count[item["cat"]] = count.get(item["cat"], 0) + 1
    return sorted(count, key=lambda c: -count[c])


def open_months(rows, today):
    """홈 그래프 '공모는 언제 열리나요?': 국고보조금 공모가 접수를 시작한 달별 건수, 작년과 올해(1~12월).

    이미 마감된 공고도 센다(해마다 언제 열리는지 보려는 것). 지역은 수행기관 소재지 기준.
    작년 1~12월은 작년·올해·내년 사업연도 공고를 모두 받으므로 빠짐이 거의 없다(sources.fetch_bojo).
    """
    years = [today.year - 1, today.year]

    def empty():
        return {str(y): [0] * 12 for y in years}
    total, national = empty(), empty()
    region = {r: empty() for r in REGIONS}
    for r in rows:
        if r["source"] != "bojo":
            continue
        day = r["apply_start"] or r["apply_end"]
        if not day or int(day[:4]) not in years:
            continue
        y, i = day[:4], int(day[5:7]) - 1
        total[y][i] += 1
        if r["regions"] == ["전국"]:
            national[y][i] += 1
        for g in r["regions"]:
            if g in region:
                region[g][y][i] += 1
    return {"years": years, "month": today.month, "total": total, "national": national, "region": region}


TOP_KEYS = ("id", "src", "k", "t", "ag", "py", "pt", "s", "e", "rg", "vw")

UPCOMING_DAYS = 60   # '곧 열릴 수 있는 공모': 작년 오늘부터 이 기간 안에 접수를 시작한 공모
UPCOMING_MAX = 300
_BRACKET_NOTE = re.compile(r"[\(\[]\s*(추경|변경|재공고|연장|수정|추가)[^\)\]]*[\)\]]")
_YEAR = re.compile(r"(?:20)?\d{2}\s*년도?|20\d{2}|['’]\d{2}")
_PUNCT = re.compile(r"[\s\[\]\(\)「」『』<>〈〉《》·ㆍ,.'’\"\-_:~]")
_TAIL = ("재공고", "추가공고", "변경공고", "수정공고", "공고", "모집", "안내", "신청", "대상자", "선정", "계획", "시행")


def program_key(title):
    """해마다 되풀이되는 공모를 같은 사업으로 잇는 열쇠: 연도·(추경) 같은 표시·기호·끝말(공고·모집 등)을 뺀 제목."""
    t = _BRACKET_NOTE.sub("", title or "")
    t = _PUNCT.sub("", _YEAR.sub("", t))
    changed = True
    while changed:
        changed = False
        for tail in _TAIL:
            if t.endswith(tail) and len(t) > len(tail) + 3:
                t, changed = t[: -len(tail)], True
    return t


def upcoming_calls(rows, today):
    """작년 이맘때 접수를 시작한 국고보조금 공모 = 올해도 곧 열릴 수 있는 공모.

    같은 사업은 하나로 묶고(수행기관별 공고가 여러 개), 올해 공고가 이미 올라와 신청할 수 있으면 그 공고를 잇는다.
    """
    start = today - datetime.timedelta(days=365)
    end = start + datetime.timedelta(days=UPCOMING_DAYS)
    live_by_key = {}
    for r in rows:
        if status_of(r, today.isoformat()) != "마감":
            live_by_key.setdefault(program_key(r["title"]), r["uid"])
    groups = {}
    for r in rows:
        if r["source"] != "bojo":
            continue
        day = r["apply_start"] or r["posted"]
        if not day or not (start.isoformat() <= day <= end.isoformat()):
            continue
        if status_of(r, today.isoformat()) != "마감":
            continue  # 작년 공고가 아직 열려 있으면 '곧 열릴' 것이 아니다
        key = program_key(r["title"])
        g = groups.get(key)
        if g is None or day < g["od"]:
            budget = next((c[1] for c in json.loads(r.get("conditions") or "[]") if c[0] == "사업 예산"), "")
            groups[key] = g = {"t": r["title"], "ag": r["agency"], "od": day, "u": r["url"],
                               "rg": set(), "cid": live_by_key.get(key), "bg": budget}
        g["rg"].update(r["regions"])
    out = []
    for g in sorted(groups.values(), key=lambda g: (g["od"], g["t"])):
        rg = g["rg"]
        g["rg"] = ["전국"] if "전국" in rg or len(rg) >= 12 else [x for x in REGIONS if x in rg]
        out.append({k: v for k, v in g.items() if v not in (None, "", [], 0)})
    return {"from": start.isoformat(), "to": end.isoformat(), "items": out[:UPCOMING_MAX]}


TOP_MAX = 20  # 홈 '많이 찾는 지원사업': 처음 5개, 더 보기로 20개까지


def top_services(services, n=TOP_MAX):
    """홈 '많이 찾는 지원사업'의 상시 제도 순위(누적 조회수). 홈에서 큰 목록을 읽지 않으려고 미리 뽑는다.

    지역을 고르면 '그 지역만'과 '그 지역 + 전국' 두 가지가 필요하다(전국 대상 포함 설정).
    같은 제도가 여러 목록에 겹치므로 항목은 items에 한 번만 두고 목록에는 id만 둔다.
    """
    pool = {}

    def pick(items):
        best = sorted((i for i in items if i.get("vw")), key=lambda i: -i["vw"])[:n]
        for i in best:
            pool[i["id"]] = {k: i[k] for k in TOP_KEYS if k in i}
        return [i["id"] for i in best]
    out = {
        "all": pick(services),
        "region": {r: pick(i for i in services if r in (i.get("rg") or [])) for r in REGIONS},
        "withNational": {r: pick(i for i in services if r in (i.get("rg") or []) or i.get("rg") == ["전국"])
                         for r in REGIONS},
    }
    out["items"] = pool
    return out


def write_js(name, var, data):
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path = SITE_DATA / f"{name}.js"
    path.write_text(f"window.{var}={body};\n", encoding="utf-8")
    return path


def main():
    sys.stdout.reconfigure(errors="replace")
    today = datetime.date.today().isoformat()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows, runs = load(conn)
    first_day = conn.execute("SELECT MIN(first_seen) FROM notices").fetchone()[0]
    conn.close()

    live = [r for r in rows if status_of(r, today) != "마감"]
    notices = [compact(r) for r in live if r["kind"] == "공고"]
    services = [compact(r) for r in live if r["kind"] == "제도"]

    meta = {
        "builtAt": datetime.datetime.now().isoformat(timespec="minutes"),
        "firstDay": first_day,
        "regions": REGIONS,
        "agriTopics": [name for name, _ in AGRI_TOPICS] + [AGRI_TOPIC_OTHER],
        "runs": [{"src": r["source"], "at": r["run_at"], "ok": r["ok"]} for r in runs],
        "bySource": {s: sum(1 for i in notices + services if i["src"] == s) for s in SOURCE_NAMES},
        "svc": dict(zip(("total", "region", "national"), service_counts(services))),
        "openMonths": open_months(rows, datetime.date.today()),
        "topServices": top_services(services),
        "upcoming": upcoming_calls(rows, datetime.date.today()),
        "personas": PERSONAS,
        "supports": SUPPORTS,
        "serviceCats": service_cats(services),
        "counts": {"services": len(services)},
    }
    buckets = split_services(services)
    paths = [write_js("meta", "HUB_META", meta), write_js("notices", "HUB_NOTICES", notices),
             write_js("services", "HUB_SERVICES", services)]
    detail_dir = SITE_DATA / "sd"
    detail_dir.mkdir(parents=True, exist_ok=True)
    for i, chunk in enumerate(buckets):
        body = json.dumps(chunk, ensure_ascii=False, separators=(",", ":"))
        (detail_dir / f"{i:02d}.js").write_text(
            f"Object.assign(window.HUB_SD=window.HUB_SD||{{}},{body});\n", encoding="utf-8")
    for p in paths:
        print(f"{p.relative_to(ROOT)}  {p.stat().st_size / 1024:,.0f} KB")
    sizes = [f.stat().st_size for f in detail_dir.glob("*.js")]
    print(f"site/data/sd/*.js  {len(sizes)}개, 평균 {sum(sizes) / len(sizes) / 1024:,.0f} KB")
    print(f"공고 {len(notices):,}건, 제도 {len(services):,}건 (마감 제외)")


if __name__ == "__main__":
    main()
