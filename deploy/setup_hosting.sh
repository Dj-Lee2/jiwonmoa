#!/usr/bin/env bash
# 지원모아 호스팅 준비. 서버에서 한 번만, root로 실행한다(sudo 또는 root 터미널):
#   OWNER=<서버 사용자> bash /home/<서버 사용자>/jiwonmoa/deploy/setup_hosting.sh
# OWNER는 매일 갱신을 돌릴 일반 사용자. sudo로 실행하면 그 사용자가 기본값이다.
#  1) 프로젝트를 /srv/jiwonmoa에 두고 소유자를 일반 사용자로 한다(매일 갱신이 sudo 없이 자료를 고칠 수 있게).
#  2) Caddy에 사이트 블록을 더하고 설정을 검사한 뒤 다시 읽힌다. 검사에 실패하면 원래 설정으로 되돌린다.
# 다시 실행해도 안전하다(이미 있는 폴더·블록은 그대로 둔다).
set -euo pipefail

DOMAIN="${DOMAIN:-jiwonmoa.orfa.shop}"
OWNER="${OWNER:-${SUDO_USER:-}}"
SRC="${SRC:-/home/$OWNER/jiwonmoa}"
DEST="${DEST:-/srv/jiwonmoa}"
CADDYFILE=/etc/caddy/Caddyfile

[ "$(id -u)" -eq 0 ] || { echo "root로 실행하세요(sudo 또는 root 터미널): bash $0"; exit 1; }
[ -n "$OWNER" ] || { echo "OWNER=<서버 사용자>를 앞에 붙여 실행하세요"; exit 1; }

# 1) 프로젝트 자리와 권한: 웹에 보이는 것은 site/ 뿐. 인증키(.env)와 수집 자료(data/)는 소유자만 읽는다
if [ ! -d "$DEST" ]; then
  [ -d "$SRC" ] || { echo "원본 폴더가 없습니다: $SRC"; exit 1; }
  install -d -o "$OWNER" -g "$OWNER" -m 755 "$DEST"
  cp -a "$SRC"/. "$DEST"/
  echo "복사: $SRC → $DEST"
fi
chown -R "$OWNER":"$OWNER" "$DEST"
chmod 755 "$DEST"
find "$DEST/site" -type d -exec chmod 755 {} +
find "$DEST/site" -type f -exec chmod 644 {} +
[ -f "$DEST/.env" ] && chmod 600 "$DEST/.env"
[ -d "$DEST/data" ] && chmod 700 "$DEST/data"
chmod 755 "$DEST"/deploy/*.sh

# 2) Caddy: 정적 파일 그대로 보여 주기. HTTPS 인증서는 Caddy가 알아서 받는다(DNS가 이 서버를 가리켜야 함)
if grep -qE "^${DOMAIN//./\\.}[[:space:]]*\{" "$CADDYFILE"; then
  echo "Caddy에 $DOMAIN 블록이 이미 있습니다."
else
  BAK="$CADDYFILE.bak-jiwonmoa-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$CADDYFILE" "$BAK"
  cat >> "$CADDYFILE" <<EOF

$DOMAIN {
	encode zstd gzip
	root * $DEST/site
	file_server
	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		X-Frame-Options "DENY"
	}
}
EOF
  if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    cp -a "$BAK" "$CADDYFILE"
    echo "Caddy 설정 검사에 실패해 원래 설정으로 되돌렸습니다."
    exit 1
  fi
  echo "Caddy에 $DOMAIN 추가(백업: $BAK)"
fi
systemctl reload caddy
echo "완료: https://$DOMAIN"
