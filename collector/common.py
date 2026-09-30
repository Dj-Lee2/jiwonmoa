"""공공데이터 API 호출 공통 도구."""
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
KEY_PLACEHOLDER = "여기에"

# https만 여는 요청기. 기본 urlopen과 달리 file:// 같은 다른 방식은 처리하지 않는다.
_OPENER = urllib.request.OpenerDirector()
for _handler in (urllib.request.HTTPSHandler, urllib.request.HTTPDefaultErrorHandler,
                 urllib.request.HTTPRedirectHandler, urllib.request.HTTPErrorProcessor,
                 urllib.request.UnknownHandler):
    _OPENER.add_handler(_handler())


def load_service_key():
    """.env의 DATA_GO_KR_KEY를 읽는다. 인코딩 키를 넣어도 동작하도록 한 번 디코딩한다."""
    key = os.environ.get("DATA_GO_KR_KEY", "")
    env_path = ROOT / ".env"
    if not key and env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("DATA_GO_KR_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key or key.startswith(KEY_PLACEHOLDER):
        raise SystemExit(".env 파일의 DATA_GO_KR_KEY에 공공데이터포털 일반 인증키를 넣어 주세요.")
    return urllib.parse.unquote(key)


def get(url, params, retries=3, timeout=30):
    """GET 요청 후 (HTTP 상태, 본문)을 돌려준다. 서버 오류·연결 오류만 재시도한다.

    인증키가 주소에 들어가므로 요청 주소는 출력하지 않는다.
    """
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("https 주소만 요청합니다.")
    full = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full, headers={"User-Agent": "support-hub-collector/0.1"})
    last = (0, "")
    for attempt in range(retries):
        try:
            with _OPENER.open(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code < 500:
                return e.code, body
            last = (e.code, body)
        except (urllib.error.URLError, TimeoutError) as e:
            last = (0, str(e))
        time.sleep(2 * (attempt + 1))
    return last
