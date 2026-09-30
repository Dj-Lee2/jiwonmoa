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

## 매일 갱신(예약 작업)

`/srv/jiwonmoa/deploy/update.sh`를 하루 한 번 실행한다. sudo는 필요 없다.

- 권장 시각: 매일 06:30 한국 시간. 서버 시간대가 UTC이므로 crontab에는 21:30으로 적는다.

  ```
  30 21 * * * /srv/jiwonmoa/deploy/update.sh
  ```

- 한 번에 5~10분 걸린다. 앞선 실행이 끝나지 않았으면 다음 실행은 건너뛴다.
- 한국 시간 처리는 스크립트 안에서 한다(`TZ=Asia/Seoul`).
- 기록: `/srv/jiwonmoa/logs/update.log`. 출처 하나가 실패해도 나머지로 화면을 만들고, 화면 목록 아래에 '수집 실패'가 표시된다.
- 공공데이터포털 개발계정은 API마다 하루 10,000건 한도다. 하루 한 번 수집은 한도보다 훨씬 적다.

## 코드 고친 뒤

로컬(Windows의 Git Bash)에서 `bash deploy/push.sh`를 실행한다. 서버 접속 별칭은 `deploy/local.env`(저장소에 올리지 않음)에 `HOST=별칭`으로 적어 둔다. 고친 코드만 서버에 덮어쓰고 화면용 자료를 다시 만든다.
`.env`, `data/`, `site/data/`, `logs/`는 서버의 것을 그대로 둔다. `--dry-run`을 붙이면 올릴 파일만 보여 준다.
