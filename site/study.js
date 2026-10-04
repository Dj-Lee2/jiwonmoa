/* 지원모아 공부 모드(PC만): 화면 각 영역에 이름·하는 일·코드 이름을 툴팁으로 보여 준다.
 * 머리의 '공부 모드' 단추(#studyToggle, app.js)를 처음 누를 때 이 파일과 study.css를 읽는다(첫 화면 무게에 넣지 않음).
 * 사이트 화면은 건드리지 않고 위에 덧씌운다. 켜고 끄기는 window.HUB_STUDY.start()·stop(), 끄면 onchange(false)로 알린다.
 * 항목: sel(CSS 선택자), test(추가 조건, 선택), name(화면 이름), code(코드에서 찾을 이름), desc(설명), group(용어집 묶음),
 *       big(이름표 모두 보기에 띄울 큰 영역), go(용어집에서 눌렀을 때 갈 화면 주소) */
(function () {
  "use strict";

  function statIs(label) {
    return function (el) {
      var l = el.querySelector(".stat-label");
      return !!l && l.textContent.indexOf(label) >= 0;
    };
  }
  var HOME = "#tab=home", OPEN = "#tab=open", SVC = "#tab=services";
  var DETAIL = "#tab=open&id=bizinfo%3APBLN_000000000117059";

  var E = [
    // ---------- 모든 화면 공통 ----------
    { group: "공통", big: true, sel: "#siteNote", name: "맨 위 안내 띠", code: "#siteNote (index.html)",
      desc: "이 사이트가 정부 공식 사이트가 아니라 공공데이터로 만든 개인 학습용 사이트라는 것을 알리는 회색 띠입니다. '자세히'를 누르면 이용 안내 창이 열립니다." },
    { group: "공통", sel: ".brand", name: "사이트 이름(마스코트)", code: ".brand · #homeLink",
      desc: "지원모아 이름과 움직이는 마스코트입니다. 누르면 어디에 있든 홈 맨 위로 갑니다. 휴대폰에서는 공간을 아끼려고 이 줄을 접습니다." },
    { group: "공통", sel: "#topHint", name: "그래프 안내 문구", code: "#topHint",
      desc: "홈에서만 보이는 짧은 안내입니다. 그래프의 막대·칸·지역을 누르면 요약 창이 뜬다는 것을 알려 줍니다." },
    { group: "공통", sel: "#soundToggle", name: "버튼 소리 켬/끔", code: "#soundToggle (sound.js)",
      desc: "단추를 누를 때 나는 작은 소리를 켜고 끕니다. 고른 값은 이 기기 브라우저에만 기억됩니다." },
    { group: "공통", sel: "#studyToggle", name: "공부 모드", code: "#studyToggle · study.js",
      desc: "지금 켜 둔 이 기능입니다(PC에서만 보임). 화면 각 영역의 이름과 하는 일을 보여 줍니다. 아래 검은 띠에서 가리키면/누르면 설명, 이름표 모두, 용어집을 고르고 '끄기'로 끕니다." },
    { group: "공통", sel: "#fontToggle", name: "글자 크게", code: "#fontToggle · applyFont()",
      desc: "화면 전체 글자를 키웁니다. 글자가 커지면 탭 이름·타일 이름이 칸에 맞게 자동으로 줄어듭니다(fitTabs, fitStatLabels)." },
    { group: "공통", big: true, sel: "nav.tabs", name: "탭 줄", code: ".tabs · switchTab()",
      desc: "홈 / 모집 공고 / 공공서비스 세 화면을 오갑니다. 스크롤해도 화면 위에 붙어 있고, 머리의 단추(소리·글자)가 화면 밖으로 나가면 탭 줄 오른쪽으로 내려옵니다. 고른 탭이 젤리처럼 살짝 부풉니다." },
    { group: "공통", sel: "#tab-home", name: "홈 탭", code: "#tab-home",
      desc: "숫자 타일·그래프·목록 카드로 지금 상황을 한눈에 보는 첫 화면입니다." },
    { group: "공통", sel: "#tab-open", name: "모집 공고 탭", code: "#tab-open (주소 tab=open)",
      desc: "기관이 지원받을 사람·기업을 뽑으려고 낸 공고 목록입니다. 출처는 기업마당·K-Startup·국고보조금(보조금 통합포털). 색은 파랑. 옆 숫자는 지금 신청할 수 있는 건수입니다." },
    { group: "공통", sel: "#tab-services", name: "공공서비스 탭", code: "#tab-services (주소 tab=services)",
      desc: "보조금24에 등록된 정부·지자체·공공기관 서비스(수당·감면·이용권·상담 등) 목록입니다. 색은 초록. 약 1만 건이라 이 탭을 처음 열 때 자료(services.js, 약 5MB)를 받습니다." },
    { group: "공통", big: true, sel: "footer.foot", name: "맨 아래(하단)", code: "footer.foot",
      desc: "사이트 이름·마지막 수집 시각, 이용 안내·개인정보 안내, 원문 사이트 알약, 자료 출처(공공누리 표시), 지도 출처, 저작권 줄이 있습니다." },
    { group: "공통", sel: ".foot-menu", name: "이용 안내 · 개인정보 안내", code: ".foot-menu · openInfo()",
      desc: "누르면 가운데 창(#infoDialog)으로 무엇을 모으는지, 용어 뜻, 찾는 방법, 개인정보를 어떻게 다루는지(서버에 방문 기록을 남기지 않음 등)를 보여 줍니다." },
    { group: "공통", sel: ".foot-links", name: "원문 사이트 알약", code: ".foot-links",
      desc: "공고 원문이 있는 사이트(기업마당·K-Startup·보조금24·보조금 통합포털·보탬e·농업e지)로 가는 바로가기입니다." },
    { group: "공통", sel: ".foot-bottom", name: "자료 출처 · 저작권", code: ".foot-bottom",
      desc: "공공데이터포털의 어떤 자료를 썼는지와 공공누리 조건, 지도 그림의 출처(CC BY 4.0)를 적은 곳입니다. 공공누리 조건 때문에 지우면 안 됩니다." },
    { group: "공통", sel: "#toTop", name: "맨 위로 단추", code: "#toTop",
      desc: "아래로 많이 내려가면 화면 오른쪽 아래에 떠서, 누르면 맨 위로 올라갑니다. 맨 아래 줄이 보이면 숨습니다." },
    { group: "공통", sel: ".peek.modal", name: "가운데 요약 창", code: ".peek.modal · openPeek(…, \"modal\")",
      desc: "숫자 타일을 누르면 화면 가운데에 뜨는 요약 창입니다. 뒤는 어두워지고, X·바깥·Esc로 닫습니다. '7일 안에 마감'·'내 조건에 맞음'은 모집 공고와 공공서비스 두 장으로 나눠 보여 줍니다." },
    { group: "공통", sel: ".peek.sheet", name: "아래 요약 시트(휴대폰)", code: ".peek.sheet",
      desc: "휴대폰에서 그래프·타일을 누르면 아래에서 올라오는 요약 시트입니다. 휴대폰 '뒤로 가기'를 누르면 시트만 닫힙니다." },
    { group: "공통", sel: ".peek", name: "그래프 요약 창", code: ".peek · openPeek() · placePeek()",
      desc: "그래프의 막대·칸·지역을 누르면 바로 목록으로 가지 않고 먼저 뜨는 작은 창입니다. 건수, 분야·대상·지역 상위 3개, 많이 본 3건, 'N건 모두 보기'가 있습니다. 누른 곳의 오른쪽에 먼저 놓입니다." },
    { group: "공통", sel: ".peek-groups", name: "요약 묶음(분야·대상·지역)", code: ".peek-groups",
      desc: "요약 창 안에서 이 묶음이 어떤 분야·대상·지역에 많은지 상위 3개를 보여 줍니다. 카드가 이미 나눈 기준(예: 대상 막대를 눌렀으면 대상)은 빼고 보여 줍니다." },
    { group: "공통", sel: ".peek-items", name: "많이 본 3건", code: ".peek-items",
      desc: "요약 창의 대표 3건입니다. 조회수가 있으면 많이 본 순, 없으면 마감이 가까운 순입니다. 누르면 그 상세로 갑니다." },
    { group: "공통", sel: ".peek-more", name: "모두 보기 단추", code: ".peek-more",
      desc: "요약 창의 조건 그대로 목록 화면으로 갑니다(주소에 조건이 담김)." },
    { group: "공통", sel: "#vizTip", name: "그래프 툴팁", code: "#vizTip · tipFor()",
      desc: "그래프 위에 마우스를 올리면 뜨는 작은 숫자 상자입니다(누르지 않아도 보임)." },
    { group: "공통", sel: "#infoDialog", name: "안내 창", code: "#infoDialog · INFO",
      desc: "이용 안내·개인정보 안내 내용을 보여 주는 가운데 창입니다." },

    // ---------- 홈 ----------
    { group: "홈", go: HOME, sel: ".home-hero", name: "첫 줄(제목·검색)", code: ".home-hero · renderHome()",
      desc: "홈 맨 위 영역입니다. 큰 제목, 수집 시각, 오늘 단추 두 개, 검색·지역 고르기가 있습니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeTitle", name: "큰 제목", code: "#homeTitle",
      desc: "지금 신청할 수 있는 모집 공고 수입니다. 마감된 것만 빼고 셉니다(접수 예정·예산 소진 시까지·상시 포함). 지역을 고르면 'OO에서 …'로 바뀝니다. 공공서비스는 따로 셉니다." },
    { group: "홈", go: HOME, sel: "#homeSub", name: "수집 시각 줄", code: "#homeSub",
      desc: "마지막으로 공공데이터를 모은 시각입니다. 매일 오전 9시·오후 4시에 새로 모읍니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeTodayNew", name: "오늘(어제) 올라온 공고", code: "#homeTodayNew · isTodayNew()",
      desc: "출처 사이트에 게시된 날(pd)이 마지막 수집일인 모집 공고 수입니다. 오전 9시 수집 전에는 '어제'로 셉니다. 0건이면 회색이고 눌리지 않습니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeTodayDue", name: "오늘 마감인 지원사업", code: "#homeTodayDue",
      desc: "오늘이 마감일인 접수 중 지원사업 수입니다. 마감일이 있는 공공서비스도 함께 셉니다. 누르면 건수가 많은 쪽 탭 목록으로 갑니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeSearch", name: "검색 상자", code: "#homeSearch · #homeQ",
      desc: "'스마트팜'·'청년'처럼 낱말로 찾습니다. 제목·기관·분야·개요·대상 글에서 찾고, 낱말을 띄어 쓰면 모두 들어간 것만 나옵니다. 누르면 모집 공고 목록으로 갑니다." },
    { group: "홈", go: HOME, sel: ".hero-search .region-field", name: "지역 고르기", code: "#homeRegion",
      desc: "지역을 고르면 홈의 모든 숫자·그래프·목록이 그 지역 기준으로 바뀝니다. 16개 시도(광주·전남은 하나)." },
    { group: "홈", go: HOME, sel: ".hero-search .check.national", name: "전국 대상 포함", code: "#homeNat",
      desc: "지역을 골랐을 때만 보입니다. 켜면 그 지역 것 + 전국 누구나 신청할 수 있는 것을 같이 셉니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeFavBlock", name: "관심 담은 지원사업", code: "#homeFavBlock · renderFavs()",
      desc: "상세 화면에서 '관심 담기'를 누른 것이 모입니다(이 기기에만 저장, localStorage hub-fav). 마감이 가까운 순이고, 담은 뒤 마감일이 바뀌면 배지로 알려 줍니다. 담은 게 없으면 숨습니다." },
    { group: "홈", go: HOME, sel: "#homeStats", name: "숫자 타일 줄", code: "#homeStats · statTile()",
      desc: "지금 상황을 숫자 6개로 보여 줍니다. 타일을 누르면 가운데 요약 창이 뜹니다. 넓은 화면은 한 줄 6칸, 중간은 3칸×2줄, 휴대폰은 2칸×3줄." },
    { group: "홈", go: HOME, big: true, sel: "#homeStats > .stat", test: statIs("7일 안"), name: "타일: 7일 안에 마감", code: "statTile(\"7일 안에 마감\")",
      desc: "오늘부터 7일 안에 마감하는 접수 중 지원사업 수입니다(모집 공고 + 마감일 있는 공공서비스). 기준은 '마감일 있는 지원사업'(공고 750 + 서비스 151 = 약 900)이라 1,700이 아닙니다. 누르면 두 장 요약." },
    { group: "홈", go: HOME, big: true, sel: "#homeStats > .stat", test: statIs("접수 예정"), name: "타일: 접수 예정", code: "statTile(\"접수 예정\") · starts=later",
      desc: "아직 접수 전인 모집 공고 중 8일 뒤부터 시작하는 것입니다. 7일 안에 시작하는 것은 맨 아래 '곧 접수가 시작되는 공고'에 있어서 두 곳에 겹쳐 나오지 않게 뺐습니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeStats > .stat", test: statIs("예산 소진"), name: "타일: 예산 소진 시까지", code: "statTile(\"예산 소진 시까지\")",
      desc: "마감일 없이 예산이 다 쓰이면 끝나는 모집 공고입니다. 모집 공고의 거의 절반이 이 방식입니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeStats > .stat", test: statIs("상시"), name: "타일: 상시 접수", code: "statTile(\"상시 접수\") · st=상시",
      desc: "마감일 없이 늘 신청을 받는 모집 공고입니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeStats > .stat", test: statIs("서비스"), name: "타일: 공공서비스", code: "statTile(\"공공서비스\") · META.svc",
      desc: "보조금24 공공서비스 수입니다. 홈이 무거워지지 않게 build_site.py가 지역별 건수를 미리 세어 둔 값(meta.js)을 씁니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeStats > .stat", test: statIs("내 조건"), name: "타일: 내 조건에 맞음", code: "meTile() · data/me.js",
      desc: "나이·소득·성별을 넣으면, 그 조건이 '적혀 있고' 내 조건과 맞는 지원사업 수를 셉니다(조건 없는 사업은 누구나라 빼고 셈). 넣은 값은 이 기기에만 저장. 조건이 없으면 '입력'으로 보이고 누르면 입력 창이 뜹니다." },
    { group: "홈", go: HOME, sel: ".stat-num", name: "타일의 큰 숫자", code: ".stat-num",
      desc: "그 타일이 세는 건수입니다." },
    { group: "홈", go: HOME, sel: ".stat-label", name: "타일 이름", code: ".stat-label · STAT_SHORT",
      desc: "타일이 무엇을 세는지. 칸이 좁으면 화살표를 숨기고, 그래도 모자라면 '예산 소진'처럼 줄인 이름으로 바뀝니다(화면 읽기는 늘 전체 이름)." },
    { group: "홈", go: HOME, sel: ".stat-of", name: "타일 기준 줄", code: ".stat-of · OF_SHORT",
      desc: "'무엇 N건 중 · %'. 큰 숫자가 어떤 전체 가운데 몇 %인지 보여 줍니다. 칸이 모자라면 줄인 이름 → % 숨김 순으로 줄어듭니다." },
    { group: "홈", go: HOME, sel: ".stat-ticks", name: "타일 눈금 막대", code: ".stat-ticks",
      desc: "40칸 중 칠한 칸 = 기준 줄의 % 입니다. 처음 홈을 그릴 때만 자라나는 움직임이 있습니다." },
    { group: "홈", go: HOME, big: true, sel: ".who-card", name: "나에게 맞는 지원 찾기", code: ".who-card · #homeWho",
      desc: "청년·농업인·소상공인 등 18가지 대상 칩입니다. 칩 숫자는 공고 + 공공서비스 합계이고, 누르면 그 대상이 더 많은 쪽 탭 목록으로 갑니다." },
    { group: "홈", go: HOME, sel: ".charts-hint", name: "그래프 안내 줄", code: ".charts-hint",
      desc: "그래프를 누르면 요약이 뜬다는 안내입니다(휴대폰은 마우스를 올릴 수 없어 이 줄이 단서)." },
    { group: "홈", go: HOME, sel: "#homeCharts", name: "그래프 6개 영역", code: "#homeCharts · renderCharts()",
      desc: "무엇을(도넛 2) → 누구를·어느 지역(나비·지도) → 언제(마감 달력·달별 막대) 순서입니다. 화면에 들어올 때 자라나는 움직임이 있고, '움직임 줄이기' 설정이면 바로 보입니다." },
    { group: "홈", go: HOME, big: true, sel: "[data-key=nf]", name: "공고는 무엇을 지원하나요?", code: "noticeFieldCard() · nf",
      desc: "모집 공고를 9가지 분야(자금·융자, 기술·R&D, 판로·수출…)로 나눈 파란 도넛입니다. 조각이나 오른쪽 이름을 누르면 그 분야 요약이 뜹니다." },
    { group: "홈", go: HOME, big: true, sel: "[data-key=svc]", name: "공공서비스는 무엇을 지원하나요?", code: "supportCard() · cat / sp",
      desc: "공공서비스를 분야(생활안정·보육·교육…) 또는 지원 방식(현금·감면·융자…)으로 나눈 초록 도넛입니다. 지원 방식은 한 서비스가 여러 방식일 수 있어 합이 100%를 넘습니다." },
    { group: "홈", go: HOME, big: true, sel: "[data-key=persona]", name: "누구를 위한 지원이 많나요?", code: "personaCard() · butterflyBars()",
      desc: "나비 그래프: 가운데 대상 이름, 왼쪽 막대 = 모집 공고, 오른쪽 = 공공서비스. 적은 수도 보이게 막대 길이를 제곱근으로 줄여 그렸습니다." },
    { group: "홈", go: HOME, big: true, sel: "[data-key=map]", name: "어느 지역에 많나요?", code: "regionCard() · koreaMap()",
      desc: "그 지역'만'을 위한 지원사업 수를 색 진하기로 보여 줍니다(전국 대상 제외). 단추로 모집 공고 / 공공서비스를 바꿉니다. 지역을 누르면 요약과 '홈을 이 지역 기준으로 보기' 단추." },
    { group: "홈", go: HOME, sel: ".kmap-list", name: "지역 순위 목록", code: ".kmap-list",
      desc: "지도 옆 16개 지역 순위입니다. 작은 광역시는 지도에서 숫자가 가려져서 목록으로도 보여 줍니다. 지도와 가리키기가 이어집니다." },
    { group: "홈", go: HOME, big: true, sel: "[data-key=due]", name: "언제 마감되나요?(마감 달력)", code: "dueCard() · dueKind · dueMonth",
      desc: "날짜마다 마감하는 수를 달력에 칠했습니다(진할수록 많이 몰린 날). 제목 옆 단추로 모집 공고(파랑) / 공공서비스(초록), 이번 달~두 달 뒤를 고릅니다. 칸을 누르면 그날 마감 요약." },
    { group: "홈", go: HOME, sel: ".duecal .dmine", name: "내 달력 점", code: ".dmine · hub-cal",
      desc: "상세에서 '마감일 달력에 추가'를 누른 공고의 마감일에 찍히는 검은 점입니다." },
    { group: "홈", go: HOME, sel: ".duecal-later", name: "이후 마감 단추", code: ".duecal-later",
      desc: "석 달 뒤보다 늦게 마감하는 것의 수입니다. 누르면 그 목록으로 갑니다." },
    { group: "홈", go: HOME, big: true, sel: "[data-key=months]", name: "공고는 언제 올라오나요?", code: "openMonthsCard() · META.openMonths",
      desc: "국고보조금 공고가 몇 월에 접수를 시작하는지 작년(회색)과 올해(파랑)를 비교합니다. '누적'으로 바꾸면 1월부터 쌓은 선 그래프." },
    { group: "홈", go: HOME, sel: ".seg-mini", name: "전환 단추(알약)", code: ".seg-mini · segToggle()",
      desc: "카드 안에서 보기를 바꾸는 단추입니다. 고른 단추 뒤로 검은 알약이 미끄러져 갑니다. 바꾼 카드만 다시 그려집니다." },
    { group: "홈", go: HOME, sel: ".donut-legend", name: "도넛 범례", code: ".donut-legend",
      desc: "도넛 조각의 이름 목록입니다. 가리키면 해당 조각이 튀어나오고 가운데에 건수·이름·비율이 나옵니다." },
    { group: "홈", go: HOME, sel: ".viz-sub", name: "카드 부제(설명 한 줄)", code: ".viz-sub",
      desc: "카드 제목 아래 한 줄 설명입니다. 무엇을 기준으로 그렸는지 알려 줍니다." },
    { group: "홈", go: HOME, sel: ".home-grid", name: "목록 카드 첫 줄", code: ".home-grid · renderHomeLists()",
      desc: "마감이 가까운 지원사업 · 새로 올라온 공고 · 곧 접수가 시작되는 공고. 처음 5줄, '더 보기'로 10줄씩. 넓은 화면은 5줄 높이 칸 안에서 스크롤." },
    { group: "홈", go: HOME, big: true, sel: "section:has(> #homeSoon)", name: "마감이 가까운 지원사업", code: "#homeSoon",
      desc: "접수 중이고 마감일이 있는 모집 공고 + 공공서비스를 마감이 빠른 순으로. 공공서비스 줄에는 초록 '서비스' 표시가 붙습니다." },
    { group: "홈", go: HOME, big: true, sel: "section:has(> #homeNew)", name: "새로 올라온 공고", code: "#homeNew · postedWithin()",
      desc: "최근 7일 안에 출처 사이트에 게시된 모집 공고, 새것부터." },
    { group: "홈", go: HOME, big: true, sel: "section:has(> #homeStarts)", name: "곧 접수가 시작되는 공고", code: "#homeStarts · startsSoon()",
      desc: "이미 공고가 났고 7일 안에 신청을 받기 시작하는 공고, 시작이 빠른 순." },
    { group: "홈", go: HOME, sel: "#homeUpcoming", name: "맨 아래 카드 줄", code: "#homeUpcoming",
      desc: "많이 찾는 지원사업 · 곧 올라올 수 있는 공고 · 새로 생긴 공공서비스. 넓은 화면에서 세 카드의 목록 시작 높이를 맞춰 두었습니다." },
    { group: "홈", go: HOME, big: true, sel: "#homeUpcoming > .home-block", name: "많이 찾는 지원사업", code: "renderPopular() · META.topServices",
      desc: "누적 조회수 순위입니다. 모집 공고는 기업마당 조회수, 공공서비스는 보조금24 조회수. 단추로 바꿉니다(처음은 모집 공고)." },
    { group: "홈", go: HOME, big: true, sel: "[data-key=upcoming]", name: "곧 올라올 수 있는 공고", code: "upcomingCard() · META.upcoming",
      desc: "작년 이맘때 접수를 시작한 국고보조금 공고입니다. 해마다 비슷한 때 다시 나오는 경우가 많아 미리 준비할 수 있습니다. '올해 공고 있음'이면 올해 것이 이미 올라온 것." },
    { group: "홈", go: HOME, big: true, sel: "[data-key=newsvc]", name: "새로 생긴 공공서비스", code: "newServicesCard() · META.newServices",
      desc: "보조금24에 최근 30일 안에 새로 생긴 서비스입니다(이 사이트가 처음 본 날 기준, 첫 수집일 9.30은 모두가 처음이라 뺌)." },
    { group: "홈", go: HOME, sel: ".more-link", name: "전체 보기", code: ".more-link",
      desc: "카드 내용 전체를 목록 화면에서 봅니다." },
    { group: "홈", go: HOME, sel: ".btn.more", name: "더 보기", code: ".btn.more",
      desc: "카드 안에 10줄을 더 붙입니다(목록 화면에서는 40줄씩)." },

    // ---------- 목록 한 줄 ----------
    { group: "목록 한 줄", sel: ".row-title", name: "제목", code: ".row-title",
      desc: "공고·서비스 이름입니다. 홈 카드에서는 두 줄까지만 보여 줍니다." },
    { group: "목록 한 줄", sel: ".row-meta", name: "기관 · 지역", code: ".row-meta",
      desc: "소관 기관과 지역입니다. 지역이 넷 이상이면 '외 N'으로 줄입니다." },
    { group: "목록 한 줄", sel: ".row-side .badge.svc", name: "'서비스' 표시", code: ".badge.svc",
      desc: "공고와 공공서비스가 섞인 목록에서 공공서비스임을 알리는 초록 표시입니다." },
    { group: "목록 한 줄", sel: ".row-side .badge", name: "상태 배지", code: "statusBadge()",
      desc: "D-day(빨강 = 오늘~3일, 주황 = 7일 안, 그 밖은 선), 접수 예정, 예산 소진 시까지, 상시 등 신청 상태입니다." },
    { group: "목록 한 줄", sel: ".row-src", name: "출처 표시", code: ".row-src · SRC_NAME",
      desc: "이 자료를 가져온 곳(기업마당·K-Startup·국고보조금·보조금24)." },
    { group: "목록 한 줄", sel: ".row-tags", name: "태그 배지", code: ".row-tags · tagsOf()",
      desc: "신규·민간 주관·분야 같은 짧은 표시입니다." },
    { group: "목록 한 줄", sel: ".row-fav", name: "관심 담음 별", code: ".row-fav",
      desc: "관심에 담은 것에 붙는 검은 별입니다." },
    { group: "목록 한 줄", sel: "button.row, .row[data-id]", name: "목록 한 줄", code: ".row · row()",
      desc: "누르면 상세가 열립니다(넓은 화면은 오른쪽, 휴대폰은 전체 화면)." },

    // ---------- 목록 화면 ----------
    { group: "목록 화면", go: OPEN, sel: "#filters", name: "조건 창", code: "#filters · setupFilters()",
      desc: "목록을 좁히는 조건들입니다. 넓은 화면은 왼쪽에 늘 보이고, 휴대폰은 '조건' 단추로 여는 시트입니다. 고른 조건은 주소(#…)에 담겨서 링크를 보내면 같은 결과를 봅니다." },
    { group: "목록 화면", go: OPEN, big: true, sel: "#meBox", name: "내 조건(나이·소득·성별)", code: "#meBox · fitsMe() · hub-me",
      desc: "넣으면 나이·소득·성별 조건이 맞지 않는 사업을 뺍니다(조건 없는 사업은 남김). 홈 '내 조건에 맞음' 타일과 같은 값이고, 이 기기에만 저장됩니다." },
    { group: "목록 화면", go: OPEN, big: true, sel: "fieldset:has(> #aud)", name: "누구를 위한 지원", code: "#aud · au",
      desc: "18가지 대상 칩. 여러 개 고르면 하나라도 맞는 것. 0건인 칩은 숨깁니다." },
    { group: "목록 화면", go: OPEN, sel: "#fsTopic", name: "농업 세부 분야", code: "#fsTopic · tp",
      desc: "'농업인'을 고르면 나타나는 11가지 농업 분야(과수·원예, 축산·방역, 스마트팜 등)." },
    { group: "목록 화면", go: OPEN, big: true, sel: "#fsCat", name: "분야", code: "#fsCat · cg · fieldOf()",
      desc: "모집 공고는 9가지, 공공서비스는 10가지 분야입니다(탭마다 다름)." },
    { group: "목록 화면", go: SVC, big: true, sel: "#fsSupport", name: "지원 방식", code: "#fsSupport · sp",
      desc: "공공서비스 탭에만: 현금·감면·융자·현물·이용권 등." },
    { group: "목록 화면", go: OPEN, big: true, sel: "fieldset:has(> #status)", name: "신청 상태", code: "#status · st · statusOf()",
      desc: "접수 중·접수 예정·예산 소진 시까지·상시·매년 정기·확인 필요 등. 원문 신청기간 글을 읽어 나눈 것입니다(날짜를 지어내지 않음)." },
    { group: "목록 화면", go: OPEN, big: true, sel: "#fsSrc", name: "출처", code: "#fsSrc · src",
      desc: "기업마당·K-Startup·국고보조금 중 고르기(모집 공고 탭)." },
    { group: "목록 화면", go: OPEN, sel: "#privWrap", name: "민간 주관 공고도 보기", code: "#priv · pv",
      desc: "끄면 민간 기관이 주관하는 공고를 뺍니다." },
    { group: "목록 화면", go: OPEN, sel: "#listPane", name: "목록 영역", code: "#listPane · renderList()",
      desc: "검색칸, 도구 줄, 고른 조건, 결과 목록이 있는 가운데 영역입니다." },
    { group: "목록 화면", go: OPEN, big: true, sel: "#listPane .searchbar", name: "검색칸 · 지역", code: ".searchbar · #q · #region",
      desc: "목록 안에서 낱말로 찾고 지역을 고릅니다(홈과 같은 지역 값을 씁니다)." },
    { group: "목록 화면", go: OPEN, big: true, sel: "#soonToggle", name: "7일 안에 마감만", code: "#soonToggle · soon",
      desc: "지금 조건 안에서 7일 안에 마감하는 것만 봅니다. 옆 숫자는 눌렀을 때 남을 건수. 두 탭 모두에 있습니다." },
    { group: "목록 화면", go: OPEN, sel: "#resultCount", name: "결과 건수", code: "#resultCount",
      desc: "지금 조건에 맞는 건수입니다." },
    { group: "목록 화면", go: OPEN, big: true, sel: "label.sort", name: "정렬", code: "#sort · sortItems()",
      desc: "마감 임박순(기본) · 최근 등록순 · 최근 수정순 · 이름순. 공공서비스 탭은 이름순이 기본입니다(마감 조건으로 볼 때만 마감 임박순)." },
    { group: "목록 화면", go: OPEN, sel: "#filterOpen", name: "조건 단추(휴대폰)", code: "#filterOpen",
      desc: "휴대폰에서 조건 시트를 엽니다. 숫자 배지는 고른 조건 수." },
    { group: "목록 화면", go: OPEN, big: true, sel: "#activeFilters", name: "고른 조건 칩", code: "#activeFilters · renderActive()",
      desc: "지금 걸린 조건을 칩으로 보여 줍니다. 칩을 누르면 그 조건만 풀리고, '모두 지우기'로 한 번에 풉니다." },
    { group: "목록 화면", go: OPEN, sel: ".cross-note", name: "다른 쪽 안내 줄", code: ".cross-note · dueCrossNote()",
      desc: "마감 조건으로 볼 때 같은 조건의 반대쪽(모집 공고 ↔ 공공서비스)도 있으면 알려 주는 한 줄입니다. 누르면 그쪽 목록으로 갑니다." },
    { group: "목록 화면", go: OPEN, big: true, sel: "#results", name: "결과 목록", code: "#results",
      desc: "처음 40줄, 아래 '더 보기'로 40줄씩 더 붙입니다." },
    { group: "목록 화면", go: OPEN, sel: "#basisShort", name: "수집 시각", code: "#basisShort · renderBasis()",
      desc: "목록 자료를 마지막으로 모은 시각입니다. 출처 하나가 실패하면 여기에 알려 줍니다." },

    // ---------- 상세 ----------
    { group: "상세 화면", go: DETAIL, sel: "#detail", name: "상세 패널", code: "#detail · renderDetail()",
      desc: "목록에서 누른 공고·서비스의 자세한 내용입니다. 넓은 화면은 목록 오른쪽, 휴대폰은 전체 화면이고 Esc·뒤로 가기로 닫습니다." },
    { group: "상세 화면", go: DETAIL, big: true, sel: "#detailTitle", name: "상세 제목", code: "#detailTitle",
      desc: "공고·서비스 이름입니다." },
    { group: "상세 화면", go: DETAIL, big: true, sel: "#detail .facts", name: "핵심 정보 표", code: ".facts",
      desc: "신청기간(D-day), 지역, 대상, 소관·수행 기관, 분야를 한눈에 보여 주는 표입니다." },
    { group: "상세 화면", go: DETAIL, big: true, sel: "#detail a.btn.yellow", name: "원문 보기(노란 단추)", code: ".btn.yellow",
      desc: "원래 사이트의 공고 원문으로 갑니다. 노랑은 '화면마다 하나뿐인 주요 행동'에만 쓰는 색입니다." },
    { group: "상세 화면", go: DETAIL, sel: "#detail a.btn.dark", name: "신청 페이지", code: ".btn.dark",
      desc: "원문에 신청 주소가 따로 있으면 보이는 단추입니다." },
    { group: "상세 화면", go: DETAIL, big: true, sel: "#detail .fav-btn", name: "관심 담기", code: ".fav-btn · toggleFav()",
      desc: "홈 맨 위 '관심 담은 지원사업'에 모아 둡니다(이 기기에만 저장)." },
    { group: "상세 화면", go: DETAIL, big: true, sel: "#detail .cal-btn", name: "마감일 달력에 추가", code: ".cal-btn · toggleCal()",
      desc: "홈 마감 달력 그날 칸에 검은 점으로 표시합니다. 외부 달력(구글 등)에는 넣지 않습니다." },
    { group: "상세 화면", go: DETAIL, sel: "#detail .actions.tools .btn.tool:not(.fav-btn):not(.cal-btn):not(.wide-only-print)", name: "공유", code: "shareItem()",
      desc: "휴대폰은 공유 창(카톡 등), PC는 링크 복사. 링크를 열면 이 상세가 바로 열립니다." },
    { group: "상세 화면", go: DETAIL, sel: "#detail .wide-only-print", name: "인쇄", code: "@media print",
      desc: "공고 내용만 A4 한 장으로 깔끔하게 인쇄합니다." },
    { group: "상세 화면", go: DETAIL, big: true, sel: "#detail .files", name: "공고문 · 첨부 파일", code: ".files · fl",
      desc: "기업마당 공고의 공고문(한글·PDF)과 첨부 파일 내려받기 링크입니다." },
    { group: "상세 화면", go: DETAIL, big: true, sel: "#detail .contact", name: "문의처", code: ".contact · contactSection()",
      desc: "전화번호를 누르면 바로 전화, 메일을 누르면 메일 쓰기." },
    { group: "상세 화면", go: DETAIL, sel: "#detail .caution", name: "확인 안내", code: ".caution",
      desc: "언제 모은 자료인지와, 화면 글은 원문 일부이니 신청 전에 원문을 확인하라는 안내입니다." },
    { group: "상세 화면", go: DETAIL, big: true, sel: "#detail .similar-box", name: "비슷한 지원사업 3건", code: ".similar-box · similarItems()",
      desc: "같은 분야(+3)·겹치는 대상(+2)·같은 지방(+3) 점수로 고른, 지금 신청할 수 있는 비슷한 것 3건입니다." },
    { group: "상세 화면", go: DETAIL, sel: "#detail section", name: "본문 칸", code: "#detail section",
      desc: "지원 대상 · 사업 개요 · 지원 내용 · 신청 방법 · 선정 기준 · 구비 서류 등 원문에서 옮긴 글입니다." },
    { group: "상세 화면", go: DETAIL, sel: ".change-note", name: "기간 바뀜 알림", code: ".change-note · changeOf()",
      desc: "관심·내 달력에 담은 뒤 마감일·시작일이 바뀌었으면 알려 줍니다." }
  ];

  // ---------- 화면 위에 덧씌우는 공부 도구 ----------
  var css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "study.css?v=1";
  document.head.append(css);

  var touch = false; // PC 전용 기능(머리 단추가 넓은 화면·마우스에서만 보임): 설명 상자는 늘 마우스 옆에
  var mode = "hover"; // hover: 가리키면 설명(사이트도 동작) / tap: 누르면 설명(사이트 동작 멈춤)
  var on = false, labels = false;
  var api = window.HUB_STUDY = { start: start, stop: stop, onchange: null };

  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  var box = mk("div", "st-ui st-box"), tip = mk("div", "st-ui st-tip"), badges = mk("div", "st-ui st-badges");
  tip.setAttribute("role", "status");
  document.body.append(box, tip, badges);

  function inUI(n) { return n && n.closest && n.closest(".st-ui"); }
  function find(n) {
    var chain = [];
    for (var el = n; el && el !== document.body && el.nodeType === 1; el = el.parentElement || el.parentNode) {
      if (inUI(el)) return [];
      for (var i = 0; i < E.length; i++) {
        var e = E[i];
        try { if (el.matches(e.sel) && (!e.test || e.test(el))) { chain.push({ el: el, e: e }); break; } } catch (x) { /* 지원 안 되는 선택자 */ }
      }
    }
    return chain;
  }

  var cur = null;
  function show(hit, chain, x, y) {
    cur = hit;
    var r = hit.el.getBoundingClientRect();
    box.style.cssText = "display:block;left:" + (r.left - 3) + "px;top:" + (r.top - 3) + "px;width:" + (r.width + 6) + "px;height:" + (r.height + 6) + "px";
    tip.replaceChildren();
    var path = chain.slice(1).reverse().map(function (c) { return c.e.name; });
    if (path.length) tip.append(mk("p", "st-path", path.join(" › ")));
    tip.append(mk("p", "st-name", hit.e.name), mk("p", "st-desc", hit.e.desc), mk("p", "st-code", "코드: " + hit.e.code));
    tip.style.display = "block";
    var w = tip.offsetWidth, h = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
    var barEl = document.querySelector(".st-bar");
    if (barEl && !barEl.hidden) vh = Math.min(vh, barEl.getBoundingClientRect().top - 4); // 아래 조작 띠를 가리지 않게
    var left = x + 16, top = y + 18;
    if (touch || x === undefined) { left = (vw - w) / 2; top = r.bottom + 10 + h > vh ? Math.max(8, r.top - h - 10) : r.bottom + 10; }
    if (left + w > vw - 8) left = x - w - 16;
    if (top + h > vh - 8) top = y - h - 18;
    tip.style.left = Math.max(8, Math.min(vw - w - 8, left)) + "px";
    tip.style.top = Math.max(8, Math.min(vh - h - 8, top)) + "px";
  }
  function hide() { cur = null; box.style.display = "none"; tip.style.display = "none"; }

  document.addEventListener("mousemove", function (ev) {
    if (!on || mode !== "hover") return;
    var chain = find(ev.target);
    if (!chain.length) { hide(); return; }
    show(chain[0], chain, ev.clientX, ev.clientY);
  }, true);
  document.addEventListener("mouseleave", function () { if (mode === "hover") hide(); });
  window.addEventListener("scroll", function () { if (mode === "hover") hide(); else if (cur) show(cur, find(cur.el)); }, { passive: true });

  // 누르면 설명: 사이트의 클릭을 막고 그 자리 설명을 고정해서 보여 준다
  function block(ev) {
    if (!on || mode !== "tap" || inUI(ev.target)) return;
    if (ev.target.closest && ev.target.closest("#studyToggle")) return; // 머리의 공부 모드 단추로는 늘 끌 수 있게
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    if (ev.type !== "click") return;
    var chain = find(ev.target);
    if (!chain.length) { hide(); return; }
    show(chain[0], chain, touch ? undefined : ev.clientX, touch ? undefined : ev.clientY);
  }
  ["click", "pointerdown", "mousedown", "touchstart", "submit", "change"].forEach(function (t) {
    document.addEventListener(t, block, { capture: true, passive: false });
  });

  // 이름표 모두 보기: 큰 영역(big)에 이름표를 붙인다
  function drawBadges() {
    badges.replaceChildren();
    if (!labels || !on) return;
    var stamp = ++badgeStamp;
    E.forEach(function (e) {
      if (!e.big) return;
      document.querySelectorAll(e.sel).forEach(function (el) {
        if (e.test && !e.test(el)) return;
        if (el._stBadged === stamp) return;
        el._stBadged = stamp;
        var r = el.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
        var f = mk("div", "st-frame"); f.style.cssText = "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px";
        var b = mk("span", "st-badge" + (r.top < 12 ? " inside" : ""), e.name); f.append(b);
        badges.append(f);
      });
    });
  }
  var raf = 0, badgeStamp = 0;
  function later() { if (!labels) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(drawBadges); }
  window.addEventListener("scroll", later, { passive: true });
  window.addEventListener("resize", later);
  new MutationObserver(function (ms) { if (ms.some(function (m) { return !inUI(m.target); })) later(); })
    .observe(document.body, { childList: true, subtree: true });

  // 아래 조작 띠
  var bar = mk("div", "st-ui st-bar");
  var title = mk("strong", null, "공부 모드");
  function btn(text, fn) { var b = mk("button", "st-btn", text); b.type = "button"; b.addEventListener("click", function (ev) { ev.stopPropagation(); fn(b); }); return b; }
  var bMode = btn("", function () { mode = mode === "hover" ? "tap" : "hover"; hide(); paint(); });
  var bLab = btn("", function () { labels = !labels; paint(); drawBadges(); });
  var bList = btn("용어집", function () { panel.hidden = !panel.hidden; });
  var bOn = btn("끄기", function () { stop(); });
  function paint() {
    bMode.textContent = mode === "hover" ? "가리키면 설명" : "누르면 설명";
    bMode.title = mode === "hover" ? "마우스를 올리면 설명. 사이트도 그대로 누를 수 있어요(누르면 '누르면 설명'으로)"
      : "누르면 설명이 고정돼요. 사이트 단추는 동작하지 않아요(누르면 '가리키면 설명'으로)";
    bLab.textContent = labels ? "이름표 끄기" : "이름표 모두";
    bMode.setAttribute("aria-pressed", String(mode === "tap"));
    bLab.setAttribute("aria-pressed", String(labels));
  }
  function start() {
    if (on) return;
    on = true; bar.hidden = false; paint();
  }
  function stop() {
    if (!on) return;
    on = false; labels = false; hide(); drawBadges(); panel.hidden = true; bar.hidden = true;
    if (api.onchange) api.onchange(false);
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !on) return;
    if (!panel.hidden) panel.hidden = true; else hide();
  });
  bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "공부 모드");
  bar.hidden = true;
  bar.append(title, bMode, bLab, bList, bOn);
  document.body.append(bar);

  // 용어집: 화면별 목록, 누르면 그 화면으로 가서 그 영역을 보여 준다
  var panel = mk("div", "st-ui st-panel"); panel.hidden = true;
  var head = mk("div", "st-phead"); head.append(mk("strong", null, "지원모아 영역 용어집 (" + E.length + "개)"));
  var x = btn("✕", function () { panel.hidden = true; }); x.setAttribute("aria-label", "닫기"); head.append(x);
  panel.append(head, mk("p", "st-pnote", "이름을 누르면 그 화면으로 가서 영역을 깜빡여 보여 줍니다. 회색은 지금 화면에 없는 것(조건을 바꾸거나 단추를 눌러야 나옴)."));
  var groups = {};
  E.forEach(function (e) {
    if (!groups[e.group]) { groups[e.group] = mk("div", "st-group"); groups[e.group].append(mk("p", "st-gname", e.group)); panel.append(groups[e.group]); }
    var it = btn("", function () { focusEntry(e); });
    it.className = "st-item";
    it.append(mk("span", "st-iname", e.name), mk("span", "st-idesc", e.desc));
    it._e = e;
    groups[e.group].append(it);
  });
  document.body.append(panel);
  function markPresent() {
    panel.querySelectorAll(".st-item").forEach(function (it) {
      var e = it._e, els = [].slice.call(document.querySelectorAll(e.sel)).filter(function (el) { return (!e.test || e.test(el)) && el.getClientRects().length; });
      it.classList.toggle("absent", !els.length);
    });
  }
  bList.addEventListener("click", markPresent);
  function focusEntry(e) {
    function go() {
      var el = [].slice.call(document.querySelectorAll(e.sel)).filter(function (n) { return (!e.test || e.test(n)) && n.getClientRects().length; })[0];
      if (!el) return false;
      panel.hidden = true; // 용어집이 영역을 가리지 않게 닫는다(다시 열면 그대로)
      el.scrollIntoView({ block: "center" });
      setTimeout(function () {
        show({ el: el, e: e }, find(el).length ? find(el) : [{ el: el, e: e }]);
        box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash");
      }, 350);
      return true;
    }
    if (go()) return;
    if (e.go && location.hash !== e.go) { location.hash = e.go; setTimeout(function () { if (!go()) note(e); markPresent(); }, 1500); }
    else note(e);
  }
  var noteBox = mk("div", "st-ui st-note"); noteBox.hidden = true; noteBox.setAttribute("role", "status");
  document.body.append(noteBox);
  function note(e) {
    noteBox.textContent = "'" + e.name + "'은(는) 지금 화면에 없어요. 조건·단추에 따라 나타나는 영역입니다(예: 관심을 담아야 보이는 칸, 그래프를 눌러야 뜨는 요약 창).";
    noteBox.hidden = false;
    clearTimeout(note.t); note.t = setTimeout(function () { noteBox.hidden = true; }, 4000);
  }
  paint();
})();
