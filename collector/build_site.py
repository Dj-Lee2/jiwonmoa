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
DETAIL_BUCKETS = 64  # 상세 화면에서만 쓰는 것(제도 상세 글, 공고 첨부 파일)은 목록과 떼어 64개 파일로 나눠 둔다 (열 때만 읽음)
DETAIL_KEYS = ("tg", "ct", "how", "cn", "op", "ap", "cd", "dt", "pu")

# 목록 파일 크기를 줄이려고 긴 글은 자른다. 전체 내용은 원문 링크로 안내한다.
# 제도의 신청 방법·서비스 목적은 상세 파일(sd)에만 들어가 목록 크기와 상관없다
LIMITS = {
    "공고": {"target": 600, "summary": 600, "content": 400, "how": 300, "detail": 500, "purpose": 600},
    "제도": {"target": 400, "summary": 80, "content": 400, "how": 600, "detail": 600, "purpose": 600},
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

# 모집 공고 분야(홈 '공고는 무엇을 지원하나요?'와 모집 공고 탭 '분야' 조건): 출처마다 다른 분류를 한 목록으로 맞춘다.
# 기업마당 지원분야(8개)와 K-Startup 지원사업 분류(11개)를 옮기고, 국고보조금은 분류가 사업 이름뿐이라 '기타'.
NOTICE_FIELDS = ["자금·융자", "기술·R&D", "경영·컨설팅·교육", "판로·수출", "인력", "창업·사업화", "시설·공간", "행사·네트워크", "기타"]
NOTICE_FIELD_OF = {
    "bizinfo": {"금융": "자금·융자", "기술": "기술·R&D", "경영": "경영·컨설팅·교육", "수출": "판로·수출", "내수": "판로·수출",
                "인력": "인력", "창업": "창업·사업화"},
    "kstartup": {"융자ㆍ보증": "자금·융자", "정책자금": "자금·융자", "기술개발(R&D)": "기술·R&D",
                 "멘토링ㆍ컨설팅ㆍ교육": "경영·컨설팅·교육", "창업교육": "경영·컨설팅·교육", "판로ㆍ해외진출": "판로·수출",
                 "글로벌": "판로·수출", "인력": "인력", "사업화": "창업·사업화", "시설ㆍ공간ㆍ보육": "시설·공간",
                 "행사ㆍ네트워크": "행사·네트워크"},
}


def notice_field(source, category):
    """출처 분류 이름 → NOTICE_FIELDS 하나. 모르는 분류(새로 생긴 것 포함)는 '기타'."""
    return NOTICE_FIELD_OF.get(source, {}).get((category or "").strip(), "기타")


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
        # 보조금24 서비스 목적 전문(목록의 요약 sm 대신 상세에 보인다), 기업마당 공고문·첨부 [이름, 주소, 공고문=1]
        "pu": trim(r.get("purpose"), lim["purpose"]),
        "fl": json.loads(r.get("attachments") or "[]"),
    }
    if r["kind"] == "공고":
        out["nf"] = notice_field(r["source"], r["category"])
    if r["kind"] == "제도":
        out["fs"] = r["first_seen"]  # 상시 제도 '신규' 배지(공고는 게시일 pd로 판단)
    if out["a"]:
        out["tp"] = agri_topics(r)
    return {k: v for k, v in out.items() if v not in (None, "", [], 0)}


def bucket_of(uid):
    """app.js의 bucketOf와 같은 계산이어야 한다."""
    return sum(ord(c) for c in uid) % DETAIL_BUCKETS


def split_details(services, notices):
    """상세 화면에서만 쓰는 것을 목록에서 떼어 버킷별로 모은다. 목록 파일에는 검색·필터용 항목만 남긴다.

    보조금24 제도는 상세 글(DETAIL_KEYS), 공고는 공고문·첨부 파일 목록(fl)을 뗀다. 파일이 있는 공고에는
    파일 수(fc)를 남겨 화면이 그 공고를 열 때만 버킷을 읽게 한다.
    """
    buckets = [dict() for _ in range(DETAIL_BUCKETS)]
    for item in services:
        detail = {k: item.pop(k) for k in DETAIL_KEYS if k in item}
        if item.get("u") == GOV24_URL + item["id"].split(":", 1)[1]:
            del item["u"]
        if detail:
            buckets[bucket_of(item["id"])][item["id"]] = detail
    for item in notices:
        if item.get("fl"):
            files = item.pop("fl")
            item["fc"] = len(files)
            buckets[bucket_of(item["id"])][item["id"]] = {"fl": files}
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


