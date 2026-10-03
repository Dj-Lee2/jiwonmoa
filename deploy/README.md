# 지원모아 서버 운영

| 항목 | 값 |
|---|---|
| 주소 | https://jiwonmoa.orfa.shop |
| 위치 | `/srv/jiwonmoa` (소유자는 매일 갱신을 돌리는 일반 사용자) |
| 웹 서버 | Caddy가 `/srv/jiwonmoa/site`를 정적 파일로 보여 준다. HTTPS 인증서 자동 |
| 인증키 | `/srv/jiwonmoa/.env`의 `DATA_GO_KR_KEY` (소유자만 읽기) |

## 처음 한 번

1. 도메인 DNS에 A 레코드 추가: 호스트 `jiwonmoa`, 값 = 서버 IP
2. 프로젝트를 `~/jiwonmoa`에 올린 뒤 root로 `OWNER=<서버 사용자> bash /home/<서버 사용자>/jiwonmoa/deploy/setup_hosting.sh`.
   `/srv/jiwonmoa`로 옮기고 Caddy에 사이트를 더한다

보안 헤더(HSTS·Permissions-Policy·CSP)도 이 스크립트가 넣는다. CSP에는 `site/index.html` 첫 화면 인라인 스크립트의
sha256이 들어 있어, 그 스크립트를 고치면 `setup_hosting.sh`와 운영 `/etc/caddy/Caddyfile` 두 곳의 값을 바꾸고
`sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy`로 다시 읽힌다.
값은 `python3 -c "import sys; sys.path.insert(0,'deploy'); import check; print(check.inline_script_hash())"`로 구한다.

## 매일 갱신(예약 작업)

`/srv/jiwonmoa/deploy/update.sh`를 하루 두 번 실행한다. sudo는 필요 없다.

- 시각: 매일 09:00·16:00 한국 시간(하루 두 번). 서버 시간대가 UTC이므로 crontab에는 `0 0,7 * * *`로 적는다.

  ```
  0 0,7 * * * /srv/jiwonmoa/deploy/update.sh
  ```

- 한 번에 5~10분 걸린다. 앞선 실행이 끝나지 않았으면 다음 실행은 건너뛴다.
- 한국 시간 처리는 스크립트 안에서 한다(`TZ=Asia/Seoul`).
- 기록: `/srv/jiwonmoa/logs/update.log`. 출처 하나가 실패해도 나머지로 화면을 만들고, 화면 목록 아래에 '수집 실패'가 표시된다.
- 공공데이터포털 개발계정은 API마다 하루 10,000건 한도다. 하루 한 번 수집은 한도보다 훨씬 적다.

## 코드 고친 뒤

서버 폴더 `/srv/jiwonmoa`는 GitHub과 연결된 git 저장소다. 커밋해서 GitHub에 올린 뒤 로컬(Windows의 Git Bash)에서 `bash deploy/push.sh`를 실행하면 서버가 GitHub main을 받아(`git pull`) 화면용 자료를 다시 만든다. 서버에서 직접 고쳤다면 서버에서 커밋·push한 뒤 `python3 collector/build_site.py`를 실행한다.
서버 접속 별칭은 `deploy/local.env`(저장소에 올리지 않음)에 `HOST=별칭`으로 적어 둔다. `.env`, `data/`, `site/data/`, `logs/`는 git에서 제외되어 서버의 것이 그대로 남는다.
