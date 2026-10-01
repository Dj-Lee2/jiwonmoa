"""출처별 원본을 공통 형식(공고 1건 = dict 1개)으로 바꾼다.

지역·농업 판정은 규칙 기반이며, 판정 근거를 함께 남겨 사람이 검수할 수 있게 한다.
"""
import difflib
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
PERSONAS = ["청년", "시니어", "장애인", "임산부·출산", "한부모·다자녀", "구직자", "근로자·직장인", "학생", "보훈대상자",
            "질병·질환자", "다문화·북한이탈주민", "무주택", "1인가구", "농업인",
            AUD_SOHO, AUD_SME, AUD_STARTUP, AUD_ORG]
# 제목(공고는 지원대상 글도)에서 찾는 말. '고령군'·'유통경로'처럼 다른 뜻으로 쓰이는 경우는 뺀다
PERSONA_WORDS = {
    "청년": [r"청년"],
    "시니어": [r"어르신", r"노인", r"고령(?!군)", r"시니어", r"경로당"],
    "장애인": [r"장애"],
    "임산부·출산": [r"임산부", r"임신", r"출산", r"난임", r"산모", r"산후"],
    "한부모·다자녀": [r"한부모", r"다자녀", r"조손"],
    "구직자": [r"구직", r"실업", r"취업준비"],
    "학생": [r"학생"],
    "보훈대상자": [r"보훈", r"국가유공자", r"참전"],
    # '가축질병'·'온열질환 예방'처럼 사람 대상이 아닌 경우가 많아 사람을 가리키는 말만 쓴다
    "질병·질환자": [r"환자", r"질환자", r"희귀질환", r"난치", r"중증질환", r"만성질환", r"정신질환", r"치매", r"투병"],
    "다문화·북한이탈주민": [r"다문화", r"북한이탈", r"탈북", r"새터민", r"결혼이민"],
    "무주택": [r"무주택"],
    "1인가구": [r"1인\s?가구", r"독거"],
    "근로자·직장인": [r"근로자", r"직장인", r"노동자", r"재직자"],
    AUD_STARTUP: [r"창업"],
}
PERSONA_PATTERNS = {p: re.compile("|".join(ws)) for p, ws in PERSONA_WORDS.items()}
# 이 대상들은 제목에서만 찾는다. 지원대상 글은 '대학생·일반인·…'처럼 여럿을 늘어놓는 경우가 많아 잘못 걸린다
TITLE_ONLY_PERSONAS = {"학생", "보훈대상자", "질병·질환자", "다문화·북한이탈주민", "무주택", "1인가구", "근로자·직장인"}
# 이 대상은 보조금24(사람 대상 제도)에서만 말로 찾는다. 기업 공고의 '외국인 근로자 고용'·'근로자 재해예방 시설'은
# 기업이 신청하는 사업이라 근로자 대상이 아니다
PERSON_ONLY_PERSONAS = {"근로자·직장인"}
# 보조금24 지원조건 코드 → 대상. 그 묶음에서 몇 개만 Y인 제도만 '그 대상 전용'으로 본다(전부 Y면 누구나 대상)
JA_PERSONA = {"장애인": ["JA0328"], "임산부·출산": ["JA0301", "JA0302", "JA0303"],
              "한부모·다자녀": ["JA0403", "JA0411"], "구직자": ["JA0327"], "근로자·직장인": ["JA0326"],
              "학생": ["JA0317", "JA0318", "JA0319", "JA0320"], "보훈대상자": ["JA0329"],
              "질병·질환자": ["JA0330"], "다문화·북한이탈주민": ["JA0401", "JA0402"],
              "무주택": ["JA0412"], "1인가구": ["JA0404"],
              AUD_STARTUP: ["JA1101"], AUD_SOHO: ["JA1102"], AUD_SME: ["JA2101"],
              AUD_ORG: ["JA2102", "JA2103"]}