PEEK_TOP = 3


def service_peek(services):
    """홈 그래프 요약 창(app.js openPeek)용 상시 제도 요약. 홈에서 큰 목록(services.js)을 읽지 않으려고 미리 센다.

    반환: {"total"|"national": 칸, "region": {지역: 칸}, "items": {id: 짧은 항목}}.
    칸 = {열쇠: {"cat": {분야: 건수}, "sp": {지원 방식: 건수}, "pp": {대상: 건수}, "top": [조회수 상위 id 3개]}}.
    열쇠는 "all"(전체), 대상 이름(나비 막대), "cat:"분야·"sp:"지원 방식(도넛). 건수가 0인 열쇠는 칸을 만들지 않는다.
    지역 + 전국 대상은 화면에서 두 칸을 더한다(분야·방식·대상 건수를 다 들고 있어 더해도 정확하다).
    """
    pool = {}

    def keys_of(i):
        return ["all"] + list(i.get("pp") or []) + (["cat:" + i["cat"]] if i.get("cat") else []) + \
            ["sp:" + s for s in i.get("sp") or []]

    def cell(items):
        groups = {}
        for i in items:
            for k in keys_of(i):
                groups.setdefault(k, []).append(i)
        out = {}
        for k, sub in groups.items():
            cat, sp, pp = {}, {}, {}
            for i in sub:
                if i.get("cat"):
                    cat[i["cat"]] = cat.get(i["cat"], 0) + 1
                for s in i.get("sp") or []:
                    sp[s] = sp.get(s, 0) + 1
                for p in i.get("pp") or []:
                    pp[p] = pp.get(p, 0) + 1
            top = sorted((i for i in sub if i.get("vw")), key=lambda i: -i["vw"])[:PEEK_TOP]
            for i in top:
                pool[i["id"]] = {k2: i[k2] for k2 in TOP_KEYS if k2 in i}
            out[k] = {"cat": cat, "sp": sp, "pp": pp, "top": [i["id"] for i in top]}
        return out
    out = {
        "total": cell(services),
        "national": cell([i for i in services if (i.get("rg") or []) == ["전국"]]),
        "region": {r: cell([i for i in services if r in (i.get("rg") or [])]) for r in REGIONS},
    }
    out["items"] = pool
    return out

def write_js(name, var, data):
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path = SITE_DATA / f"{name}.js"
    path.write_text(f"window.{var}={body};\n", encoding="utf-8")
    return path


def dedupe_notices(notices):
    """같은 출처에 같은 공고가 여러 번 올라온 경우(재게시·일련번호만 다른 등록) 하나만 남긴다.

    출처·제목·기관·접수 시작·마감·지역이 모두 같을 때만 같은 공고로 본다(하나라도 다르면 둘 다 둔다).
    남기는 것은 출처에 가장 최근에 올라온 것(같으면 id가 큰 것).
    """
    def key(item):
        return (item.get("src"), item.get("t"), item.get("ag"), item.get("s"), item.get("e"), tuple(item.get("rg") or ()))

    best = {}
    for item in notices:
        k = key(item)
        cur = best.get(k)
        if cur is None or (item.get("pd") or "", item.get("id") or "") > (cur.get("pd") or "", cur.get("id") or ""):
            best[k] = item
    keep = {id(v) for v in best.values()}
    return [item for item in notices if id(item) in keep]


def open_in_year(r, year):
    """올해(year, 'YYYY') 신청할 수 있었던 공고인가: 접수 기간이 올해와 겹친다.
    시작은 접수 시작일 → 게시일 → 처음 본 날, 끝은 마감일. 날짜가 없는 쪽은 열려 있다고 본다(상시·소진 시까지)."""
    start = r["apply_start"] or r["posted"] or r["first_seen"] or ""
    end = r["apply_end"] or ""
    return (not start or start[:4] <= year) and (not end or end[:4] >= year)


