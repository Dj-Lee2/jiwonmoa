#!/usr/bin/env bash
# 지원모아 매일 갱신: 공공 API 수집 → 화면용 자료 다시 만들기. 예약 작업이 이 파일만 실행하면 된다(sudo 불필요).
#   예) 매일 09:00·16:00 한국 시간. 서버 시간대가 UTC라면 crontab에:  0 0,7 * * * /srv/jiwonmoa/deploy/update.sh
# 마감·신규 날짜 계산은 한국 시간이어야 하므로 TZ를 여기서 정한다. 기록: logs/update.log
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
export TZ=Asia/Seoul
mkdir -p logs

# 기록이 1MB를 넘으면 하나만 남기고 넘긴다
if [ -f logs/update.log ] && [ "$(stat -c %s logs/update.log)" -gt 1048576 ]; then
  mv -f logs/update.log logs/update.log.1
fi

# 앞선 실행이 아직 돌고 있으면 건너뛴다
exec 9>logs/.update.lock
if ! flock -n 9; then
  echo "$(date '+%F %T %Z') 앞선 갱신이 아직 실행 중이라 건너뜀" >> logs/update.log
  exit 0
fi

{
  echo "=== $(date '+%F %T %Z') 수집 시작"
  # 한 출처가 실패해도 나머지로 화면을 만든다(화면 목록 아래에 '수집 실패'가 표시된다)
  python3 collector/collect.py || echo "!!! 수집 중 오류(종료 코드 $?). 받은 자료로 화면을 만든다"
  if python3 collector/build_site.py; then
    echo "=== $(date '+%F %T %Z') 끝"
  else
    echo "!!! 화면 자료 생성 실패 — 이전 화면이 그대로 남아 있다"
    exit 1
  fi
} >> logs/update.log 2>&1
