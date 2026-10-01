# AGENTS.md

이 저장소에서 일하는 모든 도구(Claude Code, Hermes, OpenClaw, Codex)가 따르는 규칙.

## 작업 위치

- 원본은 GitHub `Dj-Lee2/jiwonmoa`의 main이다. 공공 GitLab(`gov`)은 같은 기록의 사본이다.
- 작업하는 곳: 로컬 클론 또는 서버의 `/srv/jiwonmoa`(같은 저장소가 연결된 운영 폴더).

## 순서

1. 시작 전에 `git pull --ff-only`로 최신 main을 받는다.
2. 고친 뒤 커밋한다. 메시지는 짧은 제목 한 줄로 쓰고 AI 표기(Co-Authored-By 등)는 넣지 않는다.
3. `git push origin main` 다음 `git push gov main`. GitLab은 올릴 때 보안 검사(Semgrep·OSV·Trivy 등)를 하며 걸리면 push 전체가 거부된다.
4. 서버 반영: 로컬에서는 `bash deploy/push.sh`, 서버에서는 `python3 collector/build_site.py`.

## 지키는 것

- `.env`(인증키), `data/`, `site/data/`, `logs/`, `deploy/local.env`는 커밋하지 않는다.
- 서버 IP·계정명 같은 운영 정보를 저장소에 적지 않는다.
- 화면에는 설명 문구를 늘리지 않는다(근거·수집 시각·면책·출처만).