def persona_history(all_rows, last_run, today):
    """대상별 '올해 공고' 수를 열린 것과 끝난 것으로 나눠 센다(나중에 '누구를 위한 지원' 그래프에 끝난 공고를
    옅은 막대로 더하려고 쌓아 두는 집계. 지금 화면은 이 파일을 읽지 않는다).

    - 대상: 모집 공고(kind '공고')만. 올해 = 접수 기간이 올해와 겹치는 공고(open_in_year).
    - 끝난 것 = 마감일이 지났거나(status '마감'), 출처 목록에서 사라진 것(last_seen이 그 출처의 마지막 성공 수집일보다 앞).
      기업마당·K-Startup은 모집 중인 공고만 주므로 끝난 공고는 우리가 수집을 시작한 뒤(firstDay~)에 본 것만 남는다.
    - 같은 공고 재게시는 dedupe_notices와 같은 기준으로 하나만 센다.
    반환: {"year", "total": {"open", "closed"}, "bySource": {출처: {"open", "closed"}}, "region", "national"}.
    각 칸은 {"all", 대상 이름: 건수}. region·national은 지역 고르기(state.r, 전국 포함)를 그대로 쓰려고 둔다.
    """
    year = today[:4]
    picked = []
    for r in all_rows:
        if r["kind"] != "공고" or not open_in_year(r, year):
            continue
        gone = r["last_seen"] != last_run.get(r["source"])
        item = compact(r)
        item["_closed"] = gone or status_of(r, today) == "마감"
        picked.append(item)
    picked = dedupe_notices(picked)

    def empty():
        return {k: 0 for k in ["all"] + PERSONAS}

    def pair():
        return {"open": empty(), "closed": empty()}
    out = {"year": int(year), "total": pair(), "bySource": {s: pair() for s in SOURCE_NAMES if s != "gov24"},
           "region": {g: pair() for g in REGIONS}, "national": pair()}
    for item in picked:
        side = "closed" if item["_closed"] else "open"
        rg = item.get("rg") or []
        targets = [out["total"], out["bySource"][item["src"]]] + \
            ([out["national"]] if rg == ["전국"] else [out["region"][g] for g in rg if g in out["region"]])
        for t in targets:
            for k in ["all"] + item.get("pp", []):
                t[side][k] = t[side].get(k, 0) + 1
    return out


def main():
    sys.stdout.reconfigure(errors="replace")
    today = datetime.date.today().isoformat()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows, runs = load(conn)
    first_day = conn.execute("SELECT MIN(first_seen) FROM notices").fetchone()[0]
    # 대상별 올해 공고 집계(끝난 공고 포함)는 출처 목록에서 사라진 공고까지 봐야 해서 DB 전체를 읽는다
    last_run = {r["source"]: r["run_at"][:10] for r in conn.execute(
        "SELECT source, MAX(run_at) AS run_at FROM runs WHERE ok = 1 GROUP BY source")}
    all_rows = []
    for r in conn.execute("SELECT * FROM notices WHERE kind = '공고'"):
        r = dict(r)
        r["regions"] = json.loads(r["regions"] or "[]")
        r["agri"] = int(r["agri"] or 0)
        all_rows.append(r)
    conn.close()

    live = [r for r in rows if status_of(r, today) != "마감"]
    notices = dedupe_notices([compact(r) for r in live if r["kind"] == "공고"])
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
        "noticeFields": NOTICE_FIELDS,
        "counts": {"services": len(services)},
    }
    buckets = split_details(services, notices)
    history = persona_history(all_rows, last_run, today)
    history["firstDay"] = first_day
    paths = [write_js("meta", "HUB_META", meta), write_js("notices", "HUB_NOTICES", notices),
             write_js("services", "HUB_SERVICES", services), write_js("history", "HUB_HISTORY", history),
             write_js("peek", "HUB_PEEK", service_peek(services))]
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
    # 출처별 균형 확인용 한 줄(update.log에 남는다): 올해 공고 중 끝난 것 / 전체
    print(f"{history['year']}년 공고(끝난 것 포함, 대상별 집계 history.js): " + ", ".join(
        f"{SOURCE_NAMES[s]} 끝남 {v['closed']['all']:,}/{v['open']['all'] + v['closed']['all']:,}"
        for s, v in history["bySource"].items()))


if __name__ == "__main__":
    main()
