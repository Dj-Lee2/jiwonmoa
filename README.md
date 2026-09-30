# 지원모아

정부·지자체·공공기관의 지원사업 공고와 상시 지원제도를 한곳에 모아, 지역과 대상(청년·어르신·농업인·소상공인 등)으로 찾아보는 웹 서비스.

## 구성

```
collector/        공공 API 수집 → SQLite 정리 → 화면용 자료 생성 (Python 표준 라이브러리만 사용)
site/             정적 웹 화면 (HTML·CSS·JS, 빌드 도구 없음)
  vendor/         대한민국 지도 SVG
deploy/           서버 운영: 호스팅 준비(setup_hosting.sh), 매일 갱신(update.sh), 안내(README.md)
docs/api-specs/   API 규격(Swagger) 원본
```

## 준비

1. Python 3.9 이상
2. [공공데이터포털](https://www.data.go.kr)에서 아래 '자료 출처'의 API 4개를 활용 신청하고 일반 인증키를 받는다.
3. `.env.example`을 `.env`로 복사하고 `DATA_GO_KR_KEY`에 인증키를 넣는다. `.env`는 저장소에 올리지 않는다.

## 실행

```
python collector/probe.py                 # API 연결 점검(출처별 3건)
python collector/collect.py               # 전체 수집 → data/hub.db (약 5~10분, 국고보조금이 대부분)
python collector/collect.py --reprocess   # 판정 규칙만 고쳤을 때: 새로 받지 않고 다시 정리
python collector/build_site.py            # 화면용 자료 site/data/ 생성
python collector/report.py                # (선택) 점검 보고서 reports/ + 엑셀용 CSV data/export/
```

`site/index.html`을 브라우저로 열면 된다(서버 불필요). 주소 공유·뒤로 가기까지 확인하려면:

```
python -m http.server 8765 --directory site   # http://127.0.0.1:8765
```

수집 자료(`data/`)와 화면용 자료(`site/data/`)는 저장소에 넣지 않는다. 위 순서로 다시 만든다.

## 화면

- 탭: 홈 / 지금 모집 중(공고) / 상시 지원제도(보조금24)
- 조건: 누구를 위한 지원(11가지), 지역(전국 대상 포함 여부), 신청 상태, 출처. 상시 제도는 분야·지원 방식도 고를 수 있다.
  농업인을 고르면 농업 세부 분야 칩이 나온다. 조건은 주소(#)에 담겨 링크로 공유된다.
- 홈
  - 숫자 타일, 나에게 맞는 지원 찾기(대상 칩)
  - 그래프 6개: 대상별 공고·제도 수, 지역 지도(공고 | 제도), 마감까지 남은 기간, 공모가 열린 달(작년·올해),
    상시 제도 분야 | 지원 방식, 곧 열릴 수 있는 공모(작년 이맘때 열린 국고보조 공모)
  - 목록 3개: 마감이 가까운 사업, 새로 올라온 공고(최근 7일), 많이 찾는 지원사업(누적 조회수)
  - 홈에서 고른 지역이 모든 숫자와 그래프에 적용된다.
- 그래프 색: 파랑 = 모집 공고, 초록 = 상시 제도, 회색 = 비교 대상·나머지
- 그래프 움직임: 화면에 처음 들어올 때 막대가 자라나고 선이 그려진다. 지역·전환 단추로 바뀐 그래프만 다시 움직인다.
  가리키면 나머지 막대가 옅어진다. 운영체제의 '움직임 줄이기' 설정이면 움직이지 않는다(`app.js`의 `setupMotion`).
- 날짜 없는 공고('예산 소진 시까지', '상시')에는 마감일을 만들지 않는다.

## 규칙이 있는 곳

| 내용 | 위치 |
|---|---|
| 지역·농업·대상(personas)·지원 방식 판정 | `collector/normalize.py` |
| 농업 세부 분야 칩 | `collector/build_site.py`의 `AGRI_TOPICS` |
| 홈 집계(지역·대상별 건수, 공모 달, 많이 찾는 제도) | `collector/build_site.py`의 `service_counts`, `open_months`, `top_services` |
| 곧 열릴 수 있는 공모(같은 사업 묶기) | `collector/build_site.py`의 `upcoming_calls`, `program_key` |
| 화면 동작·그래프 | `site/app.js` |

## 자료 출처

| 출처 (공공데이터포털 번호) | 내용 | 비고 |
|---|---|---|
| 중소벤처기업부 기업마당 (15157820) | 중소기업 지원사업 공고 | 게시 중인 공고만 제공. 공공누리 제3유형(출처표시·변경금지) |
| 창업진흥원 K-Startup (15125364) | 창업 지원사업 공고 | 모집 중만 수집. 민간 주관 공고 포함 |
| 행정안전부 보조금24 (15113968) | 중앙·지자체 공공서비스(제도) | 지원조건 코드 포함 |
| 기획예산처 국고보조금 공모 (15156853) | 국고보조사업 공모 공고 | 작년·올해·내년 사업연도, 공고 단위로 묶음 |

지도: [svg-maps South Korea](https://github.com/VictorCazanave/svg-maps/tree/master/packages/south-korea)
(Victor Cazanave, 원본 [MapSVG](https://mapsvg.com/maps/south-korea)), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 광주·전남을 한 지역으로 합쳐 표시한다.
