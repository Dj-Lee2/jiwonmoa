"""출처별 원본을 공통 형식(공고 1건 = dict 1개)으로 바꾼다.

지역·농업 판정은 규칙 기반이며, 판정 근거를 함께 남겨 사람이 검수할 수 있게 한다.
"""
import hashlib
import html
import json
import re
from collections import defaultdict

# 2026년 현재 광역 단위. 광주·전남은 전남광주통합특별시로 통합됐다.
REGIONS = ["서울", "부산", "대구", "인천", "대전", "울산", "세종", "경기", "강원",
           "충북", "충남", "전북", "전남광주", "경북", "경남", "제주"]
NATIONWIDE = "전국"
NATIONWIDE_MIN = 12  # 이만큼 많은 지역이 함께 붙어 있으면 전국 공고로 본다

REGION_FULL = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
    "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기",
    "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북", "충청남도": "충남",
    "전북특별자치도": "전북", "전라북도": "전북", "전남광주통합특별시": "전남광주",
    "광주광역시": "전남광주", "전라남도": "전남광주", "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주",
}
REGION_SHORT = {r: r for r in REGIONS} | {"광주": "전남광주", "전남": "전남광주"}
REGION_GROUPS = {
    "수도권": ["서울", "경기", "인천"],
    "비수도권": [r for r in REGIONS if r not in ("서울", "경기", "인천")],
    "충청": ["대전", "세종", "충북", "충남"], "충청권": ["대전", "세종", "충북", "충남"],
    "호남권": ["전북", "전남광주"], "영남권": ["부산", "대구", "울산", "경북", "경남"],
    "동남권": ["부산", "울산", "경남"], "대경권": ["대구", "경북"],
}

AGRI_AGENCIES = [
    "농림축산식품부", "농촌진흥청", "산림청", "국립농산물품질관리원", "농림수산식품교육문화정보원",
    "한국농수산식품유통공사", "농업기술실용화재단", "한국농어촌공사", "농업정책보험금융원",
    "축산물품질평가원", "한국임업진흥원", "한국산림복지진흥원", "농업기술센터", "농업기술원",
]
AGRI_WORDS = [
    "농업", "농가", "농촌", "농어촌", "농식품", "농산물", "농수산", "귀농", "귀촌", "영농", "청년농",
    "후계농", "스마트팜", "축산", "가축", "한우", "양돈", "양계", "낙농", "친환경농", "유기농",
    "원예", "과수", "채소", "화훼", "특용작물", "임산물", "임업인", "산림", "산양삼", "버섯", "양봉",
    "곤충", "농기계", "농지", "밭작물", "말산업", "GAP", "전통주", "인삼", "창업농",
]
# 이 기관 이름만으로는 농업 지원이라 보기 어렵다(수목원·휴양림·산불진화 등) → 다른 근거가 없으면 후보
AGENCY_ONLY_WEAK = {"기관:산림청"}
FISH_AGENCIES = ["해양수산부", "한국수산자원공단", "한국어촌어항공단"]
FISH_WORDS = ["어업", "어촌", "어선", "수산", "양식장", "해녀", "어민", "천일염"]
# 다른 낱말 속에 우연히 들어가는 경우를 뺀다: 지원예산·다원예술 / 다양계층 / 우수산업·특수산업
WORD_EXCEPTIONS = {"원예": r"(?<![지다])원예", "양계": r"(?<!다)양계", "수산": r"(?<![우특])수산"}
AGRI_PATTERNS = [(w, re.compile(WORD_EXCEPTIONS.get(w, re.escape(w)))) for w in AGRI_WORDS]
FISH_PATTERNS = [(w, re.compile(WORD_EXCEPTIONS.get(w, re.escape(w)))) for w in FISH_WORDS]
TAG_ONLY_MIN = 2  # 해시태그에만 나오는 농업 용어는 이만큼 여러 개여야 확정 판정

# 화면의 '대상' 구분
AUD_PERSON, AUD_SOHO, AUD_SME, AUD_STARTUP, AUD_ORG = "개인·가구", "소상공인", "중소기업", "창업", "법인·단체"
AUDIENCES = [AUD_PERSON, AUD_SOHO, AUD_SME, AUD_STARTUP, AUD_ORG]
BIZINFO_AUDIENCE = {"중소기업": AUD_SME, "중견기업": AUD_SME, "제조업": AUD_SME, "장애인기업": AUD_SME,
                    "여성기업": AUD_SME, "소상공인": AUD_SOHO, "창업벤처": AUD_STARTUP,
                    "사회적기업": AUD_ORG, "마을기업": AUD_ORG, "협동조합": AUD_ORG}
