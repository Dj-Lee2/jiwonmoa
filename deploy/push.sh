#!/usr/bin/env bash
# 로컬에서 고친 코드를 서버(/srv/jiwonmoa)에 반영하고 화면용 자료를 다시 만든다.
# 인증키(.env)·수집 자료(data/)·화면용 자료(site/data/)·기록(logs/)은 서버 것을 그대로 둔다.
#   bash deploy/push.sh            반영
#   bash deploy/push.sh --dry-run  올릴 파일만 보여 준다
# 로컬에서 지운 파일은 서버에서 지워지지 않는다(필요하면 서버에서 직접 지운다).
# 서버 접속 정보는 저장소에 올리지 않는 deploy/local.env에 둔다:
#   HOST=ssh접속별칭   (예: ~/.ssh/config의 Host 이름)
#   DEST=/srv/jiwonmoa
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/local.env ] && . deploy/local.env
HOST="${HOST:?deploy/local.env에 HOST=ssh접속별칭 을 적어 주세요}"
DEST="${DEST:-/srv/jiwonmoa}"

FILES=(README.md .env.example .gitignore collector/*.py deploy/*.sh deploy/README.md docs/api-specs
       site/index.html site/app.js site/style.css site/sound.js site/sound.css site/vendor site/img)
if [ "${1:-}" = "--dry-run" ]; then
  printf '%s\n' "${FILES[@]}"
  exit 0
fi

# 매일 갱신(update.sh)이 도는 중이면 끝날 때까지 기다린 뒤 화면용 자료를 다시 만든다
tar -czf - "${FILES[@]}" | ssh "$HOST" "set -e; cd '$DEST'; tar -xzf -; chmod 755 deploy/*.sh
  find site -type d -exec chmod 755 {} +; find site -type f -exec chmod 644 {} +
  mkdir -p logs; TZ=Asia/Seoul flock -w 900 logs/.update.lock python3 collector/build_site.py"
echo "반영 완료: https://jiwonmoa.orfa.shop"
