"""출처별 전체 수집. 각 fetch 함수는 (원본 항목 리스트, 출처가 밝힌 전체 건수)를 돌려준다.

규격: docs/api-specs/ — 호출 한도는 출처별 개발계정 하루 10,000건.
"""
import datetime
import json

from common import get

BIZINFO_URL = "https://apis.data.go.kr/1421000/bizinfo/pblancBsnsService"
KSTARTUP_URL = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01"
GOV24_LIST_URL = "https://api.odcloud.kr/api/gov24/v3/serviceList"
GOV24_COND_URL = "https://api.odcloud.kr/api/gov24/v3/supportConditions"
BOJO_URL = "https://apis.data.go.kr/1051000/MoefOpenAPI2025/T_OPD_ASBS_PBNS_UNITY"

MAX_PAGES = 100  # 규격이 바뀌어 페이지가 끝없이 이어지는 경우를 막는다


class FetchError(RuntimeError):
    pass


def _load(status, body, source):
    if status != 200:
        raise FetchError(f"{source}: HTTP {status} {body[:200]}")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        raise FetchError(f"{source}: JSON이 아닌 응답 {body[:200]}")


def _uncdata(value):
    """국고보조금 API는 값을 <![CDATA[...]]>로 감싸서 준다."""
    if isinstance(value, str) and value.startswith("<![CDATA[") and value.endswith("]]>"):
        return value[9:-3]
    return value


def _paged_datago(url, params, source, rows):
    """apis.data.go.kr 형식(response.header/body.items.item) 페이지 반복."""
    items, total = [], 0
    for page in range(1, MAX_PAGES + 1):
        d = _load(*get(url, {**params, "pageNo": page, "numOfRows": rows}), source)
        d = d.get("response", d)
        code = (d.get("header") or {}).get("resultCode")
        if code not in (None, "00", "0"):
            raise FetchError(f"{source}: resultCode {code} {(d.get('header') or {}).get('resultMsg')}")
        body = d.get("body") or {}
        got = (body.get("items") or {}).get("item") or []
        if isinstance(got, dict):
            got = [got]
        items += got
        total = int(body.get("totalCount") or 0)
        if not got or len(items) >= total:
            break
    return items, total


def _paged_odcloud(url, params, source, per_page):
    """odcloud 형식(page/perPage/matchCount/data) 페이지 반복."""
    items, total = [], 0
    for page in range(1, MAX_PAGES + 1):
        d = _load(*get(url, {**params, "page": page, "perPage": per_page}), source)
        got = d.get("data") or []
        if isinstance(got, dict):
            got = got.get("data") or []
        items += got
        total = int(d.get("matchCount") or d.get("totalCount") or 0)
        if not got or len(items) >= total:
            break
    return items, total


def fetch_bizinfo(key):
    return _paged_datago(BIZINFO_URL, {"serviceKey": key, "dataType": "json"}, "bizinfo", 500)


def fetch_kstartup(key):
    """모집 중인 공고만 받는다. 전체(3만 건 이상)는 지난 공고 이력이다."""
    params = {"serviceKey": key, "returnType": "json", "cond[rcrt_prgs_yn::EQ]": "Y"}
    return _paged_odcloud(KSTARTUP_URL, params, "kstartup", 500)


def fetch_gov24(key):
    """서비스 목록에 지원조건(JA 코드)을 서비스ID로 붙인다."""
    base = {"serviceKey": key, "returnType": "JSON"}
    services, total = _paged_odcloud(GOV24_LIST_URL, base, "gov24", 1000)
    conds, _ = _paged_odcloud(GOV24_COND_URL, base, "gov24_cond", 1000)
    by_id = {c.get("서비스ID"): c for c in conds}
    for s in services:
        s["_지원조건"] = by_id.get(s.get("서비스ID"))
    return services, total


def fetch_bojo(key):
    """공고명이 있는 행(실제 공모 공고)만 받는다. 전체 20만여 건 대부분은 사업 구조 정보다.

    연말에는 다음 연도 공고가 올라오므로 내년 것도 받고, '곧 열릴 수 있는 공모'(작년 이맘때 열린 공모)와
    '공모는 언제 열리나요?' 그래프를 위해 작년 것도 받는다.
    """
    year = datetime.date.today().year
    items, total = [], 0
    for y in (year - 1, year, year + 1):
        params = {"serviceKey": key, "resultType": "json", "bsnsyear": y, "pblanc_nm": "%"}
        got, t = _paged_datago(BOJO_URL, params, "bojo", 1000)
        items += [{k: _uncdata(v) for k, v in row.items()} for row in got]
        total += t
    return items, total


SOURCES = {
    "bizinfo": fetch_bizinfo,
    "kstartup": fetch_kstartup,
    "gov24": fetch_gov24,
    "bojo": fetch_bojo,
}
