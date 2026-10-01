#!/usr/bin/env bash
# GitHub main을 서버(/srv/jiwonmoa)에 반영하고 화면용 자료를 다시 만든다.
# 서버 폴더는 GitHub과 연결된 git 저장소다. 먼저 커밋해서 GitHub에 올린 뒤 실행한다.
# 인증키(.env)·수집 자료(data/)·화면용 자료(site/data/)·기록(logs/)은 git에서 제외되어 그대로 남는다.
#   bash deploy/push.sh
# 서버 접속 정보는 저장소에 올리지 않는 deploy/local.env에 둔다:
#   HOST=ssh접속별칭   (예: ~/.ssh/config의 Host 이름)
#   DEST=/srv/jiwonmoa
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/local.env ] && . deploy/local.env
HOST="${HOST:?deploy/local.env에 HOST=ssh접속별칭 을 적어 주세요}"
DEST="${DEST:-/srv/jiwonmoa}"

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "커밋하지 않은 변경이 있습니다." >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "GitHub main과 다릅니다. 먼저 push하세요." >&2; exit 1; }

# 매일 갱신(update.sh)이 도는 중이면 끝날 때까지 기다린 뒤 화면용 자료를 다시 만든다
ssh "$HOST" "set -e; cd '$DEST'; git pull -q --ff-only origin main
  mkdir -p logs; TZ=Asia/Seoul flock -w 900 logs/.update.lock python3 collector/build_site.py"
echo "반영 완료: https://jiwonmoa.orfa.shop"