JA_GROUPS = [("JA03", {"JA0322"}, 4), ("JA04", {"JA0410"}, 4), ("JA11", set(), 2), ("JA21", set(), 2)]
# 상세 화면에 보이는 지원조건 이름(docs/api-specs 코드표, 표기만 다듬음. '음식적업'은 코드표의 오타)
JA_LABEL = {
    "JA0301": "예비부모·난임", "JA0302": "임산부", "JA0303": "출산·입양", "JA0313": "농업인", "JA0314": "어업인",
    "JA0315": "축산업인", "JA0316": "임업인", "JA0317": "초등학생", "JA0318": "중학생", "JA0319": "고등학생",
    "JA0320": "대학생·대학원생", "JA0326": "근로자·직장인", "JA0327": "구직자·실업자", "JA0328": "장애인",
    "JA0329": "국가보훈대상자", "JA0330": "질병·질환자",
    "JA0401": "다문화가족", "JA0402": "북한이탈주민", "JA0403": "한부모·조손 가정", "JA0404": "1인 가구",
    "JA0411": "다자녀 가구", "JA0412": "무주택 세대", "JA0413": "신규 전입", "JA0414": "확대가족",
    "JA1101": "예비창업자", "JA1102": "영업 중", "JA1103": "생계곤란·폐업 예정",
    "JA1201": "음식점업", "JA1202": "제조업", "JA1299": "기타 업종",
    "JA2101": "중소기업", "JA2102": "사회복지시설", "JA2103": "기관·단체",
    "JA2201": "제조업", "JA2202": "농업·임업·어업", "JA2203": "정보통신업", "JA2299": "기타 업종",
}
# 이 코드는 대상 이름과 뜻이 같아, 그 대상이 이미 붙어 있으면 조건 줄로 또 쓰지 않는다
JA_SAME_AS_PERSONA = {"JA0326": "근로자·직장인", "JA0327": "구직자", "JA0328": "장애인", "JA0329": "보훈대상자",
                      "JA0330": "질병·질환자", "JA0313": "농업인", "JA0404": "1인가구", "JA0412": "무주택",
                      "JA1102": AUD_SOHO, "JA2101": AUD_SME}
# (화면 이름, 덧붙임, 코드 묶음 앞자리, 빼는 코드). 묶음의 일부만 Y일 때만 조건으로 쓴다(전부 Y = 누구나)
JA_FACTS = [("개인 특성", "", "JA03", {"JA0322"}), ("가구 특성", "", "JA04", {"JA0410"}),
            ("영업 상태", "소상공인 기준", "JA11", set()), ("업종", "소상공인 기준", "JA12", set()),
            ("법인 유형", "", "JA21", set()), ("업종", "기업 기준", "JA22", set())]
JA_FACT_MOST = {"JA03": 4, "JA04": 4}  # 개인·가구 특성은 4개 넘게 Y면 사실상 누구나라 쓰지 않는다
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
PERIOD_RULES = [  # (종류, 판정 단어·정규식) — 위에서부터 먼저 맞는 것
    ("신청불필요", ["신청불필요", "신청 불필요", "신청불요", "신청절차가 없음", "신청절차 없음", "직권",
                "신청없이", "신청 없이", "자동가입", "자동 가입", "자동지급", "자동 지급",
                "별도신청 없음", "별도 신청 없음", "별도신청없음"]),
    ("소진시", ["예산 소진", "예산소진", "선착순", "선순 마감", "모집 완료", "모집완료", "모집 마감시", "마감시까지",
              "소진시", "소진 시", "소진 전", "모집규모 충족", "모집인원 충족"]),
    ("상시", ["상시", "수시", "연중"]),
    # 정해진 날 없이 출생·사고·전입처럼 일이 생긴 날부터 기한을 세는 사업(화면은 원문 기한을 그대로 보여 준다)
    ("사유발생", [re.compile(r"(?:로부터|부터|이후|후)\s*.{0,14}?(?:이내|안에|까지|\d+\s*(?:개월|년|일)|경과)")]),
    # 매월·분기처럼 1년에 여러 번 받는 사업('매년 정기'와 섞지 않는다)
    ("주기", ["매월", "매주", "매분기", "분기별", "분기마다", "월 1회", "월1회"]),
    ("정기", ["매년", "연초", "연말", "상반기", "하반기", "월 중", "월초", "월말", "연1회", "연 1회"]),
    # 시군구·접수기관·세부사업마다 기간이 다른 사업(어디에 물어야 하는지 원문을 보여 준다)
    ("기관별", ["상이", "기관별", "시군구별", "지자체별", "읍면동별", "따라 다를", "따라 다름"]),
    ("별도", ["추후", "별도", "문의", "공고 시", "공고시", "참조", "참고", "따름", "공지", "미정"]),
]