GOV24_AUDIENCE = {"개인": AUD_PERSON, "가구": AUD_PERSON, "소상공인": AUD_SOHO, "법인/시설/단체": AUD_ORG}

# 화면의 '누구를 위한 지원' 조건. 한 사업이 여러 대상에 들 수 있다. 농업인은 여러 대상 중 하나다.
PERSONAS = ["청년", "시니어", "장애인", "임산부·출산", "한부모·다자녀", "구직자", "농업인",
            AUD_SOHO, AUD_SME, AUD_STARTUP, AUD_ORG]
# 제목(공고는 지원대상 글도)에서 찾는 말. '고령군'·'유통경로'처럼 다른 뜻으로 쓰이는 경우는 뺀다
PERSONA_WORDS = {
    "청년": [r"청년"],
    "시니어": [r"어르신", r"노인", r"고령(?!군)", r"시니어", r"경로당"],
    "장애인": [r"장애"],
    "임산부·출산": [r"임산부", r"임신", r"출산", r"난임", r"산모", r"산후"],
    "한부모·다자녀": [r"한부모", r"다자녀", r"조손"],
    "구직자": [r"구직", r"실업", r"취업준비"],
    AUD_STARTUP: [r"창업"],
}
PERSONA_PATTERNS = {p: re.compile("|".join(ws)) for p, ws in PERSONA_WORDS.items()}
# 보조금24 지원조건 코드 → 대상. 그 묶음에서 몇 개만 Y인 제도만 '그 대상 전용'으로 본다(전부 Y면 누구나 대상)
JA_PERSONA = {"장애인": ["JA0328"], "임산부·출산": ["JA0301", "JA0302", "JA0303"],
              "한부모·다자녀": ["JA0403", "JA0411"], "구직자": ["JA0327"], AUD_STARTUP: ["JA1101"],
              AUD_SOHO: ["JA1102"], AUD_SME: ["JA2101"]}
JA_GROUPS = [("JA03", {"JA0322"}, 4), ("JA04", {"JA0410"}, 4), ("JA11", set(), 2), ("JA21", set(), 2)]
# 나이 조건으로 청년을 가린다: 시작 나이 15~24, 끝 나이 29~39(청년 정책의 흔한 범위).
# 18~44세(임산부·영유아 사업에 많다)처럼 넓은 범위는 청년으로 보지 않는다. 제목에 '청년'이 있으면 따로 잡힌다.
YOUTH_START, YOUTH_END = (15, 24), (29, 39)

# 보조금24 '지원유형' 20가지를 화면용 9가지 '지원 방식'으로 묶는다(순서 = 화면 표시 순서)
SUPPORT_GROUPS = {
    "현금": ["현금", "현금(보험)", "현금(장학금)"],
    "감면": ["현금(감면)"],
    "융자": ["현금(융자)"],
    "현물": ["현물"],
    "이용권": ["이용권"],
    "의료·돌봄": ["서비스(의료)", "의료지원", "서비스(돌봄)"],
    "교육·상담·일자리": ["기타(교육)", "기타(상담)", "상담/법률지원", "서비스(일자리)", "기술지원"],
    "시설·문화": ["시설이용", "문화/여가지원"],
    "기타": ["기타", "민원", "봉사/기부"],
}
SUPPORT_OF = {raw: group for group, raws in SUPPORT_GROUPS.items() for raw in raws}
SUPPORTS = list(SUPPORT_GROUPS)


def support_groups(value):
    """'현금||현물' 같은 원문 지원유형을 화면용 지원 방식 목록으로. 모르는 값은 '기타'."""
    found = {SUPPORT_OF.get(t.strip(), "기타") for t in (value or "").split("||") if t.strip()}
    return [g for g in SUPPORTS if g in found]
SENIOR_AGE = 60

# 보조금24 지원조건 코드: 농업인·축산업인·임업인 / 어업인 / 업종 '농업,임업 및 어업'
JA_AGRI = ["JA0313", "JA0315", "JA0316"]
JA_FISH = ["JA0314"]
JA_OCCUPATION_PREFIX = "JA03"
JA_SPECIFIC_MAX = 4  # 직업 조건이 이보다 많이 Y면 '누구나' 서비스로 본다

