#!/usr/bin/env bash
# 화면 코드 줄이기: 원본(site/app.js·style.css, 고치는 곳) → 줄인 것(site/app.min.js·style.min.css, index.html이 읽는 것)
# app.js나 style.css를 고치면 반드시 이 파일을 실행하고 줄인 것도 함께 커밋한다. 첫 줄에 원본의 sha256이 적혀
# 테스트(test_min_assets_fresh)가 원본과 어긋나면 실패한다. 전송량: app 71→40KB, style 24→14KB(gzip)
#   bash deploy/build_assets.sh
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
ESBUILD_VERSION=0.28.2
if [ -z "${ESBUILD:-}" ]; then
  ESBUILD=$(ls -d "$HOME"/.npm/_npx/*/node_modules/.bin/esbuild 2>/dev/null | head -1 || true)
fi
if [ -z "$ESBUILD" ] || [ ! -x "$ESBUILD" ]; then
  ESBUILD="npx --yes esbuild@$ESBUILD_VERSION"
fi
build() { # 원본 줄인것 형식
  local src="site/$1" out="site/$2" kind="$3" hash
  hash=$(sha256sum "$src" | cut -d' ' -f1)
  $ESBUILD "$src" --minify --target=es2017 --legal-comments=none --log-level=warning \
    "--banner:$kind=/* $1 sha256:$hash — 고치지 말고 deploy/build_assets.sh로 다시 만든다 */" --outfile="$out"
  printf '%s → %s %s바이트\n' "$src" "$out" "$(stat -c %s "$out")"
}
build app.js app.min.js js
build style.css style.min.css css