def _rule_hits(text, words):
    return any(w.search(text) if hasattr(w, "search") else w in text for w in words)


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
        if kind in ("기관별", "별도") and MONTH_RE.search(text):
            return None, None, "정기"
        if _rule_hits(text, words):
            return None, None, kind
    if MONTH_RE.search(text):
        return None, None, "정기"
    return None, None, "미상"


# 상세 화면에 더 보여 주는 정보: 조건(conditions = [이름, 값, 덧붙임?]) 줄과 글(details = [제목, 글]) 칸.
# '공고문 참조'·'해당없음'처럼 내용이 없는 글은 넣지 않는다.
FILLER_RE = re.compile(
    r"^(?:-|없음|해당\s*(?:사항\s*)?없음|내용\s*없음|별도\s*제출|공고\s*시\s*안내|"
    r"(?:※\s*)?(?:첨부된\s*)?(?:모집\s*|사업\s*)?(?:공고문?|공모)\s*(?:세부\s*내용\s*)?(?:참조|참고|확인))\.?$")
# 글 안의 첫 주소. http가 빠진 'www.'·'forms.gle/…'·'startup.daegu.go.kr/…'도 잡고, 이메일 주소는 잡지 않는다
URL_RE = re.compile(
    r"https?://[^\s<>\"'()\[\]{}]+"
    r"|(?<![@\w.])(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:kr|com|net|org|me|ly|gle|io|co|so|link)"
    r"(?:/[^\s<>\"'()\[\]{}]*)?", re.I)
# 보조금24 지원조건의 중위소득 다섯 구간(JA0201~JA0205)
INCOME_CODES = ["JA0201", "JA0202", "JA0203", "JA0204", "JA0205"]
INCOME_LOW, INCOME_HIGH = [0, 51, 76, 101, 201], [50, 75, 100, 200, None]
NO_AGE_LIMIT = 100  # 보조금24는 나이 상한이 없으면 120을 넣는다


def substantive(text):
    """내용이 있는 글만 돌려준다. '공고문 참조'·'해당없음' 같은 빈말은 빈 문자열."""
    text = clean_text(text)
    return "" if not text or FILLER_RE.match(text) else text


def first_url(text):
    m = URL_RE.search(clean_text(text))
    if not m:
        return ""
    url = m.group(0).rstrip(".,;")
    return url if re.match(r"https?://", url, re.I) else "https://" + url


def age_text(lo, hi):
    """보조금24 나이 조건(시작·끝)을 '19~34세' 같은 글로. 제한이 없으면 빈 문자열."""
    if not isinstance(lo, int) or not isinstance(hi, int) or (lo <= 0 and hi >= NO_AGE_LIMIT):
        return ""
    if lo <= 0:
        return f"{hi}세 이하"
    if hi >= NO_AGE_LIMIT:
        return f"{lo}세 이상"
    return f"{lo}~{hi}세"


def income_text(cond):
    """중위소득 조건. 다섯 구간이 다 Y거나 이어지지 않으면 제한 없음으로 보고 빈 문자열."""
    ys = [i for i, k in enumerate(INCOME_CODES) if cond.get(k) == "Y"]
    if not ys or len(ys) == len(INCOME_CODES) or ys != list(range(ys[0], ys[-1] + 1)):
        return ""
    lo, hi = INCOME_LOW[ys[0]], INCOME_HIGH[ys[-1]]
    if lo == 0:
        return f"중위소득 {hi}% 이하"
    if hi is None:
        return f"중위소득 {lo - 1}% 초과"
    return f"중위소득 {lo}~{hi}%"


def gender_text(cond):
    male, female = cond.get("JA0101") == "Y", cond.get("JA0102") == "Y"
    return "여성" if female and not male else "남성" if male and not female else ""


