"""0단계 점검: 네 API를 한 페이지씩 불러 인증키와 실제 응답 구조를 확인한다.

실행: python collector/probe.py
결과: data/raw/probe/ 에 원본 응답을 저장하고, 화면에 전체 건수와 첫 항목을 요약한다.
"""
import datetime
import json
import re
import sys

from common import RAW_DIR, get, load_service_key

YEAR = datetime.date.today().year

# (이름, 설명, 주소, 요청 변수) — 규격은 docs/api-specs/ 참고
PROBES = [
    ("bizinfo", "기업마당 지원사업 공고",
     "https://apis.data.go.kr/1421000/bizinfo/pblancBsnsService",
     {"dataType": "json", "pageNo": 1, "numOfRows": 3}),
    ("kstartup", "K-Startup 사업공고",
     "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01",
     {"page": 1, "perPage": 3, "returnType": "json"}),
    ("gov24_list", "보조금24 서비스 목록",
     "https://api.odcloud.kr/api/gov24/v3/serviceList",
     {"page": 1, "perPage": 3, "returnType": "JSON"}),
    ("gov24_cond", "보조금24 지원조건",
     "https://api.odcloud.kr/api/gov24/v3/supportConditions",
     {"page": 1, "perPage": 3, "returnType": "JSON"}),
    ("bojo", "국고보조금 공모사업 상세",
     "https://apis.data.go.kr/1051000/MoefOpenAPI2025/T_OPD_ASBS_PBNS_UNITY",
     {"pageNo": 1, "numOfRows": 3, "resultType": "json", "bsnsyear": YEAR}),
]

HINTS = {
    "SERVICE_KEY_IS_NOT_REGISTERED": "인증키 미등록: 승인 직후면 1~2시간 뒤 다시 시도, 아니면 키 오타 확인",
    "등록되지 않은 인증키": "인증키 미등록: 승인 직후면 1~2시간 뒤 다시 시도, 아니면 키 오타 확인",
    "LIMITED_NUMBER_OF_SERVICE_REQUESTS": "오늘 호출 한도 초과",
    "SERVICE_ACCESS_DENIED": "이 API 활용신청이 안 됐거나 승인 대기",
}


def find_key(obj, name):
    """중첩된 응답에서 이름이 name인 첫 값을 찾는다."""
    if isinstance(obj, dict):
        if name in obj:
            return obj[name]
        for v in obj.values():
            found = find_key(v, name)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = find_key(v, name)
            if found is not None:
                return found
    return None


def find_items(obj):
    """응답에서 항목 목록(딕셔너리의 리스트)을 찾는다. 항목이 하나면 딕셔너리로 오는 API도 있다."""
    if isinstance(obj, list) and obj and all(isinstance(x, dict) for x in obj):
        return obj
    if isinstance(obj, dict):
        if "item" in obj and isinstance(obj["item"], dict):
            return [obj["item"]]
        for k in ("items", "item", "data"):
            if k in obj:
                found = find_items(obj[k])
                if found:
                    return found
        for v in obj.values():
            found = find_items(v)
            if found:
                return found
    return []


def diagnose(status, body):
    for pattern, hint in HINTS.items():
        if pattern in body:
            return hint
    m = re.search(r"<(returnAuthMsg|errMsg|resultMsg)>(.*?)</", body)
    if m:
        return m.group(2)
    return f"HTTP {status}"


def main():
    sys.stdout.reconfigure(errors="replace")
    key = load_service_key()
    out_dir = RAW_DIR / "probe"
    out_dir.mkdir(parents=True, exist_ok=True)

    ok_count = 0
    for name, label, url, params in PROBES:
        status, body = get(url, {"serviceKey": key, **params})
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = None
        (out_dir / f"{name}.{'json' if data is not None else 'txt'}").write_text(body, encoding="utf-8")

        items = find_items(data) if data is not None else []
        result_code = find_key(data, "resultCode") if data is not None else None
        failed = status != 200 or data is None or (result_code not in (None, "00", "0", 0) and not items)
        print(f"\n■ {label} ({name})")
        if failed:
            print(f"  실패 — {diagnose(status, body)}")
            print(f"  응답 앞부분: {body[:200]!r}")
            continue

        ok_count += 1
        print(f"  성공 — 전체 {find_key(data, 'totalCount')}건, 이번 응답 {len(items)}건")
        if items:
            for k, v in items[0].items():
                text = str(v).replace("\n", " ")
                print(f"    {k}: {text[:80]}{'…' if len(text) > 80 else ''}")

    print(f"\n{len(PROBES)}개 중 {ok_count}개 성공. 원본 응답: {out_dir}")


if __name__ == "__main__":
    main()