DATE_RE = re.compile(r"(20\d{2})\s*[-.년/]\s*(\d{1,2})\s*[-.월/]\s*(\d{1,2})")
YMD8_RE = re.compile(r"^(20\d{2})(\d{2})(\d{2})")
MONTH_RE = re.compile(r"(?<!\d)\d{1,2}\s*월")
PERIOD_RULES = [  # (종류, 판정 단어) — 위에서부터 먼저 맞는 것
    ("신청불필요", ["신청불필요", "신청 불필요", "신청불요", "신청절차가 없음", "신청절차 없음"]),
    ("소진시", ["예산 소진", "예산소진", "선착순", "모집 완료", "모집완료", "모집 마감시", "마감시까지"]),
    ("상시", ["상시", "수시", "연중"]),
    ("정기", ["매년", "연초", "연말", "상반기", "하반기", "월 중", "월초", "월말"]),
    ("별도", ["상이", "추후", "별도", "문의", "공고 시", "공고시", "참조"]),
]


def clean_text(value):
    """HTML 태그·엔티티를 걷어낸 한 줄 텍스트."""
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = re.sub(r"<br\s*/?>|</p>|</li>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)  # 이중 인코딩(&amp;#40;) 대비
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\n\s*\n+", "\n", text)).strip()


def _ymd(y, m, d):
    try:
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    except ValueError:
        return None


def ymd8(value):
    m = YMD8_RE.match(str(value or "").strip())
    return _ymd(*m.groups()) if m else None


def parse_period(text):
    """신청기간 문자열 → (시작일, 종료일, 종류). 날짜가 둘 이상이면 처음·마지막을 쓴다."""
    text = clean_text(text)
    dates = [_ymd(*m.groups()) for m in DATE_RE.finditer(text)]
    dates = [d for d in dates if d]
    if dates:
        start = dates[0] if len(dates) > 1 else None
        return start, dates[-1], "기간"
    for kind, words in PERIOD_RULES:
        # '1~2월(모집기간 별도)', '2월 말 공고 확인 후'처럼 연도 없는 월 표기는 매년 정기로 본다
        if kind == "별도" and MONTH_RE.search(text):
            return None, None, "정기"
        if any(w in text for w in words):
            return None, None, kind
    if MONTH_RE.search(text):
        return None, None, "정기"
    return None, None, "미상"


def regions_from_tokens(tokens):
    found = set()
    for tok in tokens:
        tok = tok.strip()
        if tok in REGION_FULL:
            found.add(REGION_FULL[tok])
        elif tok in REGION_SHORT:
            found.add(REGION_SHORT[tok])
        elif tok in REGION_GROUPS:
            found.update(REGION_GROUPS[tok])
        elif tok in ("전국", "全국"):
            found.update(REGIONS)
    return found


def regions_from_name(name):
    """기관명에서 광역 지역을 찾는다. 짧은 이름(광주 등)은 이름 맨 앞에 있을 때만 인정한다."""
    name = re.sub(r"^(재단법인|\(재\)|사단법인|\(사\))\s*", "", name or "")
    for full, short in REGION_FULL.items():
        if full in name:
            return {short}
    for tok, short in REGION_SHORT.items():
        if name.startswith(tok):
            return {short}
    return set()


def build_sigungu_map(gov24_items):
    """보조금24의 '서울특별시 용산구' 같은 기관명에서 시군구 → 광역 대응표를 만든다.

    '용산구시설관리공단'처럼 시군구 이름으로 시작하는 기관의 지역을 찾는 데 쓴다.
    '중구'처럼 여러 광역에 있는 이름은 판정하지 않는다.
    """
    seen = defaultdict(set)
    for item in gov24_items:
        parts = (item.get("소관기관명") or "").split()
        if len(parts) >= 2 and parts[0] in REGION_FULL:
            region = REGION_FULL[parts[0]]
            name = parts[1]
            seen[name].add(region)
            stem = re.sub(r"[시군구]$", "", name)
            if len(stem) >= 2:
                seen[stem].add(region)
    table = {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}
    return dict(sorted(table.items(), key=lambda kv: -len(kv[0])))  # 긴 이름부터 맞춘다


def regions_from_sigungu(name, table):
    name = re.sub(r"^(재단법인|\(재\)|사단법인|\(사\))\s*", "", name or "")
    for key, region in table.items():
        if name.startswith(key):
            return {region}
    return set()


def region_label(found):
    if not found:
        return []
    if len(found) >= NATIONWIDE_MIN:
        return [NATIONWIDE]
    return [r for r in REGIONS if r in found]


def match_text(texts):
    """판정용 텍스트. '농ㆍ식품'처럼 낱말 사이 가운뎃점을 붙여 '농식품'으로 맞춘다."""
    text = " ".join(t for t in texts if t)
    return re.sub(r"(?<=[가-힣])[ㆍ·‧](?=[가-힣])", "", text)


def found_words(patterns, text):
    return [w for w, p in patterns if p.search(text)]


def classify_sector(titles, weak_texts, agencies, tags=(), extra_agri=None, extra_fish=None):
    """농업(농축산임업)·어업 해당 여부와 근거.

    확정(2): 소관·수행기관, 제목, 구조화 조건, 또는 해시태그에만 있는 농업 용어가 2개 이상
    후보(1): 해시태그에 농업 용어가 1개뿐이거나 본문·지원대상 설명에만 나오는 경우 → 검수 대상
    반환: (agri 수준 0/1/2, 근거, fish 여부)
    """
    basis = []
    for a in agencies:
        hit = next((x for x in AGRI_AGENCIES if x in (a or "")), None)
        if hit:
            basis.append(f"기관:{hit}")
    if extra_agri:
        basis.append(extra_agri)
    title = match_text(titles)
    words = found_words(AGRI_PATTERNS, title)
    if words:
        basis.append("제목:" + ",".join(words[:3]))
    tag_text = match_text(tags)
    tag_words = [w for w in found_words(AGRI_PATTERNS, tag_text) if w not in words]
    if len(tag_words) >= TAG_ONLY_MIN:
        basis.append("해시태그:" + ",".join(tag_words[:3]))

    fish_text = f"{title} {tag_text}"
    for both in ("농수산", "농어촌", "농어업", "농림축산어업"):  # 농업과 함께 쓰는 말은 수산 근거에서 뺀다
        fish_text = fish_text.replace(both, "")
    fish = bool(extra_fish) or any(x in (a or "") for a in agencies for x in FISH_AGENCIES) \
        or bool(found_words(FISH_PATTERNS, fish_text))

    if basis and set(basis) <= AGENCY_ONLY_WEAK:
        return 1, "; ".join(basis), fish
    if basis:
        return 2, "; ".join(basis), fish
    if tag_words:
        return 1, "해시태그:" + ",".join(tag_words[:3]), fish
    weak_words = found_words(AGRI_PATTERNS, match_text(weak_texts))
    if weak_words:
        return 1, "본문:" + ",".join(weak_words[:3]), fish
    return 0, "", fish


def personas_for(texts, base=(), agri=0, cond=None):
    """'누구를 위한 지원' 대상 목록. 글에 나온 말, 기존 대상 구분, 농업 판정, 보조금24 지원조건을 합친다."""
    found = {b for b in base if b in PERSONAS}
    text = match_text(texts)
    found.update(p for p, pat in PERSONA_PATTERNS.items() if pat.search(text))
    if agri == 2:
        found.add("농업인")
    if cond:
        specific = set()
        for prefix, skip, most in JA_GROUPS:
            ys = [k for k, v in cond.items() if k.startswith(prefix) and k not in skip and v == "Y"]
            if 0 < len(ys) <= most:
                specific.update(ys)
        found.update(p for p, codes in JA_PERSONA.items() if specific & set(codes))
        lo, hi = cond.get("JA0110"), cond.get("JA0111")
        if isinstance(lo, int) and isinstance(hi, int) and                 YOUTH_START[0] <= lo <= YOUTH_START[1] and YOUTH_END[0] <= hi <= YOUTH_END[1]:
            found.add("청년")
        if isinstance(lo, int) and lo >= SENIOR_AGE:
            found.add("시니어")
    return [p for p in PERSONAS if p in found]


def content_hash(rec):
    keys = ("title", "period_text", "target", "summary", "content", "how", "apply_url", "files")
    blob = json.dumps([rec.get(k) for k in keys], ensure_ascii=False)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def to_date(value):
    """출처마다 다른 수정일시 표기(2026-09-29 14:55:18, 20260129201825, 20260819)를 날짜로."""
    digits = re.sub(r"\D", "", str(value or ""))
    return _ymd(digits[:4], digits[4:6], digits[6:8]) if len(digits) >= 8 else ""


def _finish(rec):
    rec["source_updated"] = to_date(rec["source_updated"])
    rec["content_hash"] = content_hash(rec)
    rec["regions"] = json.dumps(rec["regions"], ensure_ascii=False)
    rec["audience"] = json.dumps(rec["audience"], ensure_ascii=False)
    rec["personas"] = json.dumps(rec["personas"], ensure_ascii=False)
    rec["support"] = json.dumps(rec.get("support", []), ensure_ascii=False)
    return rec


def from_bizinfo(item):
    title = clean_text(item.get("pblancNm"))
    tags = [t.strip() for t in (item.get("hashtags") or "").split(",") if t.strip()]
    m = re.match(r"\s*\[([^\]]+)\]", title)
    if m:
        found, basis = regions_from_tokens(re.split(r"[ㆍ·,/]", m.group(1))), "제목"
    else:
        found, basis = regions_from_tokens(tags), "해시태그"
    if not found:
        found, basis = regions_from_name(item.get("jrsdInsttNm")), "소관기관"
    start, end, ptype = parse_period(item.get("reqstBeginEndDe"))
    agencies = [item.get("jrsdInsttNm"), item.get("excInsttNm")]
    agri, agri_basis, fish = classify_sector(
        [title], [clean_text(item.get("bsnsSumryCn"))], agencies, tags=tags)
    return _finish({
        "uid": f"bizinfo:{item.get('pblancId')}", "source": "bizinfo", "kind": "공고",
        "personas": personas_for([title, item.get("trgetNm")], [BIZINFO_AUDIENCE.get(item.get("trgetNm"))], agri),
        "title": title, "agency": item.get("jrsdInsttNm") or "", "operator": item.get("excInsttNm") or "",
        "category": item.get("pldirSportRealmLclasCodeNm") or "", "target": item.get("trgetNm") or "",
        "summary": clean_text(item.get("bsnsSumryCn")), "content": "",
        "how": clean_text(item.get("reqstMthPapersCn")),
        "audience": [BIZINFO_AUDIENCE[item["trgetNm"]]] if item.get("trgetNm") in BIZINFO_AUDIENCE else [],
        "period_text": item.get("reqstBeginEndDe") or "", "period_type": ptype,
        "apply_start": start, "apply_end": end,
        "regions": region_label(found), "region_basis": basis if found else "",
        "agri": agri, "agri_basis": agri_basis, "fish": int(fish), "is_private": 0,
        "url": item.get("pblancUrl") or "", "apply_url": item.get("rceptEngnHmpgUrl") or "",
        "contact": clean_text(item.get("refrncNm")), "files": item.get("fileNm") or "",
        "source_updated": item.get("updtPnttm") or item.get("creatPnttm") or "",
        "posted": to_date(item.get("creatPnttm")), "views": int(re.sub(r'\D', '', str(item.get("inqireCo") or '')) or 0),
    })


KSTARTUP_HOW = [("온라인", "aply_mthd_onli_rcpt_istc"), ("방문", "aply_mthd_vst_rcpt_istc"),
                ("우편", "aply_mthd_pssr_rcpt_istc"), ("팩스", "aply_mthd_fax_rcpt_istc"),
                ("이메일", "aply_mthd_eml_rcpt_istc"), ("기타", "aply_mthd_etc_istc")]


def from_kstartup(item):
    title = clean_text(item.get("biz_pbanc_nm"))
    found = regions_from_tokens(re.split(r"[,ㆍ·]", item.get("supt_regin") or ""))
    start, end = ymd8(item.get("pbanc_rcpt_bgng_dt")), ymd8(item.get("pbanc_rcpt_end_dt"))
    agencies = [item.get("pbanc_ntrp_nm"), item.get("sprv_inst")]
    agri, agri_basis, fish = classify_sector(
        [title], [clean_text(item.get("aply_trgt_ctnt")), clean_text(item.get("pbanc_ctnt"))], agencies)
    return _finish({
        "uid": f"kstartup:{item.get('pbanc_sn')}", "source": "kstartup", "kind": "공고",
        "personas": personas_for([title, clean_text(item.get("aply_trgt_ctnt"))], [AUD_STARTUP], agri),
        "title": title, "agency": item.get("pbanc_ntrp_nm") or "", "operator": item.get("sprv_inst") or "",
        "category": clean_text(item.get("supt_biz_clsfc")), "target": clean_text(item.get("aply_trgt_ctnt")),
        "summary": clean_text(item.get("pbanc_ctnt")), "content": "",
        "how": " / ".join(f"{label}: {clean_text(item.get(k))}" for label, k in KSTARTUP_HOW if item.get(k)),
        "audience": [AUD_STARTUP],
        "period_text": f"{item.get('pbanc_rcpt_bgng_dt') or ''} ~ {item.get('pbanc_rcpt_end_dt') or ''}",
        "period_type": "기간" if end else "미상", "apply_start": start, "apply_end": end,
        "regions": region_label(found), "region_basis": "지역명" if found else "",
        "agri": agri, "agri_basis": agri_basis, "fish": int(fish),
        "is_private": int((item.get("sprv_inst") or "") == "민간"),
        "url": item.get("detl_pg_url") or "", "apply_url": item.get("biz_aply_url") or "",
        "contact": " ".join(x for x in (item.get("biz_prch_dprt_nm"), item.get("prch_cnpl_no")) if x),
        "files": "", "source_updated": "",
        "posted": ymd8(item.get("pbanc_rcpt_bgng_dt")) or "", "views": 0,  # K-Startup은 등록일이 없어 접수 시작일로 대신한다
    })


def from_gov24(item, sigungu):
    title = clean_text(item.get("서비스명"))
    kind_of_agency = item.get("소관기관유형") or ""
    if kind_of_agency in ("중앙행정기관", "공공기관"):
        found, basis = set(REGIONS), "중앙기관"
    else:
        found = regions_from_name(item.get("소관기관명")) or regions_from_sigungu(item.get("소관기관명"), sigungu)
        basis = "소관기관" if found else ""
    start, end, ptype = parse_period(item.get("신청기한"))

    cond = item.get("_지원조건") or {}
    occupational = sum(1 for k, v in cond.items() if k.startswith(JA_OCCUPATION_PREFIX) and v == "Y")
    specific = occupational <= JA_SPECIFIC_MAX
    extra_agri = None
    if item.get("서비스분야") == "농림축산어업":
        extra_agri = "분야:농림축산어업"
    if specific and any(cond.get(k) == "Y" for k in JA_AGRI):
        extra_agri = ((extra_agri + "; ") if extra_agri else "") + "지원조건:농업인등"
    fish_cond = specific and any(cond.get(k) == "Y" for k in JA_FISH)
    agri, agri_basis, fish = classify_sector(
        [title], [clean_text(item.get("지원대상"))], [item.get("소관기관명")],
        extra_agri=extra_agri, extra_fish=fish_cond)
    # 분야가 '농림축산어업'이어도 수산 전용이면 농업으로 세지 않는다
    if agri == 2 and fish and agri_basis == "분야:농림축산어업":
        agri, agri_basis = 0, ""

    audience = sorted({GOV24_AUDIENCE[a] for a in (item.get("사용자구분") or "").split("||")
                       if a in GOV24_AUDIENCE}, key=AUDIENCES.index)
    return _finish({
        "uid": f"gov24:{item.get('서비스ID')}", "source": "gov24", "kind": "제도",
        "personas": personas_for([title], audience, agri, cond),
        "support": support_groups(item.get("지원유형")),
        "title": title, "agency": item.get("소관기관명") or "", "operator": item.get("부서명") or "",
        "category": item.get("서비스분야") or "", "target": clean_text(item.get("지원대상")),
        "summary": clean_text(item.get("서비스목적요약")), "content": clean_text(item.get("지원내용")),
        "how": clean_text((item.get("신청방법") or "").replace("||", ", ")),
        "audience": audience,
        "period_text": clean_text(item.get("신청기한")), "period_type": ptype,
        "apply_start": start, "apply_end": end,
        "regions": region_label(found), "region_basis": basis,
        "agri": agri, "agri_basis": agri_basis, "fish": int(fish), "is_private": 0,
        "url": item.get("상세조회URL") or "", "apply_url": "",
        "contact": clean_text(item.get("전화문의")), "files": "",
        "source_updated": item.get("수정일시") or "",
        "posted": to_date(item.get("등록일시")), "views": int(re.sub(r'\D', '', str(item.get("조회수") or '')) or 0),
    })


def from_bojo_rows(rows):
    """국고보조금 공모는 수행기관마다 한 행씩 온다. 공고(nttId) 단위로 묶는다."""
    first = rows[0]
    title = clean_text(first.get("PBLANC_NM"))
    m = re.search(r"nttId=([^&]+)", first.get("PBLANC_POPUP_URL") or "")
    found = set()
    for r in rows:
        found |= regions_from_tokens([r.get("CTPRVN_NM") or ""])
    start = ymd8(first.get("RCEPT_BEGIN_DE")) or ymd8(first.get("PBLANC_BEGIN_DE"))
    end = ymd8(first.get("RCEPT_END_DE")) or ymd8(first.get("PBLANC_END_DE"))
    operators = sorted({r.get("DLVPL_NM") for r in rows if r.get("DLVPL_NM")})
    agri, agri_basis, fish = classify_sector(
        [title, clean_text(first.get("DDTLBZ_NM")), clean_text(first.get("DTLBZ_NM"))],
        [clean_text(first.get("SPORT_TRGET_CN")), clean_text(first.get("DDTLBZ_BSNS_PURPS_DC"))],
        [first.get("JRSD_NM")])
    return _finish({
        "uid": f"bojo:{m.group(1) if m else first.get('DDTLBZ_ID')}", "source": "bojo", "kind": "공고",
        "personas": personas_for([title, clean_text(first.get("SPORT_TRGET_CN"))], [AUD_ORG], agri),
        "title": title, "agency": first.get("JRSD_NM") or "",
        "operator": ", ".join(operators[:5]) + (f" 외 {len(operators) - 5}곳" if len(operators) > 5 else ""),
        "category": clean_text(first.get("DTLBZ_NM")), "target": clean_text(first.get("SPORT_TRGET_CN")),
        "summary": clean_text(first.get("DDTLBZ_BSNS_PURPS_DC")), "content": clean_text(first.get("SPORT_CN_DC")),
        "how": clean_text(first.get("REQST_RCEPT_MTH_CN")), "audience": [AUD_ORG],
        "period_text": clean_text(first.get("RCEPT_PD_DC")) or f"{start or ''} ~ {end or ''}",
        "period_type": "기간" if end else "미상", "apply_start": start, "apply_end": end,
        "regions": region_label(found), "region_basis": "수행기관 소재지" if found else "",
        "agri": agri, "agri_basis": agri_basis, "fish": int(fish), "is_private": 0,
        "url": first.get("PBLANC_POPUP_URL") or "", "apply_url": first.get("BSNS_GUIDANCE_URL") or "",
        "contact": "", "files": "", "source_updated": first.get("PBLANC_UPDT_DT") or "",
        "posted": ymd8(first.get("PBLANC_BEGIN_DE")) or start or "", "views": 0,
    })


STATUS_BY_TYPE = {"상시": "상시", "소진시": "소진 시까지", "정기": "매년 정기",
                  "신청불필요": "신청 불필요", "별도": "확인 필요", "미상": "확인 필요"}


def status_of(rec, today):
    """오늘(YYYY-MM-DD) 기준 신청 상태. 날짜가 없는 공고에 임의 마감일을 만들지 않는다."""
    if rec["period_type"] != "기간":
        return STATUS_BY_TYPE.get(rec["period_type"], "확인 필요")
    if rec["apply_start"] and today < rec["apply_start"]:
        return "접수 예정"
    if rec["apply_end"] and today > rec["apply_end"]:
        return "마감"
    return "접수 중"


def normalize(source, items):
    if source == "bojo":
        groups = defaultdict(list)
        for row in items:
            m = re.search(r"nttId=([^&]+)", row.get("PBLANC_POPUP_URL") or "")
            groups[m.group(1) if m else row.get("DDTLBZ_ID")].append(row)
        return [from_bojo_rows(rows) for rows in groups.values()]
    if source == "gov24":
        sigungu = build_sigungu_map(items)
        return [from_gov24(item, sigungu) for item in items]
    fn = {"bizinfo": from_bizinfo, "kstartup": from_kstartup}[source]
    return [fn(item) for item in items]