def won(amount):
    """원 단위 금액을 '2억 5,000만 원'처럼. 만 원보다 작으면 빈 문자열(잘못 들어간 값)."""
    eok, man = divmod(int(amount or 0) // 10000, 10000)
    if not eok and not man:
        return ""
    return " ".join(p for p in (f"{eok:,}억" if eok else "", f"{man:,}만" if man else "") if p) + " 원"


def pairs(*items):
    """[이름, 값(, 덧붙임)] 목록에서 값이 빈 것을 뺀다."""
    return [list(i) for i in items if i[1]]


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


def personas_for(texts, base=(), agri=0, cond=None, person=False):
    """'누구를 위한 지원' 대상 목록. 글에 나온 말, 기존 대상 구분, 농업 판정, 보조금24 지원조건을 합친다.

    texts[0]은 제목이다(TITLE_ONLY_PERSONAS는 제목에서만 찾는다).
    person: 사람이 신청하는 제도(보조금24)인지. PERSON_ONLY_PERSONAS는 이때만 말로 찾는다.
    """
    found = {b for b in base if b in PERSONAS}
    text, title = match_text(texts), match_text(texts[:1])
    found.update(p for p, pat in PERSONA_PATTERNS.items()
                 if (person or p not in PERSON_ONLY_PERSONAS)
                 and pat.search(title if p in TITLE_ONLY_PERSONAS else text))
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


def gov24_condition_facts(cond, personas):
    """보조금24 지원조건 중 대상 칩으로 다 나타나지 않는 것(개인·가구 특성, 영업 상태, 업종, 법인 유형)을 조건 줄로.

    묶음의 일부만 Y일 때만 쓴다. 고른 칸 이름을 그대로 늘어놓고, '기타 업종'을 '○○ 제외'처럼 바꿔 읽지 않는다.
    고른 칸이 모두 이미 붙은 대상과 같은 뜻이면(예: 장애인 하나, 중소기업 하나) 쓰지 않는다.
    """
    facts = []
    for label, note, prefix, skip in JA_FACTS:
        group = [k for k in JA_LABEL if k.startswith(prefix) and k not in skip]
        ys = [k for k in group if cond.get(k) == "Y"]
        if not ys or len(ys) == len(group) or len(ys) > JA_FACT_MOST.get(prefix, len(group)):
            continue
        if all(JA_SAME_AS_PERSONA.get(k) in personas for k in ys):
            continue
        value = ", ".join(JA_LABEL[k] for k in ys)
        facts.append((label, value, note) if note else (label, value))
    # 소상공인 업종과 기업 업종이 같으면 한 줄로
    trades = [f for f in facts if f[0] == "업종"]
    if len(trades) == 2 and trades[0][1] == trades[1][1]:
        facts = [f for f in facts if f[0] != "업종"] + [("업종", trades[0][1], "소상공인·기업 기준")]
    return facts


def _squash(text):
    return re.sub(r"[\s\W_]+", "", text or "")


def purpose_text(summary, purpose):
    """상세 화면 '서비스 목적' 글. 목록의 요약(서비스목적요약)과 상세의 원문(서비스목적)이 겹치면 긴 쪽 하나,
    서로 다른 말이면 둘 다(요약에만 '수강료 50% 감면' 같은 구체적인 내용이 있는 경우가 있다).
    빈 문자열이면 화면은 요약을 그대로 쓴다."""
    p = substantive(purpose)
    if not p:
        return ""
    a, b = _squash(summary), _squash(p)
    if not a:
        return p
    # 짧은 쪽 글자가 긴 쪽에 거의 다(85%) 순서대로 들어 있으면 같은 말이다(상세가 요약 중간에 말을 보탠 경우 포함)
    common = sum(m.size for m in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks())
    if common >= 0.85 * min(len(a), len(b)):
        return p if len(b) > len(a) else ""
    return f"{summary}\n{p}"


def file_links(notice_name, notice_url, names, urls):
    """기업마당 공고문·첨부 파일 [이름, 주소, 공고문이면 1]. 이름과 주소는 '@'로 이어져 오고 순서가 같다.

    개수가 안 맞으면 어느 이름이 어느 파일인지 알 수 없으므로 첨부는 싣지 않는다(공고문만).
    """
    files = []
    if notice_name and re.match(r"https?://", notice_url or ""):
        files.append([clean_text(notice_name), notice_url.strip(), 1])
    names = [n for n in (names or "").split("@") if n.strip()]
    urls = [u for u in (urls or "").split("@") if u.strip()]
    if len(names) == len(urls):
        files += [[clean_text(n), u.strip(), 0] for n, u in zip(names, urls)
                  if re.match(r"https?://", u.strip()) and u.strip() != (notice_url or "").strip()]
    return files


def content_hash(rec):
    keys = ("title", "period_text", "target", "summary", "content", "how", "apply_url", "files")
    values = [rec.get(k) for k in keys]
    # 조건·글 칸은 내용이 있을 때만 넣는다: 없는 공고는 칸이 생기기 전과 같은 값이 되어 '바뀜'으로 잡히지 않는다
    values += [rec[k] for k in ("conditions", "details", "purpose") if rec.get(k)]
    blob = json.dumps(values, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def to_date(value):
    """출처마다 다른 수정일시 표기(2026-09-29 14:55:18, 20260129201825, 20260819)를 날짜로."""
    digits = re.sub(r"\D", "", str(value or ""))
    return _ymd(digits[:4], digits[4:6], digits[6:8]) if len(digits) >= 8 else ""


def _finish(rec):
    rec["source_updated"] = to_date(rec["source_updated"])
    rec.setdefault("conditions", [])
    rec.setdefault("details", [])
    rec.setdefault("purpose", "")
    rec.setdefault("attachments", [])  # 파일 이름·주소는 files(이름)로 이미 '바뀜'을 가린다 → 해시에 넣지 않는다
    rec["content_hash"] = content_hash(rec)
    rec["regions"] = json.dumps(rec["regions"], ensure_ascii=False)
    rec["audience"] = json.dumps(rec["audience"], ensure_ascii=False)
    rec["personas"] = json.dumps(rec["personas"], ensure_ascii=False)
    rec["support"] = json.dumps(rec.get("support", []), ensure_ascii=False)
    rec["conditions"] = json.dumps(rec["conditions"], ensure_ascii=False)
    rec["details"] = json.dumps(rec["details"], ensure_ascii=False)
    rec["attachments"] = json.dumps(rec["attachments"], ensure_ascii=False)
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
        "attachments": file_links(item.get("printFileNm"), item.get("printFlpthNm"),
                                  item.get("fileNm"), item.get("flpthNm")),
        "source_updated": item.get("updtPnttm") or item.get("creatPnttm") or "",
        "posted": to_date(item.get("creatPnttm")), "views": int(re.sub(r'\D', '', str(item.get("inqireCo") or '')) or 0),
    })


