#!/usr/bin/env bash
# 지원모아 정기 점검(하루 두 번, 수집 30분 뒤). 매일 갱신(update.sh)이 아직 돌고 있으면 끝날 때까지 기다린다.
# 정상이면 아무것도 출력하지 않고, 이상·올리기 실패만 출력한다(예약 작업이 출력을 알림으로 보낸다).
# CHECK_REPORT=1이면 정상일 때도 한 줄 결과를 출력한다(Hermes 예약 작업은 이 값으로 불러 결과를 늘 알린다).
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
export TZ=Asia/Seoul
mkdir -p logs
exec 9>logs/.update.lock
if ! flock -w 1500 9; then
  echo "⚠️ 지원모아 점검: 매일 갱신이 25분 넘게 끝나지 않아 점검을 건너뜀"
  exit 0
fi
/usr/bin/python3 deploy/check.py 2>&1