KSTARTUP_HOW = [("온라인", "aply_mthd_onli_rcpt_istc"), ("방문", "aply_mthd_vst_rcpt_istc"),
                ("우편", "aply_mthd_pssr_rcpt_istc"), ("팩스", "aply_mthd_fax_rcpt_istc"),
                ("이메일", "aply_mthd_eml_rcpt_istc"), ("기타", "aply_mthd_etc_istc")]
# 창업 기간 칩: '예비창업자,1년미만,…,7년미만'에서 예비창업자 여부와 가장 긴 업력만 뽑는다
KSTARTUP_YEARS = ["1년미만", "2년미만", "3년미만", "5년미만", "7년미만", "10년미만"]
KSTARTUP_AGES = ["만 20세 미만", "만 20세 이상 ~ 만 39세 이하", "만 40세 이상"]
KSTARTUP_TARGETS = ["청소년", "대학생", "일반인", "대학", "연구기관", "일반기업", "1인 창조기업"]


def kstartup_targets(value):
    """신청 대상 구분. 일곱 칸을 다 고른 공고(누구나)는 쓰지 않는다."""
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    if not parts or all(t in parts for t in KSTARTUP_TARGETS):
        return ""
    return ", ".join(parts)


def kstartup_years(value):
    """창업 기간 칸. 1년미만부터 이어진 칸이면 'N년 미만'으로 줄이고, 아니면 출처 칸 이름을 그대로 쓴다
    ('7년미만' 하나만 고른 공고가 '5~7년'인지 '7년 미만 전부'인지 출처가 밝히지 않으므로 해석하지 않는다)."""
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    years = [y for y in KSTARTUP_YEARS if y in parts]
    pre = "예비창업자" in parts
    if not parts or (pre and len(years) == len(KSTARTUP_YEARS)):
        return ""  # 업력 제한 없음
    if years and years == KSTARTUP_YEARS[:len(years)]:
        span = [f"창업 {years[-1].replace('미만', ' 미만')}"]
    else:
        span = [y.replace("미만", " 미만") for y in years]
    return ", ".join((["예비창업자"] if pre else []) + span)


def kstartup_ages(value):
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    if not parts or all(a in parts for a in KSTARTUP_AGES):
        return ""
    if parts == ["만 20세 이상 ~ 만 39세 이하"]:
        return "만 20~39세"
    if parts == ["만 20세 이상 ~ 만 39세 이하", "만 40세 이상"]:
        return "만 20세 이상"
    if parts == ["만 20세 미만", "만 20세 이상 ~ 만 39세 이하"]:
        return "만 39세 이하"
    return ", ".join(parts)


def from_kstartup(item):
    title = clean_text(item.get("biz_pbanc_nm"))
    program = clean_text(item.get("intg_pbanc_biz_nm"))
    found = regions_from_tokens(re.split(r"[,ㆍ·]", item.get("supt_regin") or ""))
    start, end = ymd8(item.get("pbanc_rcpt_bgng_dt")), ymd8(item.get("pbanc_rcpt_end_dt"))
    agencies = [item.get("pbanc_ntrp_nm"), item.get("sprv_inst")]
    agri, agri_basis, fish = classify_sector(
        [title], [clean_text(item.get("aply_trgt_ctnt")), clean_text(item.get("pbanc_ctnt"))], agencies)
    # 신청 주소: 온라인 접수 칸의 주소가 있으면 그것, 없으면 사업 안내 주소
    apply_url = first_url(item.get("aply_mthd_onli_rcpt_istc")) or first_url(item.get("biz_gdnc_url"))
    return _finish({
        "uid": f"kstartup:{item.get('pbanc_sn')}", "source": "kstartup", "kind": "공고",
        "personas": personas_for([title, clean_text(item.get("aply_trgt_ctnt"))], [AUD_STARTUP], agri),
        "title": title, "agency": item.get("pbanc_ntrp_nm") or "", "operator": item.get("sprv_inst") or "",
        "category": clean_text(item.get("supt_biz_clsfc")), "target": clean_text(item.get("aply_trgt_ctnt")),
        "summary": clean_text(item.get("pbanc_ctnt")), "content": "",
        "how": " / ".join(f"{label}: {clean_text(item.get(k))}" for label, k in KSTARTUP_HOW if item.get(k)),
        "audience": [AUD_STARTUP],
        # 통합공고는 여러 공고를 묶는 정부 사업 이름이 따로 있다(예: '창업보육센터 지원')
        "conditions": pairs(("사업명", program if item.get("intg_pbanc_yn") == "Y" and program != title else ""),
                            ("신청 대상", kstartup_targets(item.get("aply_trgt"))),
                            ("창업 기간", kstartup_years(item.get("biz_enyy"))),
                            ("나이", kstartup_ages(item.get("biz_trgt_age")))),
        "details": pairs(("신청 제외 대상", substantive(item.get("aply_excl_trgt_ctnt"))),
                         ("우대 사항", substantive(item.get("prfn_matr")))),
        "period_text": f"{item.get('pbanc_rcpt_bgng_dt') or ''} ~ {item.get('pbanc_rcpt_end_dt') or ''}",
        "period_type": "기간" if end else "미상", "apply_start": start, "apply_end": end,
        "regions": region_label(found), "region_basis": "지역명" if found else "",
        "agri": agri, "agri_basis": agri_basis, "fish": int(fish),
        "is_private": int((item.get("sprv_inst") or "") == "민간"),
        "url": item.get("detl_pg_url") or "", "apply_url": item.get("biz_aply_url") or apply_url,
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
    # 상세(serviceDetail, sources.fetch_gov24가 '_상세'로 붙인다): 구비서류·선정기준·근거 법령·온라인 신청 주소
    detail = item.get("_상세") or {}
    laws = [x.strip() for k in ("법령", "자치법규", "행정규칙")
            for x in (detail.get(k) or "").split("||") if x.strip()]
    personas = personas_for([title], audience, agri, cond, person=True)
    return _finish({
        "uid": f"gov24:{item.get('서비스ID')}", "source": "gov24", "kind": "제도",
        "personas": personas,
        "support": support_groups(item.get("지원유형")),
        "title": title, "agency": item.get("소관기관명") or "", "operator": item.get("부서명") or "",
        "category": item.get("서비스분야") or "", "target": clean_text(item.get("지원대상")),
        "summary": clean_text(item.get("서비스목적요약")), "content": clean_text(item.get("지원내용")),
        # 상세 화면의 '서비스 목적' 글(요약과 상세 원문을 합친 것, 없으면 화면이 요약을 쓴다). 요약은 목록·검색에 쓴다
        "purpose": purpose_text(clean_text(item.get("서비스목적요약")), detail.get("서비스목적")),
        # 목록의 신청방법은 '방문신청' 같은 구분뿐이고, 상세에는 어디로 어떻게 내는지가 적혀 있다
        "how": substantive(detail.get("신청방법")) or clean_text((item.get("신청방법") or "").replace("||", ", ")),
        "audience": audience,
        "conditions": pairs(("나이", age_text(cond.get("JA0110"), cond.get("JA0111"))),
                            ("소득", income_text(cond)), ("성별", gender_text(cond)),
                            *gov24_condition_facts(cond, personas),
                            ("접수 기관", substantive(detail.get("접수기관명")))),
        "details": pairs(("선정 기준", substantive(detail.get("선정기준"))),
                         ("구비 서류", substantive(detail.get("구비서류"))),
                         ("공무원이 확인하는 서류", substantive(detail.get("공무원확인구비서류"))),
                         ("본인 확인이 필요한 서류", substantive(detail.get("본인확인필요구비서류"))),
                         ("근거 법령", "\n".join(dict.fromkeys(laws)))),
        "period_text": clean_text(item.get("신청기한")), "period_type": ptype,
        "apply_start": start, "apply_end": end,
        "regions": region_label(found), "region_basis": basis,
        "agri": agri, "agri_basis": agri_basis, "fish": int(fish), "is_private": 0,
        "url": item.get("상세조회URL") or "", "apply_url": first_url(detail.get("온라인신청사이트URL")),
        "contact": clean_text(item.get("전화문의")), "files": "",
        "source_updated": item.get("수정일시") or "",
        "posted": to_date(item.get("등록일시")), "views": int(re.sub(r'\D', '', str(item.get("조회수") or '')) or 0),
    })


def _money(value):
    return int(re.sub(r"[^\d]", "", str(value or "")) or 0)


# 국고보조금 사업비 분담 칸(순서 = 화면 순서, 자부담은 세 번째)과 자부담 언급을 찾는 글 칸
BOJO_SHARES = [("GOVSUBY", "국고"), ("LOCGOV_ALOTM", "지방비"), ("SALM", "자부담"), ("ETC_ALOTM", "기타")]
BOJO_TEXT_KEYS = ("SPORT_CND_CN", "SPORT_CN_DC", "SPORT_TRGET_CN", "PRESENTN_PAPERS_GUIDANCE_CN",
                  "SLCTN_STDR_DC", "EXCL_TRGET_CN", "DDTLBZ_BSNS_PURPS_DC", "PBLANC_NM")


def _bsns_day(value):
    """'2025.04.01.' → 2025.4.1"""
    m = DATE_RE.search(str(value or ""))
    return f"{int(m.group(1))}.{int(m.group(2))}.{int(m.group(3))}" if m else ""


def bojo_conditions(first, rows):
    """국고보조금 공모의 사업 예산·사업비 분담·사업 기간. 예산은 사업 전체 규모이지 한 곳이 받는 돈이 아니다.

    사업비 분담(국고·지방비·자부담·기타의 비율)은 수행기관 행마다 비율이 같고, 넷을 더해 사업비와 맞을 때만 쓴다.
    국고만 100%이면 쓰지 않는다: 자부담 금액이 0이어도 글에 '자부담 10%'가 있는 공고가 있어(약 5%)
    '자부담 없음'으로 읽힐 수 있는 표시는 하지 않는다. 같은 까닭으로 자부담이 0인데 글에 자부담·자기부담이
    나오면 분담 줄을 통째로 뺀다.
    """
    budget = won(_money(first.get("SPORT_BGAMT")))
    shares = set()
    for r in rows:
        total = _money(r.get("TGYL_YEAR_BSNS_AMOUNT"))
        parts = [_money(r.get(k)) for k, _ in BOJO_SHARES]
        if not total or abs(total - sum(parts)) > max(1, total // 1000):
            shares.add(None)
            continue
        shares.add(tuple(round(100 * p / total) for p in parts))
    split = ""
    if len(shares) == 1 and None not in shares:
        pct = next(iter(shares))
        named = [f"{name} {p}%" for (_, name), p in zip(BOJO_SHARES, pct) if p]
        own_zero = pct[2] == 0
        text = " ".join(str(first.get(k) or "") for k in BOJO_TEXT_KEYS)
        if len(named) >= 2 and not (own_zero and re.search(r"자부담|자기\s*부담", text)):
            split = ", ".join(named)
    # 네 칸 합이 사업비와 안 맞아 분담을 못 쓰는 공고도 자부담 금액이 있고 비율이 한 가지면 자부담만 쓴다
    own = ""
    if not split:
        ratios = set()
        for r in rows:
            total, paid = _money(r.get("TGYL_YEAR_BSNS_AMOUNT")), _money(r.get("SALM"))
            ratios.add(max(1, round(100 * paid / total)) if total and paid and paid <= total else None)
        own = f"사업비의 약 {next(iter(ratios))}%" if len(ratios) == 1 and None not in ratios else ""
    begin, end = _bsns_day(first.get("BSNS_BEGIN_DE")), _bsns_day(first.get("BSNS_END_DE"))
    return pairs(("사업 예산", budget, "사업 전체 규모"), ("사업비 분담", split), ("자부담", own),
                 ("사업 기간", f"{begin} ~ {end}" if begin and end else ""))


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
        "how": "" if re.fullmatch(r"\s*\d{1,4}\s*", first.get("REQST_RCEPT_MTH_CN") or "")  # '001' 같은 코드값
               else clean_text(first.get("REQST_RCEPT_MTH_CN")), "audience": [AUD_ORG],
        "conditions": bojo_conditions(first, rows),
        "details": pairs(("지원 조건", substantive(first.get("SPORT_CND_CN"))),
                         ("선정 기준", substantive(first.get("SLCTN_STDR_DC"))),
                         ("제출 서류", substantive(first.get("PRESENTN_PAPERS_GUIDANCE_CN"))),
                         ("신청 제외 대상", substantive(first.get("EXCL_TRGET_CN"))),
                         ("결과 발표", substantive(first.get("SLCTN_RESULT_DSPTH_MTH_CN")))),
        "period_text": clean_text(first.get("RCEPT_PD_DC")) or f"{start or ''} ~ {end or ''}",
        "period_type": "기간" if end else "미상", "apply_start": start, "apply_end": end,
        "regions": region_label(found), "region_basis": "수행기관 소재지" if found else "",
        "agri": agri, "agri_basis": agri_basis, "fish": int(fish), "is_private": 0,
        "url": first.get("PBLANC_POPUP_URL") or "", "apply_url": first.get("BSNS_GUIDANCE_URL") or "",
        "contact": "", "files": "", "source_updated": first.get("PBLANC_UPDT_DT") or "",
        "posted": ymd8(first.get("PBLANC_BEGIN_DE")) or start or "", "views": 0,
    })


STATUS_BY_TYPE = {"상시": "상시", "소진시": "소진 시까지", "정기": "매년 정기",
                  "주기": "매월·분기 접수", "신청불필요": "신청 불필요", "사유발생": "사유 발생 후 신청",
                  "기관별": "기관별로 다름", "별도": "확인 필요", "미상": "확인 필요"}


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
