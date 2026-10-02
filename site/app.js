/* 지원모아: 화면 동작
 * 데이터: data/meta.js, data/notices.js(공고 목록, 긴 글 제외), data/notices-text.js(공고 개요·신청 방법 등 긴 글,
 *         첫 화면 뒤에 읽음), data/services.js(상시 제도, 필요할 때 읽음), data/sd/NN.js(상시 제도 상세 글·공고 첨부 파일,
 *         열 때 읽음), data/peek.js(그래프 요약 창의 상시 제도 요약). collector/build_site.py가 만든다.
 */
(function () {
  "use strict";

  var META = window.HUB_META;
  var NOTICES = window.HUB_NOTICES || [];
  var PAGE = 40;
  var SOON_DAYS = 7;
  var NEW_DAYS = 3;     // '신규' 배지: 출처에 올라온 지 3일 안
  var RECENT_DAYS = 7;  // 홈 '새로 올라온 공고'와 목록의 같은 이름 조건
  var GOV24_URL = "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/";
  var DETAIL_BUCKETS = 64; // build_site.py의 DETAIL_BUCKETS와 같아야 한다
  var SITE_TITLE = "지원모아";
  var SRC_NAME = { bizinfo: "기업마당", kstartup: "K-Startup", bojo: "국고보조금", gov24: "보조금24" };
  var SRC_LINK = { bizinfo: "기업마당에서 원문 보기", kstartup: "K-Startup에서 원문 보기",
    bojo: "보조금 통합포털에서 원문 보기", gov24: "정부24에서 자세히 보기" };
  // 기간 종류(collector/normalize.py PERIOD_RULES·STATUS_BY_TYPE와 같아야 한다). 날짜가 없는 사업을 원문 표기로 나눈다
  var STATUS_BY_TYPE = { "상시": "상시", "소진시": "소진 시까지", "정기": "매년 정기", "주기": "매월·분기 접수",
    "신청불필요": "신청 불필요", "사유발생": "사유 발생 후 신청", "기관별": "기관별로 다름" };
  var STATUS_ORDER = ["접수 중", "접수 예정", "소진 시까지", "상시", "매월·분기 접수", "매년 정기", "사유 발생 후 신청",
    "기관별로 다름", "신청 불필요", "확인 필요"];
  // 목록에서 원문 기간 문구를 한 줄 더 보여 줄 상태(날짜 대신 원문이 답이 되는 경우)
  var SHOW_PERIOD_TEXT = ["확인 필요", "매년 정기", "매월·분기 접수", "사유 발생 후 신청", "기관별로 다름"];
  var WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

  var today = localDate(new Date());
  var services = window.HUB_SERVICES || null;
  var byId = new Map();
  NOTICES.forEach(function (n) { byId.set(n.id, n); });

  var DEFAULT = { tab: "open", q: "", r: "", nat: true, au: [], st: [], src: [], pv: true,
    tp: [], sp: [], cg: [], soon: false, nw: false, td: false, due: "", om: "", ag: "", ic: "", sx: "", sort: "", id: "" };

  /* 내 조건(나이·소득·성별): 상시 제도 대부분과 일부 공고가 가진 나이(na)·중위소득(ic)·성별(sx) 조건으로 거른다.
   * 조건이 없는 사업은 늘 남긴다. 이 기기 localStorage "hub-me"에 기억해 다음에 열어도 그대로 쓴다(서버로 보내지 않음).
   * 소득은 구간으로 고른다: 값 = 구간 끝(50·75·100·200), 201 = 200% 초과 */
  var ME_KEY = "hub-me";
  var INCOME_BANDS = [{ v: "50", lo: 0, hi: 50, label: "중위소득 50% 이하" }, { v: "75", lo: 51, hi: 75, label: "51~75%" },
    { v: "100", lo: 76, hi: 100, label: "76~100%" }, { v: "200", lo: 101, hi: 200, label: "101~200%" }, { v: "201", lo: 201, hi: 999, label: "200% 초과" }];
  function loadMe() {
    try { var v = JSON.parse(localStorage.getItem(ME_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; }
  }
  function cleanMe(v) {
    return { ag: /^\d{1,3}$/.test(v.ag || "") && +v.ag <= 120 ? String(+v.ag) : "",
      ic: INCOME_BANDS.some(function (b) { return b.v === v.ic; }) ? v.ic : "", sx: v.sx === "f" || v.sx === "m" ? v.sx : "" };
  }

  /* 빈 조건. 배열은 매번 새로 만든다(DEFAULT의 배열을 같이 쓰면 칩을 누를 때 DEFAULT가 바뀐다) */
  function blankState(extra) {
    return Object.assign({}, DEFAULT, { au: [], st: [], src: [], tp: [], sp: [], cg: [] }, extra);
  }
  var state = readHash();
  var shown = PAGE;
  var lastRowFocus = null;

  function $(sel) { return document.querySelector(sel); }
  function fmtN(n) { return n.toLocaleString("ko-KR"); }

  /* ---------- 작은 도우미 ---------- */

  function el(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") node.textContent = v;
        else if (k === "className") node.className = v;
        else if (k === "dataset") Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      node.append(c);
    }
    return node;
  }

  function icon(name) { return el("i", { className: "ph ph-" + name, "aria-hidden": "true" }); }

  function localDate(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  }

  function fmtDate(iso, withYear) {
    if (!iso) return "";
    var p = iso.split("-");
    var wd = WEEKDAY[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()];
    var md = (+p[1]) + "." + (+p[2]) + "(" + wd + ")";
    return (withYear || p[0] !== today.slice(0, 4)) ? p[0] + "." + md : md;
  }

  function fmtStamp(at) {
    var d = at.slice(0, 10).split("-");
    return (+d[1]) + "월 " + (+d[2]) + "일 " + at.slice(11, 16);
  }

  function list(v) { return v ? v.split(",").filter(Boolean) : []; }

  function addDays(iso, n) {
    var p = iso.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
  }

  function dueLabel(due) {
    var r = due.split("~");
    if (r[0] === r[1]) return fmtDate(r[0]) + " 마감";
    return r[1] === "9999-12-31" ? fmtDate(r[0]) + " 이후 마감" : fmtDate(r[0]) + "~" + fmtDate(r[1]) + " 마감";
  }

  function safeUrl(u) {
    if (!u) return null;
    u = String(u).trim();
    if (/^www\./i.test(u)) u = "https://" + u;
    return /^https?:\/\//i.test(u) ? u : null;
  }

  function statusOf(item) {
    if (item.py !== "기간") return STATUS_BY_TYPE[item.py] || "확인 필요";
    if (item.s && today < item.s) return "접수 예정";
    if (item.e && today > item.e) return "마감";
    return "접수 중";
  }

  function isSoon(item) {
    return statusOf(item) === "접수 중" && item.e && daysBetween(today, item.e) <= SOON_DAYS;
  }

  /* 출처에 올라온 날(pd)이 오늘부터 days일 안인가. 앞으로 접수가 시작될 날짜는 넣지 않는다 */
  function postedWithin(item, days) {
    if (!item.pd || item.pd > today) return false;
    return daysBetween(item.pd, today) <= days;
  }

  /* '오늘 새 공고': 가장 최근 수집(매일 06:30)에서 처음 들어온 모집 공고(fs = 처음 수집한 날).
   * 첫 수집 날(META.firstDay)은 모두가 처음이라 세지 않는다. 오늘 수집 전(자정~6:30)에는 어제 수집분을 '어제 새 공고'로 */
  var NEW_DAY = (META.builtAt || "").slice(0, 10);
  function isTodayNew(item) {
    return item.k === "n" && item.fs === NEW_DAY && NEW_DAY !== META.firstDay;
  }
  function newDayLabel() {
    if (NEW_DAY === today) return "오늘";
    if (NEW_DAY === addDays(today, -1)) return "어제";
    return fmtDate(NEW_DAY);
  }

  function isNew(item) {
    if (item.k === "n") return postedWithin(item, NEW_DAYS);
    return item.fs && META.firstDay && item.fs > META.firstDay && daysBetween(item.fs, today) <= NEW_DAYS;
  }

  /* 조회수는 만·억 단위로 줄여 쓴다 */
  function fmtViews(n) {
    if (n >= 1e8) return (Math.round(n / 1e7) / 10) + "억";
    if (n >= 1e4) return fmtN(Math.round(n / 1e4)) + "만";
    return fmtN(n);
  }

  function regionText(item, full) {
    var rg = item.rg || [];
    if (!rg.length) return "";
    if (full || rg.length <= 3) return rg.join(", ");
    return rg.slice(0, 3).join(", ") + " 외 " + (rg.length - 3);
  }

  function sourceUrl(item) {
    if (item.u) return safeUrl(item.u);
    if (item.src === "gov24") return GOV24_URL + item.id.split(":")[1];
    return null;
  }

  function toast(msg) {
    document.querySelectorAll(".toast").forEach(function (o) { o.remove(); });
    var t = el("div", { className: "toast", role: "status", text: msg });
    document.body.append(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  /* ---------- 관심 담기(이 기기 브라우저에만 저장, 서버로 보내지 않음) ----------
   * localStorage "hub-fav" = [{ id, k, src, t, ag, rg, py, s, e, pt, at(담은 날) }].
   * 마감되어 목록에서 내려가도 보이게 짧은 사본을 같이 둔다. 홈 맨 위 '관심 담은 지원사업' 칸과 상세의 단추가 쓴다 */
  var FAV_KEY = "hub-fav", FAV_KEYS = ["id", "k", "src", "t", "ag", "rg", "py", "s", "e", "pt"];
  var favs = loadFavs();
  function loadFavs() {
    try { var v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function saveFavs() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); return true; } catch (e) { return false; }
  }
  function isFav(id) { return favs.some(function (f) { return f.id === id; }); }
  /* 담은 표시는 꽉 찬 별(아이콘 글꼴은 빈 별만 있어 SVG로 그린다), 담기 전은 빈 별 */
  function starIcon(filled) {
    if (!filled) return icon("star");
    var svg = svgEl("svg", { viewBox: "0 0 256 256", width: "1em", height: "1em", "class": "star-fill", "aria-hidden": "true" });
    svg.append(svgEl("path", { fill: "currentColor", d: "M234.29 114.85l-45 38.83L203 211.75a16.4 16.4 0 0 1-24.5 17.82L128 198.49 77.47 229.57A16.4 16.4 0 0 1 53 211.75l13.76-58.07-45-38.83A16.46 16.46 0 0 1 31.08 86l59-4.76 22.76-55.08a16.36 16.36 0 0 1 30.27 0l22.75 55.08 59 4.76a16.46 16.46 0 0 1 9.37 28.86Z" }));
    return svg;
  }
  function toggleFav(item) {
    var on = !isFav(item.id);
    if (on) {
      var snap = { at: today };
      FAV_KEYS.forEach(function (k) { if (item[k] !== undefined) snap[k] = item[k]; });
      favs.unshift(snap);
    } else {
      favs = favs.filter(function (f) { return f.id !== item.id; });
    }
    if (!saveFavs()) toast("이 브라우저에서는 저장할 수 없습니다");
    else toast(on ? "관심에 담았어요 · 홈 맨 위에서 볼 수 있어요" : "관심에서 뺐어요");
    favChanged();
    return on;
  }
  /* 담은 것: 지금 자료에 있으면 그것(최신 기간), 없으면 담을 때 사본 */
  function favItems() {
    return favs.map(function (f) { return byId.get(f.id) || f; });
  }
  function favChanged() {
    if (state.tab === "home") renderFavs();
    document.querySelectorAll(".row[data-id]").forEach(function (b) { markFavRow(b, isFav(b.dataset.id)); });
  }
  function markFavRow(btn, on) {
    var old = btn.querySelector(".row-fav");
    if (on && !old) {
      var side = btn.querySelector(".row-side");
      if (side) side.prepend(el("span", { className: "row-fav", title: "관심 담음" }, starIcon(true), el("span", { className: "sr-only", text: "관심 담음" })));
    } else if (!on && old) old.remove();
  }
  window.addEventListener("storage", function (e) {
    if (e.key === FAV_KEY) { favs = loadFavs(); favChanged(); }
  });

  /* 담은 뒤 바뀐 접수 기간: 관심·내 달력에 담을 때 적어 둔 시작일(s)·마감일(e)과 지금 자료를 견준다.
   * 돌려주는 것 { text: 배지 글, tone, note: 상세에 보일 문장 } 또는 null. '확인'을 누르면 적어 둔 날을 지금 날로 바꾼다 */
  function changeOf(id) {
    var now = byId.get(id);
    var snap = favs.filter(function (f) { return f.id === id; })[0] || cals.filter(function (f) { return f.id === id; })[0];
    if (!now || !snap || now.k === "s") return null;
    if (snap.e && now.e && snap.e !== now.e) {
      var later = now.e > snap.e;
      return { text: (later ? "마감 연장 " : "마감 당겨짐 ") + fmtDate(now.e), tone: later ? "new" : "urgent",
        note: "담은 뒤 마감일이 " + (later ? "늦춰졌어요" : "앞당겨졌어요") + ": " + fmtDate(snap.e) + " → " + fmtDate(now.e) };
    }
    if (!snap.e && now.e) return { text: "마감일 생김 " + fmtDate(now.e), tone: "soon", note: "담은 뒤 마감일이 정해졌어요: " + fmtDate(now.e) };
    if (snap.s && now.s && snap.s !== now.s) {
      return { text: "시작일 바뀜 " + fmtDate(now.s), tone: "soft", note: "담은 뒤 접수 시작일이 바뀌었어요: " + fmtDate(snap.s) + " → " + fmtDate(now.s) };
    }
    return null;
  }
  function ackChange(id) {
    var now = byId.get(id);
    if (!now) return;
    [favs, cals].forEach(function (list) {
      list.forEach(function (f) { if (f.id === id) { f.e = now.e; f.s = now.s; f.py = now.py; } });
    });
    saveFavs();
    try { localStorage.setItem(CAL_KEY, JSON.stringify(cals)); } catch (e) { /* 저장 못 해도 화면은 그대로 */ }
  }
  function markChange(btn, id) {
    var ch = changeOf(id), side = btn.querySelector(".row-side");
    if (ch && side) side.prepend(badge(ch.text, ch.tone + " change"));
  }

  /* 홈 맨 위 칸: 마감 있는 것은 가까운 순, 나머지는 담은 순. 마감이 7일 안이면 머리에 배지 */
  function renderFavs() {
    var block = $("#homeFavBlock");
    if (!block) return;
    var items = favItems();
    block.hidden = !items.length;
    if (!items.length) return;
    var order = items.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
      var ea = statusOf(a.it) === "접수 중" && a.it.e ? a.it.e : "9999", eb = statusOf(b.it) === "접수 중" && b.it.e ? b.it.e : "9999";
      return ea.localeCompare(eb) || a.i - b.i;
    });
    var soonN = items.filter(isSoon).length;
    var urgent = items.some(function (it) { return isSoon(it) && daysBetween(today, it.e) <= 3; });
    $("#homeFavCount").textContent = fmtN(items.length);
    var headStar = $("#homeFavTitle .ph-star");
    if (headStar) headStar.replaceWith(starIcon(true));
    var flag = $("#homeFavFlag");
    var changedN = items.filter(function (it) { return changeOf(it.id); }).length;
    flag.hidden = !soonN && !changedN;
    flag.className = "badge " + (urgent ? "urgent" : soonN ? "soon" : "new");
    flag.textContent = [soonN ? "7일 안 마감 " + soonN + "건" : "", changedN ? "기간 바뀜 " + changedN + "건" : ""].filter(Boolean).join(" · ");
    var ul = $("#homeFav");
    ul.replaceChildren.apply(ul, order.map(function (o) {
      var li = row(o.it, byId.has(o.it.id) || o.it.k === "s" ? null : "목록에서 내려감", true);
      markChange(li.querySelector(".row"), o.it.id);
      var drop = el("button", { type: "button", className: "fav-drop", "aria-label": o.it.t + " 관심에서 빼기", title: "관심에서 빼기" }, icon("x"));
      drop.addEventListener("click", function () { toggleFav(o.it); });
      li.classList.add("fav-li");
      li.append(drop);
      return li;
    }));
  }

  /* ---------- 내 마감 달력(이 기기에만 저장) ----------
   * 상세의 '마감일 달력에 추가'로 넣은 공고를 홈 '언제 마감되나요?' 달력에 검은 점으로 표시한다.
   * localStorage "hub-cal" = 관심과 같은 짧은 사본 목록. 마감이 지난 것은 저절로 달력에서 사라진다 */
  var CAL_KEY = "hub-cal";
  var cals = loadList(CAL_KEY);
  function loadList(key) {
    try { var v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function inCal(id) { return cals.some(function (f) { return f.id === id; }); }
  function toggleCal(item) {
    var on = !inCal(item.id);
    if (on) {
      var snap = { at: today };
      FAV_KEYS.forEach(function (k) { if (item[k] !== undefined) snap[k] = item[k]; });
      cals.unshift(snap);
    } else cals = cals.filter(function (f) { return f.id !== item.id; });
    var ok = true;
    try { localStorage.setItem(CAL_KEY, JSON.stringify(cals)); } catch (e) { ok = false; }
    toast(!ok ? "이 브라우저에서는 저장할 수 없습니다" : on ? "홈 ‘언제 마감되나요?’ 달력에 넣었어요" : "달력에서 뺐어요");
    if (state.tab === "home") renderHome();
    return on;
  }
  /* 달력에 넣은 공고: 지금 자료에 있으면 그것(최신 마감일), 마감이 오늘 이후인 것만 */
  function calItems() {
    return cals.map(function (f) { return byId.get(f.id) || f; }).filter(function (it) { return it.e && it.e >= today; });
  }
  window.addEventListener("storage", function (e) {
    if (e.key === CAL_KEY) { cals = loadList(CAL_KEY); if (state.tab === "home") renderHome(); }
  });

  /* 공유 주소: 그 공고 상세로 바로 열리는 주소(지역 등 다른 조건은 넣지 않는다) */
  function shareUrl(item) {
    return location.origin + location.pathname + "#tab=" + (item.k === "s" ? "services" : "open") + "&id=" + encodeURIComponent(item.id);
  }

  /* ---------- 공유: 휴대폰은 공유 창(카톡 등), 안 되면 링크 복사 ---------- */
  function shareItem(item) {
    var url = shareUrl(item), data = { title: item.t, text: item.t + " | 지원모아", url: url };
    if (navigator.share) {
      navigator.share(data).catch(function (e) { if (e && e.name !== "AbortError") copyLink(url); });
    } else copyLink(url);
  }
  function copyLink(url) {
    function done() { toast("링크를 복사했어요"); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var t = el("textarea", { readonly: true, style: "position:fixed;opacity:0;top:0" });
      t.value = url;
      document.body.append(t);
      t.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("복사하지 못했습니다"); }
      t.remove();
    }
  }


  var scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { delete scripts[src]; s.remove(); reject(new Error(src)); };
        document.body.append(s);
      });
    }
    return scripts[src];
  }

  function ensureServices() {
    if (services) return Promise.resolve();
    return loadScript("data/services.js").then(function () {
      services = window.HUB_SERVICES || [];
      services.forEach(function (s) { byId.set(s.id, s); });
    });
  }

  function bucketOf(uid) {
    var sum = 0;
    for (var i = 0; i < uid.length; i++) sum += uid.charCodeAt(i);
    return sum % DETAIL_BUCKETS;
  }

  /* 공고 긴 글(개요·지원 대상·신청 방법·문의·원문 주소 등): 첫 화면을 빨리 그리려고 목록과 떼어 두고 뒤이어 읽는다.
   * 다 읽으면 공고에 붙이고 검색용 글(_h)을 다시 만든다. 파일이 없으면(예전 자료) 그냥 지나간다 */
  var noticeText = null, noticeTextReady = false;
  function ensureNoticeText() {
    if (!noticeText) {
      noticeText = loadScript("data/notices-text.js").then(function () {
        noticeTextReady = true;
        var T = window.HUB_NOTICE_TEXT || {};
        NOTICES.forEach(function (n) { if (T[n.id]) { Object.assign(n, T[n.id]); delete n._h; } });
        window.HUB_NOTICE_TEXT = null;
      }, function () { noticeTextReady = true; /* 없거나 못 읽음: 목록 자료만으로 보인다 */ });
    }
    return noticeText;
  }

  function ensureDetail(item) {
    if (item.k !== "s") {
      return ensureNoticeText().then(function () { return ensureFiles(item); });
    }
    return ensureFiles(item);
  }
  function ensureFiles(item) {
    // 상세 버킷에 든 것: 보조금24 제도의 상세 글, 공고문·첨부 파일이 있는 공고(fc)의 파일 목록
    if ((item.k !== "s" && !item.fc) || item._d) return Promise.resolve();
    var b = bucketOf(item.id);
    return loadScript("data/sd/" + (b < 10 ? "0" : "") + b + ".js").then(function () {
      Object.assign(item, (window.HUB_SD || {})[item.id] || {});
      item._d = true;
    });
  }

  /* ---------- 주소(#)에 상태 담기: 공유 링크와 뒤로 가기 ---------- */

  function defaultSort(s) {
    return s.tab === "services" ? "name" : "deadline";
  }

  function agriSelected() { return state.au.indexOf("농업인") >= 0; }

  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    var s = blankState();
    if (["home", "open", "services"].indexOf(p.get("tab")) >= 0) s.tab = p.get("tab");
    else s.tab = location.hash.length > 1 ? "open" : "home";
    s.q = p.get("q") || "";
    s.r = p.get("r") || "";
    s.nat = p.get("nat") !== "0";
    s.au = list(p.get("au"));
    s.st = list(p.get("st"));
    s.src = list(p.get("src"));
    s.tp = list(p.get("tp"));
    s.pv = p.get("pv") !== "0";
    s.soon = p.get("soon") === "1";
    s.due = /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(p.get("due") || "") ? p.get("due") : "";
    s.om = /^\d{4}-\d{2}$/.test(p.get("om") || "") ? p.get("om") : ""; // 접수를 시작한 달(홈 '공고는 언제 올라오나요?' 막대)
    s.nw = p.get("new") === "1";
    s.td = p.get("today") === "1"; // 마지막 수집에서 처음 들어온 공고(홈 '오늘 새 공고')
    // 내 조건: 주소에 있으면 그것(공유 링크), 없으면 이 기기에 기억한 것
    var me = cleanMe(p.has("age") || p.has("inc") || p.has("sex") ? { ag: p.get("age"), ic: p.get("inc"), sx: p.get("sex") } : loadMe());
    s.ag = me.ag; s.ic = me.ic; s.sx = me.sx;
    s.sp = list(p.get("sp"));
    s.cg = list(p.get("cat"));
    s.sort = ["deadline", "posted", "recent", "name"].indexOf(p.get("sort")) >= 0 ? p.get("sort") : defaultSort(s);
    s.id = p.get("id") || "";
    return s;
  }

  function writeHash(push) {
    var p = new URLSearchParams();
    var home = state.tab === "home";
    if (!home && state.q) p.set("q", state.q);
    if (state.r) p.set("r", state.r);
    if (!state.nat) p.set("nat", "0");
    if (!home) {
      ["au", "st", "src", "tp"].forEach(function (k) { if (state[k].length) p.set(k, state[k].join(",")); });
      if (!state.pv) p.set("pv", "0");
      if (state.soon) p.set("soon", "1");
      if (state.due) p.set("due", state.due);
      if (state.om) p.set("om", state.om);
      if (state.ag) p.set("age", state.ag);
      if (state.ic) p.set("inc", state.ic);
      if (state.sx) p.set("sex", state.sx);
      if (state.nw) p.set("new", "1");
      if (state.td) p.set("today", "1");
      if (state.sp.length && state.tab === "services") p.set("sp", state.sp.join(","));
      if (state.cg.length && state.tab !== "home") p.set("cat", state.cg.join(","));
      if (state.sort !== defaultSort(state)) p.set("sort", state.sort);
      if (state.id) p.set("id", state.id);
    }
    var rest = p.toString();
    var h = home && !rest ? "" : "tab=" + state.tab + (rest ? "&" + rest : "");
    var url = location.pathname + location.search + (h ? "#" + h : "");
    if (push && history.state && history.state.peek) push = false; // 요약 시트가 넣어 둔 기록 자리는 바꿔 쓴다
    try {
      if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
    } catch (e) { /* 일부 환경(file://)에서 막히면 주소만 못 바꾼다 */ }
  }

  /* ---------- 자료 고르기 ---------- */

  function isNoticeView() { return state.tab === "open"; }

  function dataset() {
    return state.tab === "services" ? services : NOTICES;
  }

  function inTab(item) {
    return statusOf(item) !== "마감";
  }

  /* 분야: 상시 제도는 보조금24 서비스분야(cat), 모집 공고는 출처 분류를 맞춘 분야(nf, build_site.py NOTICE_FIELDS) */
  function fieldOf(item) { return item.k === "s" ? item.cat : item.nf; }

  function haystack(item) {
    if (item._h === undefined) {
      // 분야 칩 이름(예: '스마트팜·기술')은 넣지 않는다. '스마트팜' 검색에 스마트공장이 걸리지 않게.
      item._h = [item.t, item.ag, item.op, item.cat, item.sm, item.tg].join(" ").toLowerCase();
    }
    return item._h;
  }

  function fitsMe(item) {
    if (state.ag && item.na && (+state.ag < item.na[0] || +state.ag > item.na[1])) return false;
    if (state.ic && item.ic) {
      var band = INCOME_BANDS.filter(function (b) { return b.v === state.ic; })[0];
      if (band && (band.hi < item.ic[0] || band.lo > item.ic[1])) return false;
    }
    if (state.sx && item.sx && item.sx !== state.sx) return false;
    return true;
  }
  function meLabel() {
    var band = INCOME_BANDS.filter(function (b) { return b.v === state.ic; })[0];
    return [state.ag ? state.ag + "세" : "", band ? (band.v === "50" ? band.label : "중위소득 " + band.label) : "",
      state.sx === "f" ? "여성" : state.sx === "m" ? "남성" : ""].filter(Boolean).join(" · ");
  }
  function saveMe() {
    try {
      if (state.ag || state.ic || state.sx) localStorage.setItem(ME_KEY, JSON.stringify({ ag: state.ag, ic: state.ic, sx: state.sx }));
      else localStorage.removeItem(ME_KEY);
    } catch (e) { /* 저장 못 해도 이번 화면에는 쓴다 */ }
  }

  function matches(item, terms, skipSoon) {
    if (!inTab(item)) return false;
    if (terms.length) {
      var h = haystack(item);
      for (var i = 0; i < terms.length; i++) if (h.indexOf(terms[i]) < 0) return false;
    }
    if (state.r) {
      var rg = item.rg || [];
      if (rg.indexOf(state.r) < 0 && !(state.nat && rg[0] === "전국")) return false;
    }
    if (state.au.length && !(item.pp || []).some(function (a) { return state.au.indexOf(a) >= 0; })) return false;
    if (!fitsMe(item)) return false;
    if (state.st.length && state.st.indexOf(statusOf(item)) < 0) return false;
    if (state.src.length && state.src.indexOf(item.src) < 0) return false;
    if (!state.pv && item.p) return false;
    if (agriSelected() && state.tp.length &&
        !(item.tp || []).some(function (t) { return state.tp.indexOf(t) >= 0; })) return false;
    if (!skipSoon && state.soon && isNoticeView() && !isSoon(item)) return false;
    if (state.nw && isNoticeView() && !postedWithin(item, RECENT_DAYS)) return false;
    if (state.td && isNoticeView() && !isTodayNew(item)) return false;
    if (state.sp.length && state.tab === "services" &&
        !(item.sp || []).some(function (x) { return state.sp.indexOf(x) >= 0; })) return false;
    if (state.cg.length && state.cg.indexOf(fieldOf(item)) < 0) return false;
    if (state.om && isNoticeView() && (item.s || item.e || "").slice(0, 7) !== state.om) return false;
    if (state.due && isNoticeView()) {
      var range = state.due.split("~");
      if (statusOf(item) !== "접수 중" || !item.e || item.e < range[0] || item.e > range[1]) return false;
    }
    return true;
  }

  function sortItems(items) {
    function byName(a, b) { return a.t.localeCompare(b.t, "ko"); }
    if (state.sort === "name") return items.sort(byName);
    if (state.sort === "posted") {
      return items.sort(function (a, b) { return (b.pd || "").localeCompare(a.pd || "") || byName(a, b); });
    }
    if (state.sort === "recent") {
      return items.sort(function (a, b) { return (b.up || "").localeCompare(a.up || "") || byName(a, b); });
    }
    // 마감 임박순: 마감일 있는 접수 중, 접수 예정, 소진 시까지, 상시, 나머지 순. 날짜 없는 것에 날짜를 만들지 않는다.
    var rankOf = { "접수 중": 0, "접수 예정": 1, "소진 시까지": 2, "상시": 3, "매월·분기 접수": 4, "매년 정기": 5,
      "사유 발생 후 신청": 6, "기관별로 다름": 7 };
    function rank(it) {
      var st = statusOf(it);
      if (st === "접수 중" && !it.e) return 2;
      return st in rankOf ? rankOf[st] : 8; // 확인 필요·신청 불필요는 맨 뒤
    }
    function key(it) { return rank(it) === 1 ? (it.s || "") : (it.e || ""); }
    return items.sort(function (a, b) {
      return rank(a) - rank(b) || key(a).localeCompare(key(b)) || byName(a, b);
    });
  }

  /* ---------- 배지와 문구 ---------- */

  function badge(text, cls) { return el("span", { className: "badge " + (cls || ""), text: text }); }

  function statusBadge(item) {
    var st = statusOf(item);
    // 오늘~D-3 빨강, D-7까지 주황, 그 밖은 가는 선
    if (st === "접수 중" && item.e) {
      var d = daysBetween(today, item.e);
      if (d === 0) return badge("오늘 마감", "urgent");
      return badge("D-" + d, d <= 3 ? "urgent" : d <= SOON_DAYS ? "soon" : "line");
    }
    if (st === "접수 예정") return badge("접수 예정", "line");
    if (st === "접수 중") return badge("접수 중", "line");
    if (st === "소진 시까지") return badge("예산 소진 시까지", "soft");
    if (st === "확인 필요") return badge("기간 확인 필요", "soft");
    return badge(st, "soft");
  }

  /* 목록 오른쪽에 붙는 날짜 한 줄 */
  function dateLine(item) {
    var st = statusOf(item);
    if (st === "접수 예정" && item.s) return fmtDate(item.s) + " 시작";
    if (item.py === "기간" && item.e) return fmtDate(item.e) + " 마감";
    return "";
  }

  function periodText(item, full) {
    if (item.py === "기간") {
      if (item.s && item.e) return fmtDate(item.s, full) + " ~ " + fmtDate(item.e, full);
      if (item.e) return "~ " + fmtDate(item.e, full);
    }
    var pt = (item.pt || "").trim();
    return full || pt.length <= 40 ? pt : pt.slice(0, 40) + "…";
  }

  function tagsOf(item) {
    return el("span", { className: "row-tags" },
      item.p ? badge("민간 주관", "line") : null,
      isNew(item) ? badge("신규", "new") : null);
  }

  /* ---------- 목록 ---------- */

  /* compact: 홈 목록용. 배지 줄과 기간 줄을 빼고 '민간 주관'은 기관 앞 글자로 붙여 줄 높이를 고르게 한다.
   * extra(올라온 날·조회수)는 기관·지역 줄 끝에 붙인다. 줄이 길면 기관 쪽이 줄고 extra는 늘 보인다 */
  function row(item, extra, compact) {
    var meta = [compact && item.p ? "민간 주관" : null, item.ag, regionText(item)].filter(Boolean).join(" · ");
    var metaLine = extra ? el("span", { className: "row-meta row-line" },
      meta ? el("span", { className: "row-line-main", text: meta }) : null,
      el("span", { className: "row-line-extra" + (meta ? " sep" : ""), text: extra }))
      : meta ? el("span", { className: "row-meta", text: meta }) : null;
    var sideDate = dateLine(item);
    var hit = el("button", { className: "row", type: "button", dataset: { id: item.id },
      "aria-current": state.id === item.id ? "true" : null },
      el("span", { className: "row-main" },
        compact ? null : tagsOf(item),
        el("span", { className: "row-title" }, item.t, el("i", { className: "ph ph-arrow-right row-arrow", "aria-hidden": "true" })),
        metaLine,
        // 날짜가 없는 사업 중 '매년 1월'처럼 기간 문구가 도움이 되는 경우만 한 줄 더 보여 준다
        !compact && !sideDate && item.pt && SHOW_PERIOD_TEXT.indexOf(statusOf(item)) >= 0
          ? el("span", { className: "row-meta", text: periodText(item) }) : null),
      el("span", { className: "row-side" },
        statusBadge(item),
        sideDate ? el("span", { className: "row-date", text: sideDate }) : null,
        el("span", { className: "row-src", text: SRC_NAME[item.src] })));
    if (isFav(item.id)) markFavRow(hit, true);
    return el("li", null, hit);
  }

  function skeleton() {
    var items = [];
    for (var i = 0; i < 6; i++) {
      items.push(el("li", { className: "skeleton", "aria-hidden": "true" },
        el("div", { className: "row" },
          el("span", { className: "row-main" }, el("span", { className: "bar w1" }), el("span", { className: "bar w2" })),
          el("span", { className: "row-side" }, el("span", { className: "bar w3" })))));
    }
    return items;
  }

  function showState(kind) {
    var box = $("#listState");
    box.className = "state" + (kind === "error" ? " error" : "");
    if (kind === "empty") {
      box.replaceChildren(icon("magnifying-glass"),
        el("p", { className: "state-title", text: "조건에 맞는 지원사업이 없습니다" }),
        activeFilterCount() ? el("button", { type: "button", className: "btn dark", dataset: { action: "reset" },
          text: "조건 모두 지우기" }) : null);
    } else if (kind === "error") {
      box.replaceChildren(icon("warning"),
        el("p", { className: "state-title", text: "자료를 불러오지 못했습니다" }),
        el("button", { type: "button", className: "btn dark", dataset: { action: "retry" } },
          icon("arrow-clockwise"), "다시 시도"));
    }
    box.hidden = !kind;
  }

  function renderList() {
    var data = dataset();
    var results = $("#results");
    var more = $("#more");
    renderActive();
    if (!data) {
      renderSoon(null);
      results.setAttribute("aria-busy", "true");
      results.replaceChildren.apply(results, skeleton());
      showState(null);
      $("#resultCount").textContent = "불러오는 중";
      more.hidden = true;
      ensureServices().then(function () {
        results.removeAttribute("aria-busy");
        setupFilters();
        renderList();
        renderDetail();
      }, function () {
        results.removeAttribute("aria-busy");
        results.replaceChildren();
        $("#resultCount").textContent = "";
        showState("error");
      });
      return;
    }
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length && state.tab !== "services" && !noticeTextReady) {
      // 검색어는 개요 글까지 찾으므로 긴 글이 온 뒤에 센다
      results.setAttribute("aria-busy", "true");
      results.replaceChildren.apply(results, skeleton());
      $("#resultCount").textContent = "불러오는 중";
      more.hidden = true;
      ensureNoticeText().then(function () { results.removeAttribute("aria-busy"); renderList(); });
      return;
    }
    var hits = sortItems(data.filter(function (it) { return matches(it, terms); }));
    renderSoon(terms);
    $("#resultCount").textContent = fmtN(hits.length) + "건";
    $("#filterDone").textContent = "결과 " + fmtN(hits.length) + "건 보기";
    results.replaceChildren.apply(results, hits.slice(0, shown).map(function (item) { return row(item); }));
    showState(hits.length ? null : "empty");
    more.hidden = hits.length <= shown;
    more.textContent = "더 보기 (" + fmtN(Math.min(shown, hits.length)) + " / " + fmtN(hits.length) + ")";
    updateFilterBadge();
  }

  /* '7일 안에 마감' 건수는 지금 고른 다른 조건(검색어·지역 등) 안에서 센다 */
  function renderSoon(terms) {
    var btn = $("#soonToggle");
    var data = dataset();
    if (!isNoticeView() || !data || !terms) { btn.hidden = true; return; }
    var n = data.filter(function (i) { return isSoon(i) && matches(i, terms, true); }).length;
    btn.querySelector(".n").textContent = fmtN(n);
    btn.setAttribute("aria-pressed", String(state.soon));
    btn.hidden = n === 0 && !state.soon;
  }

  /* 적용 중인 조건을 목록 위에 보여 주고, 하나씩 지울 수 있게 한다 */
  function renderActive() {
    var box = $("#activeFilters");
    var items = [];
    function add(label, clear) { items.push({ label: label, clear: clear }); }
    if (state.q) add("‘" + state.q + "’ 검색", function () { state.q = ""; });
    if (state.r) add(state.r + (state.nat ? " + 전국" : " 한정"), function () { state.r = ""; });
    if (state.ag || state.ic || state.sx) add("내 조건: " + meLabel(), function () { state.ag = state.ic = state.sx = ""; saveMe(); });
    if (state.soon && isNoticeView()) add("7일 안에 마감", function () { state.soon = false; });
    if (state.due && isNoticeView()) add(dueLabel(state.due), function () { state.due = ""; });
    if (state.om && isNoticeView()) add((+state.om.slice(5)) + "월 접수 시작", function () { state.om = ""; });
    if (state.nw && isNoticeView()) add("최근 " + RECENT_DAYS + "일 새 공고", function () { state.nw = false; });
    if (state.td && isNoticeView()) add(newDayLabel() + " 새 공고", function () { state.td = false; });
    state.cg.forEach(function (x) { add(x + " 분야", function () { remove("cg", x); }); });
    if (state.tab === "services") state.sp.forEach(function (x) { add(x + " 지원", function () { remove("sp", x); }); });
    state.au.forEach(function (a) {
      add(a, function () { remove("au", a); if (a === "농업인") state.tp = []; });
    });
    if (agriSelected()) state.tp.forEach(function (t) { add(t, function () { remove("tp", t); }); });
    state.st.forEach(function (s) { add(s, function () { remove("st", s); }); });
    state.src.forEach(function (s) { add(SRC_NAME[s], function () { remove("src", s); }); });
    if (!state.pv) add("민간 주관 제외", function () { state.pv = true; });

    box._clears = items.map(function (i) { return i.clear; });
    box.replaceChildren.apply(box, items.map(function (it, i) {
      return el("button", { type: "button", className: "chip", dataset: { clear: String(i) },
        "aria-label": it.label + " 조건 지우기" }, it.label, icon("x"));
    }).concat(items.length > 1 ? [el("button", { type: "button", className: "linkish", dataset: { action: "reset" },
      text: "모두 지우기" })] : []));
    box.hidden = !items.length;
  }

  function remove(key, value) {
    var i = state[key].indexOf(value);
    if (i >= 0) state[key].splice(i, 1);
  }

  /* ---------- 조건 ---------- */

  function countBy(items, fn) {
    var m = {};
    items.forEach(function (it) {
      [].concat(fn(it) || []).forEach(function (k) { m[k] = (m[k] || 0) + 1; });
    });
    return m;
  }

  function chips(container, key, options, counts) {
    container.replaceChildren.apply(container, options.map(function (o) {
      return el("button", { type: "button", className: "chip", dataset: { key: key, value: o.value },
        "aria-pressed": String(state[key].indexOf(o.value) >= 0) },
        o.label, counts ? el("span", { className: "n", text: fmtN(counts[o.value] || 0) }) : null);
    }));
  }

  function setupFilters() {
    var data = dataset();
    var base = data ? data.filter(inTab) : [];
    var ppCount = countBy(base, function (i) { return i.pp; });
    chips($("#aud"), "au", META.personas.filter(function (a) { return ppCount[a] || state.au.indexOf(a) >= 0; })
      .map(function (a) { return { value: a, label: a }; }), ppCount);

    var stCount = countBy(base, statusOf);
    chips($("#status"), "st", STATUS_ORDER.filter(function (s) { return stCount[s]; })
      .map(function (s) { return { value: s, label: s }; }), stCount);

    var srcCount = countBy(base, function (i) { return i.src; });
    var srcs = Object.keys(SRC_NAME).filter(function (s) { return srcCount[s]; });
    chips($("#src"), "src", srcs.map(function (s) { return { value: s, label: SRC_NAME[s] }; }), srcCount);
    $("#fsSrc").hidden = srcs.length < 2;

    setupTopics(base);
    var isSvc = state.tab === "services";
    $("#fsSupport").hidden = !isSvc;
    var cgCount = countBy(base, fieldOf);
    var fields = (isSvc ? META.serviceCats : META.noticeFields) || [];
    chips($("#cats"), "cg", fields.filter(function (x) { return cgCount[x] || state.cg.indexOf(x) >= 0; })
      .map(function (x) { return { value: x, label: x }; }), cgCount);
    $("#fsCat").hidden = !$("#cats").children.length;
    if (isSvc) {
      var spCount = countBy(base, function (i) { return i.sp; });
      chips($("#support"), "sp", META.supports.filter(function (x) { return spCount[x] || state.sp.indexOf(x) >= 0; })
        .map(function (x) { return { value: x, label: x }; }), spCount);
    }
    $("#privWrap").hidden = !base.some(function (i) { return i.p; });
    $("#listPane").setAttribute("aria-labelledby", "tab-" + state.tab);
    syncInputs();
  }

  /* 농업인을 고르면 농업 세부 분야 칩과 안내가 나타난다 */
  function setupTopics(base) {
    var on = agriSelected();
    $("#fsTopic").hidden = !on;
    $("#agriNote").hidden = !on;
    if (!on) return;
    base = base || (dataset() || []).filter(inTab);
    var tpCount = countBy(base.filter(function (i) { return (i.pp || []).indexOf("농업인") >= 0; }),
      function (i) { return i.tp; });
    chips($("#topics"), "tp", META.agriTopics.filter(function (t) { return tpCount[t] || state.tp.indexOf(t) >= 0; })
      .map(function (t) { return { value: t, label: t }; }), tpCount);
  }

  function syncInputs() {
    $("#q").value = state.q;
    $("#region").value = state.r;
    $("#withNational").checked = state.nat;
    $("#withNational").closest("label").hidden = !state.r;
    $("#priv").checked = state.pv;
    $("#sort").value = state.sort;
    document.querySelectorAll("#filters .chip[data-key]").forEach(function (c) {
      c.setAttribute("aria-pressed", String(state[c.dataset.key].indexOf(c.dataset.value) >= 0));
    });
    if (document.activeElement !== $("#meAge")) $("#meAge").value = state.ag;
    $("#meInc").value = state.ic;
    document.querySelectorAll("#meSex button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.sx === state.sx)); });
    $("#meClear").hidden = !(state.ag || state.ic || state.sx);
    document.querySelectorAll("[role=tab]").forEach(function (t) {
      var on = t.dataset.tab === state.tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
  }

  function activeFilterCount() {
    return (state.q ? 1 : 0) + (state.r ? 1 : 0) + state.au.length + state.st.length + state.src.length +
      (state.pv ? 0 : 1) + (agriSelected() ? state.tp.length : 0) + (state.soon ? 1 : 0) + (state.due ? 1 : 0) + (state.om ? 1 : 0) + (state.nw ? 1 : 0) + (state.td ? 1 : 0) +
      (state.ag || state.ic || state.sx ? 1 : 0) +
      state.cg.length + (state.tab === "services" ? state.sp.length : 0);
  }

  /* 좁은 화면의 '조건' 버튼에는 조건 창 안에서 고른 것만 센다 */
  function updateFilterBadge() {
    var n = state.au.length + state.st.length + state.src.length + (state.pv ? 0 : 1) + (state.ag || state.ic || state.sx ? 1 : 0) +
      (agriSelected() ? state.tp.length : 0) + state.cg.length + (state.tab === "services" ? state.sp.length : 0);
    var b = $("#filterBadge");
    b.hidden = !n;
    b.textContent = n;
  }

  function changed(push) {
    shown = PAGE;
    syncInputs();
    renderList();
    writeHash(push);
  }

  function resetFilters() {
    state = blankState({ tab: state.tab, id: state.id });
    saveMe(); // '조건 지우기'는 기억한 내 조건도 지운다
    setupTopics();
    state.sort = defaultSort(state);
    changed(false);
  }

  /* ---------- 상세 ---------- */

  function section(title, text) {
    if (!text) return null;
    return el("section", null, el("h3", { text: title }), el("p", { className: "pre", text: text }));
  }

  /* 문의: 전화번호는 누르면 바로 걸리게(tel:), 메일 주소는 메일 쓰기(mailto:). 보조금24는 '기관/번호||기관/번호' 꼴이라
   * 한 줄에 한 곳씩 나눈다. 1350·129 같은 짧은 대표번호는 '/' 바로 뒤에 혼자 있을 때만 번호로 본다(다른 숫자와 헷갈리지 않게) */
  var PHONE_RE = /(?:0\d{1,2}[-.) ]?\d{3,4}[-. ]?\d{4}|1[5-9]\d{2}-?\d{4})|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  function contactLine(text) {
    var p = el("p", { className: "contact-line" }), last = 0, m;
    // 보조금24의 '기관/번호' 빗금은 사이 점으로(주소의 // 는 그대로)
    text = text.replace(/([^:\/])\s*\/\s*(?!\/)/g, "$1 · ").replace(/\s+·\s*$/, "");
    var short = /^(.*· )\s*(1\d{2,3})\s*$/.exec(text);
    if (short) {
      p.append(short[1], el("a", { className: "tel", href: "tel:" + short[2] }, icon("phone"), short[2]));
      return p;
    }
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(text))) {
      var before = text.charAt(m.index - 1), after = text.charAt(m.index + m[0].length);
      if (/\d/.test(before) || /\d/.test(after)) continue; // 더 긴 숫자의 일부(날짜·금액 등)는 건너뛴다
      p.append(text.slice(last, m.index));
      if (m[0].indexOf("@") > 0) p.append(el("a", { className: "tel", href: "mailto:" + m[0] }, icon("envelope-simple"), m[0]));
      else p.append(el("a", { className: "tel", href: "tel:" + m[0].replace(/[^\d]/g, "") }, icon("phone"), m[0]));
      last = m.index + m[0].length;
    }
    p.append(text.slice(last));
    return p;
  }
  function contactSection(text) {
    if (!text) return null;
    var box = el("section", { className: "contact" }, el("h3", { text: "문의" }));
    String(text).split(/\|\||\n/).map(function (t) { return t.trim(); }).filter(Boolean)
      .forEach(function (t) { box.append(contactLine(t)); });
    return box;
  }

  // 기업마당 공고문·첨부 파일 [이름, 주소, 공고문이면 1]. 파일은 출처 서버에서 바로 내려받는다
  var FILE_ICON = { pdf: "file-pdf", zip: "file-zip", hwp: "file-text", hwpx: "file-text", doc: "file-doc", docx: "file-doc",
    odt: "file-doc", xls: "file-xls", xlsx: "file-xls", png: "file-image", jpg: "file-image", jpeg: "file-image" };
  function fileSection(files) {
    var links = (files || []).map(function (f) {
      var href = safeUrl(f[1]);
      if (!href) return null;
      var ext = (/\.([a-z0-9]+)$/i.exec(f[0] || "") || [])[1];
      ext = ext ? ext.toLowerCase() : "";
      return el("li", null, el("a", { className: "file", href: href, target: "_blank", rel: "noopener" },
        icon(FILE_ICON[ext] || "file"),
        el("span", { className: "file-name", text: f[0] || "첨부 파일" }),
        f[2] ? badge("공고문", "soft") : null,
        icon("download-simple")));
    }).filter(Boolean);
    if (!links.length) return null;
    var list = el("ul", { className: "files" });
    list.append.apply(list, links);
    return el("section", null, el("h3", { text: "공고문·첨부 파일" }), list);
  }

  function lastRun(src) {
    var r = (META.runs || []).filter(function (x) { return x.src === src; })[0];
    return r ? fmtStamp(r.at) : "";
  }

  function renderGuide() {
    var sources = el("dl");
    Object.keys(SRC_NAME).forEach(function (s) {
      var run = (META.runs || []).filter(function (x) { return x.src === s; })[0];
      sources.append(el("dt", { text: SRC_NAME[s] }),
        el("dd", { text: fmtN((META.bySource || {})[s] || 0) + "건" }),
        el("dd", { text: run ? fmtStamp(run.at) + (run.ok ? "" : " 수집 실패") : "" }));
    });
    return el("div", { className: "guide" }, el("h2", { text: "출처별 자료" }), sources);
  }

  function renderDetail() {
    var pane = $("#detail");
    if (!state.id) {
      pane.replaceChildren(renderGuide());
      document.body.classList.remove("detail-open", "lock");
      document.title = SITE_TITLE;
      return;
    }
    var item = byId.get(state.id);
    if (!item) {
      if (/^gov24:/.test(state.id) && !services) {
        ensureServices().then(renderDetail, function () { toast("자료를 불러오지 못했습니다"); });
        return;
      }
      pane.replaceChildren(detailBar(), el("div", { className: "detail-inner" },
        el("p", { text: "지금 목록에 없는 지원사업입니다." })));
      openOverlay();
      return;
    }
    ensureDetail(item).then(function () { drawDetail(item); }, function () { drawDetail(item); });
  }

  function detailBar() {
    return el("div", { className: "detail-bar narrow-only" },
      el("button", { type: "button", className: "iconbtn", dataset: { action: "close" } },
        icon("arrow-left"), "목록으로"));
  }

  function drawDetail(item) {
    var pane = $("#detail");
    var st = statusOf(item);
    var dday = st === "접수 중" && item.e ? daysBetween(today, item.e) : null;
    var url = sourceUrl(item);
    var apply = safeUrl(item.ap);

    var facts = el("dl", { className: "facts" });
    function fact(label, value, small) {
      if (!value) return;
      facts.append(el("dt", { text: label }), el("dd", null, value, small ? el("br") : null,
        small ? el("small", { text: small }) : null));
    }
    var period = periodText(item, true);
    if (dday !== null) period += dday === 0 ? ", 오늘 마감" : ", 마감까지 " + dday + "일";
    fact("신청기간", period || "원문 확인",
      item.py === "기간" && item.pt && !/^\d/.test(item.pt) ? "원문 표기: " + item.pt : null);
    // 국고보조금 공모의 지역은 수행기관 주소라 실제 신청 지역과 다를 수 있다
    fact("지역", regionText(item, true), item.rb === "수행기관 소재지" ? "수행기관 소재지 기준" : null);
    fact("대상", ((item.pp && item.pp.length ? item.pp : item.au) || []).join(", "));
    fact("소관", item.ag);
    fact("수행", item.op && item.op !== item.ag ? item.op : "");
    fact("분야", item.cat);
    fact("지원 방식", (item.sp || []).join(", "));
    if (item.a) fact("농업 분야", (item.tp || []).join(", "));
    // 출처가 따로 준 조건(나이·소득·창업 기간·사업 예산 등). [이름, 값, 덧붙임]
    (item.cd || []).forEach(function (c) { fact(c[0], c[1], c[2] || null); });

    var actions = el("div", { className: "actions" },
      // 노랑은 화면마다 한 곳, 가장 중요한 행동(원문 보기)에만 쓴다
      url ? el("a", { className: "btn yellow", href: url, target: "_blank", rel: "noopener" },
        SRC_LINK[item.src], icon("arrow-square-out")) : null,
      apply && apply !== url ? el("a", { className: "btn dark", href: apply, target: "_blank", rel: "noopener" },
        "신청 페이지", icon("arrow-square-out")) : null);

    // 관심 담기(검정 = 고른 상태) · 마감일 달력에 넣기(접수 중·예정이고 마감일이 있을 때) · 공유
    var favBtn = el("button", { type: "button", className: "btn gray tool fav-btn", "aria-pressed": String(isFav(item.id)) });
    function paintFav() {
      var on = isFav(item.id);
      favBtn.setAttribute("aria-pressed", String(on));
      favBtn.replaceChildren(starIcon(on), on ? "관심 담음" : "관심 담기");
    }
    paintFav();
    favBtn.addEventListener("click", function () { toggleFav(item); paintFav(); });
    // 마감일이 오늘 이후인 접수 중·예정 공고는 홈 '언제 마감되나요?' 달력에 넣을 수 있다
    var canCal = item.e && item.e >= today && (st === "접수 중" || st === "접수 예정");
    var calBtn = null;
    if (canCal) {
      calBtn = el("button", { type: "button", className: "btn gray tool cal-btn" });
      var paintCal = function () {
        var on = inCal(item.id);
        calBtn.setAttribute("aria-pressed", String(on));
        calBtn.replaceChildren(icon(on ? "calendar-check" : "calendar-plus"), on ? "달력에 넣음 · " + fmtDate(item.e) : "마감일 달력에 추가");
      };
      paintCal();
      calBtn.addEventListener("click", function () { toggleCal(item); paintCal(); });
    }
    var shareBtn = el("button", { type: "button", className: "btn gray tool" }, icon("share-network"), "공유");
    shareBtn.addEventListener("click", function () { shareItem(item); });
    var printBtn = el("button", { type: "button", className: "btn gray tool wide-only-print" }, icon("printer"), "인쇄");
    printBtn.addEventListener("click", function () { window.print(); });
    var tools = el("div", { className: "actions tools" }, favBtn, calBtn, shareBtn, printBtn);
    var ch = changeOf(item.id), changeNote = null;
    if (ch) {
      var ok = el("button", { type: "button", className: "btn gray" }, "확인했어요");
      changeNote = el("div", { className: "change-note", role: "status" }, icon("bell-ringing"), el("span", { text: ch.note }), ok);
      ok.addEventListener("click", function () {
        ackChange(item.id);
        changeNote.remove();
        if (state.tab === "home") renderHome();
      });
    }

    var head = el("div", { className: "row-tags" }, statusBadge(item));
    head.append.apply(head, Array.prototype.slice.call(tagsOf(item).childNodes));
    head.append(badge(SRC_NAME[item.src], "line"));

    var inner = el("div", { className: "detail-inner" },
      head,
      el("h2", { id: "detailTitle", tabindex: "-1", text: item.t }),
      changeNote,
      facts,
      actions,
      tools,
      section("지원 대상", item.tg),
      // 보조금24는 상세의 서비스 목적 전문(pu)이 있으면 그것, 없으면 목록의 요약(sm)
      section(item.k === "s" ? "서비스 목적" : "사업 개요", item.pu || item.sm),
      section("지원 내용", item.ct),
      section("신청 방법", item.how));
    // 출처가 따로 준 글(선정 기준·구비 서류·신청 제외 대상 등). [제목, 글]
    (item.dt || []).forEach(function (d) { inner.append(section(d[0], d[1]) || ""); });
    inner.append(fileSection(item.fl) || "", contactSection(item.cn) || "",
      el("p", { className: "caution", text: lastRun(item.src) + " 수집, 원문 일부 발췌. 신청 전에 원문을 확인하세요." }),
      similarSection(item) || "",
      // 인쇄할 때만 보이는 꼬리: 어디서 뽑았는지와 다시 볼 주소
      el("p", { className: "print-only print-foot", text: "지원모아 " + shareUrl(item) + " · " + fmtDate(today, true) + " 인쇄" }));
    pane.replaceChildren(detailBar(), inner);
    pane.scrollTop = 0;
    document.title = item.t + " | " + SITE_TITLE;
    openOverlay();
  }

  /* 비슷한 지원사업 3건: 같은 종류(공고/제도)에서 분야 같음 +3, 겹치는 대상마다 +2, 같은 지방 지역 +3(전국은 +1),
   * 제도는 지원 방식 겹치면 +1, 공고는 날짜 있는 접수 중·예정이면 +1(기간 확인 필요는 -1).
   * 지금 신청할 수 있는 것만, 제목이 같은 것(다른 지역 재게시 등)은 하나만. 같은 점수면 조회수 */
  function similarItems(item, n) {
    var pool = item.k === "s" ? (services || []) : NOTICES;
    var pp = item.pp || [], rg = item.rg || [], sp = item.sp || [];
    var local = rg.filter(function (r) { return r !== "전국"; });
    var seen = {};
    seen[item.t] = 1;
    var scored = [];
    pool.forEach(function (o) {
      if (o.id === item.id || statusOf(o) === "마감") return;
      var sc = 0;
      if (fieldOf(o) && fieldOf(o) === fieldOf(item)) sc += 3;
      (o.pp || []).forEach(function (p) { if (pp.indexOf(p) >= 0) sc += 2; });
      var org = o.rg || [];
      if (local.length && org.some(function (r) { return local.indexOf(r) >= 0; })) sc += 3;
      else if (org[0] === "전국") sc += 1;
      if (item.k === "s") (o.sp || []).forEach(function (x) { if (sp.indexOf(x) >= 0) sc += 1; });
      else {
        var st = statusOf(o);
        if ((st === "접수 중" || st === "접수 예정") && o.e) sc += 1;
        else if (st === "확인 필요") sc -= 1;
      }
      if (sc >= 5) scored.push({ o: o, sc: sc });
    });
    scored.sort(function (a, b) { return b.sc - a.sc || (b.o.vw || 0) - (a.o.vw || 0) || a.o.t.localeCompare(b.o.t, "ko"); });
    var out = [];
    for (var i = 0; i < scored.length && out.length < (n || 3); i++) {
      var key = scored[i].o.t.replace(/\s+/g, "");
      if (seen[key] || seen[scored[i].o.t]) continue;
      seen[key] = 1;
      out.push(scored[i].o);
    }
    return out;
  }
  function similarSection(item) {
    var items = similarItems(item, 3);
    if (!items.length) return null;
    var ul = el("ul", { className: "results similar" });
    items.forEach(function (o) { ul.append(row(o, null, true)); });
    ul.addEventListener("click", function (e) {
      var b = e.target.closest(".row[data-id]");
      if (b) { lastRowFocus = null; state.id = b.dataset.id; writeHash(true); renderDetail(); }
    });
    return el("section", { className: "similar-box" },
      el("h3", { text: item.k === "s" ? "비슷한 상시 제도" : "비슷한 모집 공고" }), ul);
  }

  function narrow() { return window.matchMedia("(max-width: 1099px)").matches; }

  function openOverlay() {
    document.body.classList.add("detail-open");
    if (narrow()) {
      document.body.classList.add("lock");
      var h = $("#detailTitle") || $("#detail");
      h.focus({ preventScroll: true });
    }
  }

  function openDetail(id, rowButton) {
    lastRowFocus = rowButton || null;
    state.id = id;
    document.querySelectorAll(".row[aria-current]").forEach(function (b) { b.removeAttribute("aria-current"); });
    if (rowButton) rowButton.setAttribute("aria-current", "true");
    writeHash(true);
    renderDetail();
  }

  function closeDetail() {
    state.id = "";
    writeHash(false);
    renderDetail();
    document.querySelectorAll(".row[aria-current]").forEach(function (b) { b.removeAttribute("aria-current"); });
    if (lastRowFocus && document.body.contains(lastRowFocus)) lastRowFocus.focus();
  }

  /* ---------- 탭·기준 문구 ---------- */

  function renderBasis() {
    var runs = META.runs || [];
    var at = runs.map(function (r) { return r.at; }).sort().pop() || META.builtAt;
    var basis = $("#basisShort");
    basis.replaceChildren(fmtStamp(at) + " 수집");
    $("#footRun").textContent = "매일 오전 6시 30분 공공 API에서 새로 모읍니다 · 마지막 수집 " + fmtStamp(at);
    var failed = runs.filter(function (r) { return !r.ok; });
    if (failed.length) {
      basis.append(" ", el("span", { className: "warn", text: failed.map(function (r) { return SRC_NAME[r.src]; })
        .join(", ") + " 수집 실패, 이전 자료 표시" }));
    }
  }

  /* ---------- 하단: 이용 안내·개인정보 안내 창, 맨 위로 ---------- */
  var INFO = {
    guide: { title: "이용 안내", body: function () {
      var counts = META.counts || {};
      var open = NOTICES.filter(function (n) { return statusOf(n) !== "마감"; }).length;
      return [
        ["무엇을 모으나요", "기업마당·K-Startup·국고보조금(보조금 통합포털)의 모집 공고와 보조금24의 상시 제도를 매일 오전 6시 30분에 공공데이터포털 API로 모읍니다. 지금 모집 공고 " +
          fmtN(open) + "건, 상시 제도 " + fmtN(counts.services || 0) + "건이 있습니다."],
        ["모집 공고와 상시 제도", "모집 공고는 신청 기간이 정해진 공고, 상시 제도는 언제든 신청할 수 있는 보조금24의 제도입니다. 둘을 합쳐 '지원사업'이라고 부릅니다."],
        ["찾는 방법", "홈에서 지역·대상을 고르거나 검색하세요. 목록의 '조건'에서 대상·분야·신청 상태·내 조건(나이·소득·성별)으로 좁힐 수 있습니다. 홈 그래프의 막대·칸·지역을 누르면 요약이 먼저 뜹니다."],
        ["챙겨 두기", "상세 화면의 '관심 담기'는 홈 맨 위에, '마감일 달력에 추가'는 홈 마감 달력에 표시됩니다. 담은 뒤 마감일이 바뀌면 알려 드립니다."],
        ["꼭 확인하세요", "화면의 글은 원문 일부를 옮긴 것입니다. 신청 자격·기간·서류는 반드시 각 기관의 원문 공고에서 확인하세요."]
      ];
    } },
    privacy: { title: "개인정보 안내", body: function () {
      return [
        ["받는 정보", "지원모아는 가입·로그인이 없고, 이름·연락처 같은 개인정보를 받거나 서버에 보관하지 않습니다."],
        ["이 기기에만 저장하는 것", "관심 담기, 마감일 달력, 내 조건(나이·소득 구간·성별), 글자 크기·버튼 소리 설정은 지금 쓰는 브라우저 안(localStorage)에만 저장되고 서버로 보내지 않습니다. 다른 기기나 브라우저와는 이어지지 않습니다."],
        ["지우는 방법", "관심·달력은 각 단추로 빼고, 내 조건은 목록 '조건'의 '지우기'나 '조건 지우기'로 지웁니다. 브라우저의 방문 기록·사이트 데이터를 지워도 모두 사라집니다."],
        ["주소에 담기는 것", "고른 조건은 공유할 수 있게 주소의 # 뒤에 담깁니다. 이 부분은 서버로 보내지지 않지만, 나이·소득 조건이 든 주소를 다른 사람에게 보내면 그 조건도 함께 보입니다."],
        ["접속 기록·외부 연결", "이 사이트 서버는 방문 기록을 따로 저장하지 않고, 쿠키나 방문 분석 도구도 쓰지 않습니다. 다만 글꼴과 아이콘을 외부 배포 서버(jsDelivr)에서 받아 오므로, 그 과정에서 해당 업체가 일반적인 접속 정보(IP 주소 등)를 볼 수 있습니다. 원문 보기·파일 받기를 누르면 각 기관 사이트로 이동합니다."]
      ];
    } }
  };
  var infoOpener = null;
  function openInfo(kind, opener) {
    var d = $("#infoDialog"), spec = INFO[kind];
    if (!d || !spec) return;
    infoOpener = opener || null;
    $("#infoTitle").textContent = spec.title;
    var body = $("#infoBody");
    body.replaceChildren.apply(body, spec.body().map(function (p) {
      return el("section", null, el("h3", { text: p[0] }), el("p", { text: p[1] }));
    }));
    body.scrollTop = 0;
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    $("#infoTitle").focus({ preventScroll: true }); // 닫기 단추에 초점 테두리가 먼저 뜨지 않게 제목에서 시작
    document.body.classList.add("info-lock");
  }
  function bindFooter() {
    var d = $("#infoDialog");
    document.querySelectorAll(".foot-menu-btn, .sn-more").forEach(function (b) {
      b.addEventListener("click", function () { openInfo(b.dataset.info, b); });
    });
    $("#infoClose").addEventListener("click", function () { d.close ? d.close() : d.removeAttribute("open"); });
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); }); // 창 밖(뒤판) 누르면 닫기
    d.addEventListener("close", function () {
      document.body.classList.remove("info-lock");
      if (infoOpener) infoOpener.focus({ preventScroll: true });
    });
    // 맨 위로: 화면 높이의 1.5배 넘게 내려가면 보인다(요약 시트·상세 겹침 화면이 열려 있으면 숨김은 CSS)
    var top = $("#toTop"), ticking = false;
    function check() { ticking = false; top.hidden = window.scrollY < window.innerHeight * 1.5; }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
    function goTop() {
      var smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      var t = document.querySelector("[role=tab][aria-selected=true]");
      if (t) t.focus({ preventScroll: true });
    }
    top.addEventListener("click", goTop);
    $("#footUp").addEventListener("click", goTop);
    // 하단 마지막 줄이 화면에 들어오면 떠 있는 단추를 숨긴다(마지막 줄 끝에 '맨 위로'가 있다)
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        document.body.classList.toggle("foot-seen", es[es.length - 1].isIntersecting);
      }).observe(document.querySelector(".foot-last"));
    }
    check();
  }

  function renderTabCounts() {
    var open = NOTICES.filter(function (n) { return statusOf(n) !== "마감"; }).length;
    var c = META.counts;
    var set = { open: open, services: c.services };
    document.querySelectorAll("[role=tab]").forEach(function (t) {
      var span = t.querySelector(".tab-count");
      if (span) span.textContent = fmtN(set[t.dataset.tab]);
    });
  }

  function switchTab(tab) {
    if (tab === state.tab) return;
    state = Object.assign({}, state, { tab: tab, st: [], src: [], sp: [], cg: [], soon: false, nw: false, td: false, due: "", om: "", id: "" });
    state.sort = defaultSort(state);
    applyView();
    if (tab === "home") {
      seenCards = {}; // 다른 탭에서 돌아오면 그래프가 처음처럼 다시 움직인다
      renderHome();
      renderDetail();
      writeHash(false);
      return;
    }
    setupFilters();
    changed(false);
    renderDetail();
  }

  /* ---------- 홈 ---------- */

  function applyView() {
    var home = state.tab === "home";
    $("#homePane").hidden = !home;
    $("#listLayout").hidden = home;
    document.querySelectorAll("[role=tab]").forEach(function (t) {
      var on = t.dataset.tab === state.tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
  }

  /* 홈에서 목록으로 넘어갈 때: 홈에서 고른 지역은 그대로 들고 간다 */
  function goTo(partial) {
    $("#vizTip").hidden = true;
    closePeek(false, true);
    state = Object.assign(blankState({ r: state.r, nat: state.nat, ag: state.ag, ic: state.ic, sx: state.sx }), partial);
    state.sort = partial.sort || defaultSort(state);
    shown = PAGE;
    applyView();
    setupFilters();
    renderList();
    renderDetail();
    writeHash(true);
    window.scrollTo(0, 0);
  }

  function inRegion(item) {
    if (!state.r) return true;
    var rg = item.rg || [];
    return rg.indexOf(state.r) >= 0 || (state.nat && rg[0] === "전국");
  }

  /* 상시 제도 건수는 build_site.py가 미리 센 값을 쓴다(홈에서 큰 목록을 읽지 않으려고) */
  function svcCount(key) {
    var svc = META.svc;
    if (!state.r) return svc.total[key];
    return ((svc.region[state.r] || {})[key] || 0) + (state.nat ? svc.national[key] : 0);
  }

  /* 숫자 타일 아래 눈금 막대: 전체(of) 가운데 이 숫자가 차지하는 몫을 40칸 중 칠한 칸으로 보인다.
   * 막대는 홈을 처음 그릴 때만 자라난다(지역을 바꿔 다시 그릴 때는 칸 수만 바뀐다) */
  var STAT_TICKS = 40, statsGrown = false;
  function statTile(num, label, iconName, onClick, tone, of, ofLabel) {
    var mark = icon(iconName);
    mark.classList.add("tone-" + tone);
    var share = of > 0 ? num / of : 0;
    var on = num > 0 ? Math.max(1, Math.round(share * STAT_TICKS)) : 0;
    var pct = of > 0 ? (share < 0.01 && num > 0 ? "1% 미만" : Math.round(share * 100) + "%") : "";
    var ticks = el("span", { className: "stat-ticks tone-" + tone, "aria-hidden": "true" });
    for (var i = 0; i < STAT_TICKS; i++) ticks.append(el("i", { className: i < on ? "on" : "", style: "--i:" + i }));
    var b = el("button", { type: "button", className: "stat", "aria-label": label + " " + fmtN(num) + "건, " + ofLabel + " " + fmtN(of) + "건 중 " + pct },
      el("span", { className: "stat-num", text: fmtN(num) }),
      el("span", { className: "stat-label" }, mark, label, icon("arrow-right")),
      el("span", { className: "stat-of" }, el("span", null, el("span", { className: "of-what", text: ofLabel + " " }), fmtN(of) + "건 중"), el("span", { text: pct })),
      ticks);
    b.addEventListener("click", onClick);
    return b;
  }

  function goChip(label, n, partial) {
    var b = el("button", { type: "button", className: "chip" }, label,
      n === null ? null : el("span", { className: "n", text: fmtN(n) }));
    b.addEventListener("click", function () { goTo(partial); });
    return b;
  }

  function renderHome() {
    var live = NOTICES.filter(function (n) { return statusOf(n) !== "마감" && inRegion(n); });
    var byStatus = countBy(live, statusOf);
    var runs = META.runs || [];
    var at = runs.map(function (r) { return r.at; }).sort().pop() || META.builtAt;

    $("#homeTitle").replaceChildren((state.r ? state.r + "에서 " : "") + "지금 신청할 수 있는 모집 공고 ",
      el("strong", { text: fmtN(live.length) }), "건");
    $("#homeSub").textContent = fmtStamp(at) + " 수집 · 상시 제도는 따로 셈";
    var todayN = live.filter(isTodayNew).length;
    var tn = $("#homeTodayNew");
    tn.hidden = !todayN;
    tn.replaceChildren(el("span", { className: "badge new", text: "NEW" }),
      newDayLabel() + " 새로 올라온 공고 ", el("strong", { text: fmtN(todayN) + "건" }), icon("arrow-right"));
    // 오늘 마감: 접수 중이고 마감일이 오늘인 공고(고른 지역 기준). 목록 조건은 마감 달력과 같은 due=오늘~오늘
    var dueN = live.filter(function (n) { return statusOf(n) === "접수 중" && n.e === today; }).length;
    var td = $("#homeTodayDue");
    td.hidden = !dueN;
    td.replaceChildren(el("span", { className: "badge urgent", text: "D-DAY" }),
      "오늘 마감인 공고 ", el("strong", { text: fmtN(dueN) + "건" }), icon("arrow-right"));
    $("#homeTodayRow").hidden = !todayN && !dueN;

    var svcN = svcCount("all");
    $("#homeStats").replaceChildren(
      statTile(live.filter(isSoon).length, "7일 안에 마감", "clock",
        function () { goTo({ tab: "open", soon: true }); }, "red", live.length, "모집 공고"),
      statTile(byStatus["접수 예정"] || 0, "접수 예정", "calendar-check",
        function () { goTo({ tab: "open", st: ["접수 예정"] }); }, "blue", live.length, "모집 공고"),
      statTile(byStatus["소진 시까지"] || 0, "예산 소진 시까지", "hourglass-medium",
        function () { goTo({ tab: "open", st: ["소진 시까지"] }); }, "blue", live.length, "모집 공고"),
      statTile(svcN, "상시 제도", "hand-heart",
        function () { goTo({ tab: "services" }); }, "green", live.length + svcN, "전체 지원사업"));
    if (!statsGrown) { $("#homeStats").classList.add("grow"); statsGrown = true; }
    else $("#homeStats").classList.remove("grow");

    renderFavs();
    renderHomeLists(live);

    renderCharts(live);

    // 대상을 누르면 그 대상 사업이 더 많은 쪽(모집 공고/상시 제도) 목록으로 간다. 대상 조건은 탭을 옮겨도 남는다
    var ppN = countBy(live, function (i) { return i.pp; });
    var who = $("#homeWho");
    who.replaceChildren.apply(who, META.personas.map(function (p) {
      var n = ppN[p] || 0, s = svcCount(p) || 0;
      return goChip(p, n + s, { tab: n >= s ? "open" : "services", au: [p] });
    }));

    $("#homeRegion").value = state.r;
    $("#homeNat").checked = state.nat;
    $("#homeNat").closest("label").hidden = !state.r;
    document.title = SITE_TITLE;
    placeSegGliders();
  }

  function fillList(box, rows, emptyText) {
    if (rows.length) box.replaceChildren.apply(box, rows);
    else box.replaceChildren(el("li", { className: "list-empty", text: emptyText }));
  }

  /* 홈 목록: 처음 5개, 바닥 '더 보기'를 누를 때마다 10개씩(곧 열릴 수 있는 공모와 같게) */
  var HOME_FIRST = 5, HOME_STEP = 10;
  var homeShown = { soon: HOME_FIRST, fresh: HOME_FIRST, pop: HOME_FIRST };
  function homeList(key, box, moreBtn, items, makeRow, emptyText) {
    fillList(box, items.slice(0, homeShown[key]).map(function (n) { return makeRow(n); }), emptyText);
    var rest = items.length - homeShown[key];
    moreBtn.hidden = rest <= 0;
    moreBtn.textContent = "더 보기 (" + fmtN(rest) + "건 더)";
    fitListHeight(box, items.length > HOME_FIRST, WIDE_LISTS);
  }

  /* 넓은 화면에서 '더 보기'로 목록이 길어지면 옆 칸이 함께 늘어나 빈 곳이 생긴다.
   * 그래서 목록 칸을 처음 5줄 높이로 고정하고, 더 붙은 줄은 칸 안에서 스크롤한다(좁은 화면은 그대로 늘어남) */
  var WIDE_LISTS = "(min-width: 1100px)", WIDE_CHARTS = "(min-width: 900px)";
  function fitListHeight(ul, expandable, query) {
    ul.style.maxHeight = "";
    ul.classList.remove("scroll-list");
    if (!expandable || !window.matchMedia(query).matches) return;
    var h = Array.prototype.slice.call(ul.children, 0, HOME_FIRST)
      .reduce(function (t, li) { return t + li.getBoundingClientRect().height; }, 0);
    if (!h) return; // 홈이 가려져 있어 잴 수 없을 때
    ul.style.maxHeight = Math.ceil(h + (parseFloat(getComputedStyle(ul).borderTopWidth) || 0)) + "px";
    ul.classList.add("scroll-list");
  }

  /* 더 보기 뒤: 스크롤 위치를 되살린 뒤 새로 붙은 첫 줄까지 내린다. 단추가 사라졌으면 그 줄에 초점 */
  function revealNew(ul, index, oldTop, moreBtn) {
    var li = ul.children[index];
    if (ul.classList.contains("scroll-list") && li) {
      ul.scrollTop = oldTop;
      var top = ul.scrollTop + li.getBoundingClientRect().top - ul.getBoundingClientRect().top -
        (parseFloat(getComputedStyle(ul).borderTopWidth) || 0);
      var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      ul.scrollTo({ top: top, behavior: calm ? "auto" : "smooth" });
    }
    if (moreBtn && !moreBtn.hidden) moreBtn.focus({ preventScroll: true });
    else if (li && li.querySelector("button")) li.querySelector("button").focus({ preventScroll: true });
  }

  function homeLive() {
    return NOTICES.filter(function (n) { return statusOf(n) !== "마감" && inRegion(n); });
  }

  function renderHomeLists(live) {
    var soon = live.filter(function (n) { return statusOf(n) === "접수 중" && n.e; })
      .sort(function (a, b) { return a.e.localeCompare(b.e) || a.t.localeCompare(b.t, "ko"); });
    homeList("soon", $("#homeSoon"), $("#homeSoonMore"), soon, function (n) { return row(n, null, true); },
      "지금 접수 중인 마감일 있는 공고가 없습니다.");

    var fresh = live.filter(function (n) { return postedWithin(n, RECENT_DAYS); })
      .sort(function (a, b) { return b.pd.localeCompare(a.pd) || a.t.localeCompare(b.t, "ko"); });
    $("#homeNewCount").textContent = fmtN(fresh.length);
    homeList("fresh", $("#homeNew"), $("#homeNewMore"), fresh, function (n) { return row(n, fmtDate(n.pd) + " 등록", true); },
      "최근 " + RECENT_DAYS + "일 동안 새로 올라온 공고가 없습니다.");

    renderPopular(live);
  }

  /* 많이 찾는 지원사업: 상시 제도는 미리 뽑아 둔 순위(META.topServices, id 목록 + items), 모집 공고는 기업마당 조회수.
   * 둘 다 20개까지 */
  var popKind = "s", POP_MAX = 20;
  function renderPopular(live) {
    var items;
    if (popKind === "s") {
      var top = META.topServices || {};
      var ids = !state.r ? top.all : (state.nat ? (top.withNational || {})[state.r] : (top.region || {})[state.r]);
      items = (ids || []).map(function (id) { return typeof id === "string" ? (top.items || {})[id] : id; }).filter(Boolean);
    } else {
      items = live.filter(function (n) { return n.vw; })
        .sort(function (a, b) { return b.vw - a.vw; }).slice(0, POP_MAX);
    }
    homeList("pop", $("#homePop"), $("#homePopMore"), items, function (n) { return row(n, "누적 조회 " + fmtViews(n.vw) + "회", true); },
      "조회수 자료가 없습니다.");
    document.querySelectorAll("#homePopKind button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.pop === popKind));
    });
  }

  /* ---------- 홈 그래프 ----------
   * 한 계열 그래프는 한 색. 모든 값은 막대 끝 숫자·지역 순위 목록·선 그래프 툴팁으로 읽히고,
   * 화면 읽기 프로그램은 각 표시의 aria-label로 읽는다.
   * 툴팁은 가리키기와 키보드 초점에서 같은 내용을 보여 준다.
   */
  var SVGNS = "http://www.w3.org/2000/svg";
  // 색은 자료 종류에 붙인다: 파랑 = 모집 공고, 초록 = 상시 제도, 회색 = 비교 대상·나머지(style.css 색 체계 변수).
  // 파랑·초록 짝은 dataviz validate_palette.js 통과(색각 이상 포함). 값·이름 글자는 늘 글자색으로 쓴다
  var SERIES_BLUE = "var(--kind-open)", SERIES_GREEN = "var(--kind-svc)", SERIES_GRAY = "var(--gray-500)";
  var LAST_YEAR_BAR = "var(--gray-200)"; // 겹친 막대의 작년(뒤) 막대
  // 지역 지도 5단계(많을수록 진함): 모집 공고는 파랑, 상시 제도는 초록
  var MAP_SHADES = ["var(--blue-100)", "var(--blue-300)", "var(--blue-400)", "var(--blue-700)", "var(--blue-900)"];
  var MAP_SHADES_GREEN = ["var(--green-100)", "var(--green-300)", "var(--green-400)", "var(--green-700)", "var(--green-900)"];
  var mapKind = "n", MAP_WHAT = { n: "모집 공고", s: "상시 제도" };
  function mapShades() { return mapKind === "s" ? MAP_SHADES_GREEN : MAP_SHADES; }

  /* 카드 안쪽 실제 폭(px). 이 폭으로 좌표를 잡아야 휴대폰에서 글자가 작아지지 않는다 */
  function chartWidth() {
    var w = $("#homeCharts").clientWidth || 480;
    if (window.matchMedia("(min-width: 900px)").matches) w = (w - 16) / 2;
    return Math.max(280, Math.min(880, Math.round(w - 50))); // 카드 안쪽 여백 24px×2와 테두리 제외
  }

  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function svgText(x, y, text, cls, anchor) {
    var t = svgEl("text", { x: x, y: y, "class": cls, "text-anchor": anchor || "middle" });
    t.textContent = text;
    return t;
  }

  /* 말풍선은 가리킨 곳 바로 위 가운데에 놓고, 아래 꼬리가 그 점을 가리킨다.
   * 화면 가장자리에서는 말풍선만 안쪽으로 당기고 꼬리는 제자리(--caret-x)에 둔다.
   * 위에 자리가 없으면 아래로 뒤집는다(.below) */
  function tipFor(node, value, label) {
    var tip = $("#vizTip");
    function show(x, y, gap) {
      tip.replaceChildren(el("strong", { text: value }), label);
      tip.hidden = false;
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
      var below = y - h - gap < 8;
      tip.classList.toggle("below", below);
      tip.style.left = left + "px";
      tip.style.top = (below ? y + gap : y - h - gap) + "px";
      tip.style.setProperty("--caret-x", Math.max(12, Math.min(w - 12, x - left)) + "px");
    }
    node.addEventListener("pointermove", function (e) { show(e.clientX, e.clientY, 14); });
    node.addEventListener("pointerleave", function () { tip.hidden = true; });
    node.addEventListener("focus", function () {
      var r = node.getBoundingClientRect();
      show(r.left + r.width / 2, r.top, 10);
    });
    node.addEventListener("blur", function () { tip.hidden = true; });
  }

  /* 그래프 표시(막대·조각)를 키보드로도 고를 수 있게 한다. 이동할 곳이 없으면 읽기 전용 */
  function activate(node, label, onPick) {
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", label);
    if (onPick) {
      node.setAttribute("role", "button");
      node.addEventListener("click", function () { onPick(node); });
      node.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(node); }
      });
    } else {
      node.setAttribute("role", "img");
      node.classList.add("static");
    }
  }

  /* ---------- 그래프 요약 창(누르면 한 단계 더 자세히) ----------
   * 그래프 표시(달력 칸·막대)를 누르면 바로 목록으로 가지 않고 작은 요약 창을 연다.
   * 같은 표시를 다시 누르거나, 바깥을 누르거나, Esc·닫기로 닫는다. 다른 표시를 누르면 내용만 바뀐다.
   * 넓은 화면은 누른 곳 옆에 뜨는 창(페이지와 함께 스크롤), 휴대폰(639px 이하)은 아래에서 올라오는 시트.
   * 창은 카드 밖(body)에 떠서 카드 크기·배치를 바꾸지 않는다. 맨 아래 단추로 전체 목록에 간다.
   * 상시 제도 요약은 data/peek.js(build_site.py service_peek)를 처음 열 때 읽는다 */
  var peekKey = null, peekAnchor = null, peekBox = null, peekShade = null;
  function peekSheet() { return window.matchMedia("(max-width: 639px)").matches; }

  /* 휴대폰 시트는 열 때 방문 기록을 하나 넣어 '뒤로 가기'가 시트만 닫게 한다(사이트를 벗어나지 않게).
   * 닫기 단추·뒤판·Esc로 닫으면 그 기록을 되돌린다(history.back → popstate는 무시하고 주소만 맞춘다).
   * 목록·상세로 갈 때(keepHistory)는 되돌리지 않고 writeHash가 그 기록 자리를 바꿔 쓴다 */
  var peekPopIgnore = false;
  function peekEntry() { return !!(history.state && history.state.peek); }
  function peekPushEntry() {
    if (peekEntry()) return;
    try { history.pushState({ peek: 1 }, "", location.href); } catch (e) { /* 막히면 기록 없이 */ }
  }
  window.addEventListener("popstate", function (e) {
    if (peekPopIgnore) {
      peekPopIgnore = false;
      e.stopImmediatePropagation();
      writeHash(false); // 닫는 사이 바뀐 상태(지역 선택 등)를 지금 기록에 맞춘다
      return;
    }
    if (peekBox) {
      // 뒤로 가기로 시트를 닫음: 화면은 그대로 둔다
      e.stopImmediatePropagation();
      closePeek(true, true);
    }
  });

  function closePeek(restoreFocus, keepHistory) {
    if (!peekBox) return;
    if (!keepHistory && peekEntry()) { peekPopIgnore = true; history.back(); }
    var anchor = peekAnchor;
    peekBox.remove(); peekShade.remove();
    peekBox = peekShade = null; peekKey = null; peekAnchor = null;
    document.body.classList.remove("peek-lock");
    document.querySelectorAll(".has-pick").forEach(function (n) { n.classList.remove("has-pick"); });
    document.querySelectorAll(".picked").forEach(function (n) { n.classList.remove("picked"); n.setAttribute("aria-expanded", "false"); });
    if (restoreFocus && anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  function placePeek() {
    if (!peekBox || !peekAnchor) return;
    if (peekSheet()) { peekBox.style.left = peekBox.style.top = ""; return; }
    var r = peekAnchor.getBoundingClientRect(), w = peekBox.offsetWidth, h = peekBox.offsetHeight, gap = 10;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2)), top;
    if (r.bottom + gap + h <= vh - 8) top = r.bottom + gap;          // 아래에 자리가 있으면 아래
    else if (r.top - gap - h >= 8) top = r.top - gap - h;            // 아니면 위
    else {
      // 키 큰 표시(달 막대 칸 등)는 위아래 어디에도 안 들어가므로 카드 옆(그래프를 가리지 않게)에 두고 화면 안에 세로로 맞춘다
      var c = (peekAnchor.closest(".viz-card") || peekAnchor).getBoundingClientRect();
      left = c.right + gap + w <= vw - 12 ? c.right + gap : c.left - gap - w >= 12 ? c.left - gap - w :
        r.right + gap + w <= vw - 12 ? r.right + gap : Math.max(12, r.left - gap - w);
      top = Math.max(8, Math.min(vh - h - 8, r.top + r.height / 2 - h / 2));
    }
    peekBox.style.left = Math.round(left + window.scrollX) + "px";
    peekBox.style.top = Math.round(top + window.scrollY) + "px";
  }

  /* spec: { title, sub, n, unit, flag(배지 글자), flagTone, kind("open"|"svc"), note,
   *   groups: [{ label, rows: [[이름, 건수]] }], items: [항목], itemsLabel, more: { label, go }, more2: { label, go } } */
  function peekBody(spec) {
    var close = el("button", { type: "button", className: "peek-close", "aria-label": "요약 닫기" }, icon("x"));
    close.addEventListener("click", function () { closePeek(true); });
    var head = el("div", { className: "peek-head" },
      el("div", null, el("p", { className: "peek-title", id: "peekTitle", text: spec.title }),
        spec.sub ? el("p", { className: "peek-sub", text: spec.sub }) : null),
      close);
    var num = el("div", { className: "peek-num kind-" + spec.kind },
      el("strong", { text: fmtN(spec.n) }), el("span", { text: spec.unit || "건" }),
      spec.flag ? badge(spec.flag, spec.flagTone || "soft") : null);
    var note = spec.note ? el("p", { className: "peek-note", text: spec.note }) : null;
    var groups = el("dl", { className: "peek-groups" });
    spec.groups.forEach(function (g) {
      if (!g.rows.length) return;
      var dd = el("dd");
      g.rows.forEach(function (r, i) {
        if (i) dd.append(el("span", { className: "peek-dot", "aria-hidden": "true", text: "·" }));
        dd.append(el("span", { className: "peek-pair" }, r[0] + " ", el("b", { text: fmtN(r[1]) })));
      });
      groups.append(el("div", null, el("dt", { text: g.label }), dd));
    });
    function itemList(label, items, cls) {
      var box = el("div", { className: "peek-items" + (cls ? " " + cls : "") }, el("p", { className: "peek-label", text: label }));
      var ul = el("ul");
      items.forEach(function (it) {
        var ch = changeOf(it.id);
        var side = it.k === "s" ? null : ch ? badge(ch.text, ch.tone) : statusBadge(it);
        var b = el("button", { type: "button", className: "peek-item" },
          el("span", { className: "peek-item-main" },
            el("span", { className: "peek-item-title", text: it.t }),
            el("span", { className: "peek-item-meta", text: [it.ag, regionText(it)].filter(Boolean).join(" · ") })),
          side);
        b.addEventListener("click", function () {
          closePeek(false, true);
          goTo({ tab: it.k === "s" ? "services" : "open", id: it.id });
        });
        ul.append(el("li", null, b));
      });
      box.append(ul);
      return box;
    }
    var pinned = spec.pinned && spec.pinned.length ? itemList("내 달력에 넣은 공고", spec.pinned, "mine") : null;
    var list = spec.items && spec.items.length ? itemList(spec.itemsLabel || "많이 본 공고", spec.items) : null;
    var more = el("button", { type: "button", className: "btn dark peek-more" }, spec.more.label, icon("arrow-right"));
    more.addEventListener("click", function () { closePeek(false, true); spec.more.go(); });
    var more2 = null;
    if (spec.more2) {
      more2 = el("button", { type: "button", className: "btn gray peek-more" }, spec.more2.label);
      more2.addEventListener("click", function () { closePeek(false, true); spec.more2.go(); });
    }
    return [head, num, note, pinned, groups, list, more, more2];
  }

  /* marks: 누른 것과 짝인 표시(도넛 조각 ↔ 목록 줄, 지도 지역 ↔ 순위 줄)도 같이 '고름'으로 칠한다 */
  function openPeek(key, anchor, build, marks) {
    if (peekKey === key) { closePeek(true); return; }
    var wasOpen = !!peekBox;
    closePeek(false, true); // 다른 표시로 바꿔 열 때는 기록을 그대로 쓴다
    $("#vizTip").hidden = true;
    peekKey = key; peekAnchor = anchor;
    [anchor].concat(marks || []).forEach(function (m) {
      if (!m) return;
      m.classList.add("picked");
      m.setAttribute("aria-expanded", "true");
      var box = m.closest("svg, ol");
      if (box) box.classList.add("has-pick");
    });
    var sheet = peekSheet();
    peekShade = el("div", { className: "peek-shade" + (sheet ? " on" : "") });
    peekShade.addEventListener("click", function () { closePeek(true); });
    peekBox = el("div", { className: "peek" + (sheet ? " sheet" : "") + (wasOpen ? " swap" : ""), role: "dialog",
      "aria-modal": sheet ? "true" : null, "aria-labelledby": "peekTitle", tabindex: "-1" });
    // Tab·Shift+Tab은 창 안에서만 돈다(뒤 화면으로 초점이 빠지지 않게)
    peekBox.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = [].slice.call(peekBox.querySelectorAll("button, a[href]")).filter(function (n) { return !n.disabled; });
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || at === peekBox)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    });
    document.body.append(peekShade, peekBox);
    if (sheet) { document.body.classList.add("peek-lock"); peekPushEntry(); }
    function fill(spec) {
      if (!peekBox || peekKey !== key) return;
      peekBox.replaceChildren.apply(peekBox, peekBody(spec).filter(Boolean));
      placePeek();
    }
    var spec = build();
    if (spec && typeof spec.then === "function") {
      peekBox.append(el("p", { className: "peek-wait", text: "요약을 불러오는 중…" }));
      placePeek();
      spec.then(fill, function () {
        if (peekBox && peekKey === key) peekBox.replaceChildren(el("p", { className: "peek-wait", text: "요약을 불러오지 못했습니다." }));
      });
    } else fill(spec);
    peekBox.focus({ preventScroll: true });
  }

  document.addEventListener("click", function (e) {
    if (!peekBox) return;
    if (peekBox.contains(e.target) || (peekAnchor && peekAnchor.contains(e.target))) return;
    if (e.target.closest && e.target.closest("[aria-haspopup=dialog]")) return; // 다른 표시: 그쪽에서 바꿔 연다
    closePeek(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && peekBox) { e.stopPropagation(); closePeek(true); }
  }, true);
  window.addEventListener("resize", function () { placePeek(); });

  function topN(counts, n) {
    return Object.keys(counts).filter(function (k) { return k && counts[k]; })
      .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b, "ko"); })
      .slice(0, n || 3).map(function (k) { return [k, counts[k]]; });
  }
  function mostViewed(items, n) {
    return items.filter(function (i) { return i.vw; }).sort(function (a, b) { return b.vw - a.vw; }).slice(0, n || 3);
  }
  function regionPrefix() { return state.r ? state.r + (state.nat ? "(전국 대상 포함)" : "") + " · " : ""; }

  /* 모집 공고 묶음 요약(달력 날짜·대상 막대·지도·도넛·달 막대 공통). skip: 뺄 묶음(그 카드가 이미 나눈 기준) */
  var NOTICE_GROUPS = [
    { key: "nf", label: "분야", of: function (i) { return i.nf; } },
    { key: "pp", label: "대상", of: function (i) { return i.pp; } },
    { key: "rg", label: "지역", of: function (i) { return i.rg; } }];
  function noticePeek(items, title, sub, more, flag, flagTone, skip) {
    var soon = items.filter(isSoon).length;
    return { title: title, sub: sub, n: items.length, kind: "open",
      flag: flag !== undefined ? flag : (soon ? "7일 안 마감 " + fmtN(soon) + "건" : null), flagTone: flagTone || "soon",
      groups: NOTICE_GROUPS.filter(function (g) { return g.key !== skip; }).map(function (g) {
        return { label: g.label, rows: topN(countBy(items, g.of)) };
      }),
      items: peekItems(items), more: more };
  }
  /* 대표 3건: 조회수가 있으면 많이 본 순, 없으면 마감이 가까운 순 */
  function peekItems(items) {
    var seen = mostViewed(items);
    if (seen.length >= 3) return seen;
    var rest = items.filter(function (i) { return !i.vw; })
      .sort(function (a, b) { return (a.e || "9999").localeCompare(b.e || "9999"); });
    return seen.concat(rest).slice(0, 3);
  }

  /* 상시 제도 대상 요약: peek.js의 칸(전체 / 지역 / 지역 + 전국 대상)을 더한다 */
  var svcPeekData = null;
  function ensureSvcPeek() {
    if (svcPeekData) return Promise.resolve(svcPeekData);
    return loadScript("data/peek.js").then(function () { svcPeekData = window.HUB_PEEK || {}; return svcPeekData; });
  }
  /* key: "all" | 대상 이름 | "cat:"분야 | "sp:"지원 방식. o: { title, n, more(목록 조건), region(지도: 그 지역만), more2 }.
   * 묶음은 그 열쇠가 이미 나눈 기준을 빼고 보인다(대상 막대면 분야·방식, 분야 도넛이면 대상·방식) */
  function servicePeek(key, o) {
    return ensureSvcPeek().then(function (d) {
      var cells = o.region ? [(d.region || {})[o.region] || {}] :
        state.r ? [(d.region || {})[state.r] || {}].concat(state.nat ? [d.national || {}] : []) : [d.total || {}];
      var sums = { cat: {}, sp: {}, pp: {} }, ids = [];
      cells.forEach(function (c) {
        var x = c[key];
        if (!x) return;
        Object.keys(sums).forEach(function (g) {
          Object.keys(x[g] || {}).forEach(function (k) { sums[g][k] = (sums[g][k] || 0) + x[g][k]; });
        });
        ids = ids.concat(x.top);
      });
      var items = mostViewed(ids.map(function (id) { return (d.items || {})[id]; }).filter(Boolean));
      var kind = key.slice(0, 3);
      var groups = [];
      if (kind !== "cat") groups.push({ label: "분야", rows: topN(sums.cat) });
      if (kind === "cat" || kind === "sp:" || key === "all") groups.push({ label: "대상", rows: topN(sums.pp) });
      if (kind !== "sp:") groups.push({ label: "방식", rows: topN(sums.sp) });
      return { title: o.title, sub: o.sub || "언제든 신청할 수 있는 제도", n: o.n, kind: "svc", groups: groups,
        items: items, itemsLabel: "많이 본 제도",
        more: { label: fmtN(o.n) + "건 모두 보기", go: function () { goTo(Object.assign({ tab: "services" }, o.more)); } },
        more2: o.more2 };
    });
  }

  function vizCard(title, sub, body, foot, tools) {
    var head = el("h3", { text: title });
    return el("section", { className: "viz-card viz" },
      tools ? el("div", { className: "viz-head" }, head, tools) : head,
      sub ? el("p", { className: "viz-sub", text: sub }) : null,
      el("div", { className: "viz-body" }, body),
      foot);
  }

  /* 카드 제목 옆 전환 단추. 바꾸면 홈을 다시 그리고 초점을 새로 눌린 단추에 둔다 */
  function segToggle(name, label, options, current, onPick) {
    var box = el("div", { className: "seg-mini", role: "group", "aria-label": label, dataset: { seg: name } });
    options.forEach(function (o) {
      var b = el("button", { type: "button", "aria-pressed": String(o.value === current), text: o.label });
      b.addEventListener("click", function () {
        if (o.value === current) return;
        // 다시 그리기 전 눌린 단추 자리를 기억해 두면 새 단추로 알약이 미끄러져 온다
        var from = box.querySelector('[aria-pressed="true"]');
        segFrom[name] = from ? { left: from.offsetLeft, width: from.offsetWidth } : null;
        onPick(o.value);
        animScope = name; // 카드 이름표(map·svc)와 같다
        renderHome();
        var again = document.querySelector('[data-seg="' + name + '"] [aria-pressed="true"]');
        if (again) again.focus();
      });
      box.append(b);
    });
    box.append(el("span", { className: "seg-glider", "aria-hidden": "true" }));
    return box;
  }

  /* 눌린 단추 뒤 알약(.seg-glider)을 그 단추 자리·폭에 맞춘다. 막 바뀐 단추면 이전 자리에서 미끄러져 온다.
   * 홈을 다시 그린 뒤와 글자 크기를 바꾼 뒤 부른다 */
  var segFrom = {};
  function placeSegGliders() {
    document.querySelectorAll(".seg-mini").forEach(function (box) {
      var glider = box.querySelector(".seg-glider"), on = box.querySelector('[aria-pressed="true"]');
      if (!glider || !on || !on.offsetWidth) return; // 홈이 가려져 잴 수 없으면 다음에 그릴 때 맞춘다
      var name = box.dataset.seg, from = name && segFrom[name];
      function put(p) { glider.style.width = p.width + "px"; glider.style.transform = "translateX(" + p.left + "px)"; }
      var to = { left: on.offsetLeft, width: on.offsetWidth };
      if (from) {
        segFrom[name] = null;
        glider.style.transition = "none";
        put(from);
        void glider.offsetWidth; // 이전 자리를 먼저 그리게 해야 미끄러짐이 보인다
        glider.style.transition = "";
        put(to);
      } else if (!glider.style.width) {
        // 처음 놓는 알약(홈을 다시 그려 새로 만든 다른 카드의 단추)은 폭 0에서 자라나지 않게 제자리에 바로 놓는다
        glider.style.transition = "none";
        put(to);
        void glider.offsetWidth;
        glider.style.transition = "";
      } else {
        put(to); // 이미 놓인 알약: 미끄러지는 중이면 그대로 이어 간다
      }
      box.classList.add("glide");
    });
  }

  /* 두 계열 이상일 때만 쓰는 범례(색 네모 + 이름) */
  function legend(series) {
    var box = el("div", { className: "viz-legend" });
    series.forEach(function (x) { box.append(el("span", null, el("i", { style: "background:" + x.color }), x.name)); });
    return box;
  }

  function hbarPath(x, y, w, h) {
    var r = Math.min(4, w, h / 2); // 바닥(왼쪽)은 네모, 값 쪽 끝만 4px 둥글게
    return "M" + x + " " + y + "H" + (x + w - r) + "Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) +
      "V" + (y + h - r) + "Q" + (x + w) + " " + (y + h) + " " + (x + w - r) + " " + (y + h) + "H" + x + "Z";
  }

  /* 가로 막대 이름 칸 폭: 가장 긴 이름 + 여백(고정 폭이면 짧은 이름 앞이 빈다) */
  var measureCtx = null;
  function labelColumn(labels, W) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    var px = window.matchMedia("(max-width: 639px)").matches ? 13 : 14;
    measureCtx.font = "600 " + px + "px " + getComputedStyle(document.body).fontFamily;
    var widest = Math.max.apply(null, labels.map(function (t) { return measureCtx.measureText(t).width; }));
    return Math.round(Math.min(W * 0.4, widest + 16));
  }



  /* 나비 그래프: 가운데에 이름, 왼쪽으로 첫 계열(모집 공고), 오른쪽으로 둘째 계열(상시 제도).
   * 양쪽 막대 길이는 각 계열 안에서 가장 많은 값 기준(두 계열 수가 열 배 가까이 달라 한 눈금이면 공고 막대가 안 보인다).
   * 길이는 제곱근 눈금: 한 대상(중소기업)에 몰려 나머지 막대가 안 보이지 않게 차이를 줄인다. 정확한 수는 막대 끝 숫자.
   * fitH를 주면 그 높이를 채우도록 줄 간격(24~36px)을 키운다 */
  function hbarPathLeft(x, y, w, h) {
    var r = Math.min(4, w, h / 2); // 바닥(오른쪽, 가운데 이름 쪽)은 네모, 값 쪽 끝(왼쪽)만 둥글게
    return "M" + (x + w) + " " + y + "H" + (x + r) + "Q" + x + " " + y + " " + x + " " + (y + r) +
      "V" + (y + h - r) + "Q" + x + " " + (y + h) + " " + (x + r) + " " + (y + h) + "H" + (x + w) + "Z";
  }

  function butterflyBars(data, series, label, W, fitH) {
    var head = 24, rowH = fitH ? Math.max(24, Math.min(40, Math.floor((fitH - head - 4) / data.length))) : 26;
    var barT = Math.min(16, rowH - 8);
    var labelW = labelColumn(data.map(function (d) { return d.label; }), W) + 4;
    var side = (W - labelW) / 2, plot = side - 40;
    var max = [0, 1].map(function (j) { return Math.max.apply(null, data.map(function (d) { return d.values[j].n; })) || 1; });
    var H = head + data.length * rowH + 4, cxL = side, cxR = side + labelW;
    var root = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": label, "class": "hb fly" });
    root.append(svgEl("rect", { x: cxL - 10, y: 6, width: 10, height: 10, rx: 2, style: "fill:" + series[0].color }),
      svgText(cxL - 16, 15, series[0].name, "tick", "end"),
      svgEl("rect", { x: cxR, y: 6, width: 10, height: 10, rx: 2, style: "fill:" + series[1].color }),
      svgText(cxR + 16, 15, series[1].name, "tick", "start"));
    data.forEach(function (d, i) {
      var cy = head + 2 + i * rowH + rowH / 2;
      root.append(svgText(side + labelW / 2, cy + 5, d.label, "cat", "middle"));
      d.values.forEach(function (v, j) {
        var w = v.n ? Math.max(2, Math.round(plot * Math.sqrt(v.n / max[j]))) : 0;
        var g = svgEl("g", { "class": "mark", style: "--i:" + i });
        g.append(svgEl("rect", { x: j ? cxR : 0, y: cy - rowH / 2, width: side, height: rowH, rx: 6, "class": "hit" }));
        if (w) g.append(svgEl("path", { d: j ? hbarPath(cxR, cy - barT / 2, w, barT) : hbarPathLeft(cxL - w, cy - barT / 2, w, barT),
          "class": "bar" + (j ? "" : " flip"), style: "fill:" + series[j].color }));
        g.append(svgText(j ? cxR + w + 6 : cxL - w - 6, cy + 5, fmtN(v.n), "val sm", j ? "start" : "end"));
        activate(g, v.aria, v.onPick);
        if (v.onPick) { g.setAttribute("aria-haspopup", "dialog"); g.setAttribute("aria-expanded", "false"); }
        tipFor(g, v.tipValue, v.tipLabel);
        root.append(g);
      });
    });
    return root;
  }

  /* 눈금 최댓값: 가운데 눈금도 정수가 되게 고른다 */
  function niceMax(v) {
    if (v <= 8) return Math.max(2, Math.ceil(v / 2) * 2);
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return Math.round(steps[i] * p);
    return 10 * p;
  }

  function pt(p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }

  /* 공모 그래프 공통 틀: 1~12월 칸, 옅은 눈금 3줄, 이번 달(자료를 모은 마지막 달) 자리에 옅은 띠.
   * fitH를 주면 카드 남는 높이를 채운다(옆 카드가 길 때 제목과 그래프 사이가 비지 않게, 최대 440px) */
  function monthFrame(W, fitH, max, right) {
    var H = fitH ? Math.max(chartHeight(W) - 4, Math.min(440, Math.floor(fitH))) : chartHeight(W) - 4;
    var f = { W: W, H: H, top: 22, bottom: 30, left: 46, right: right || 8 };
    f.base = H - f.bottom; f.plotH = f.base - f.top; f.band = (W - f.left - f.right) / 12;
    f.max = niceMax(Math.max(1, max));
    f.Y = function (v) { return f.base - f.plotH * v / f.max; };
    f.cx = function (i) { return f.left + f.band * (i + 0.5); };
    return f;
  }

  function monthAxes(root, f, nowIdx) {
    if (nowIdx >= 0) {
      root.append(svgEl("rect", { x: f.left + f.band * nowIdx + 1, y: f.top - 18, width: f.band - 2,
        height: f.base - f.top + 18, rx: 6, "class": "now-band" }));
      root.append(svgText(f.cx(nowIdx), f.top - 6, "이번 달", "now-t"));
    }
    [0, 0.5, 1].forEach(function (k) {
      var y = Math.round(f.Y(f.max * k)) + 0.5;
      root.append(svgEl("line", { x1: f.left, x2: f.W - f.right, y1: y, y2: y, "class": k ? "grid" : "axis" }));
      root.append(svgText(f.left - 8, y + 4, fmtN(f.max * k), "tick", "end"));
    });
    var roomy = f.band >= 34;
    for (var m = 0; m < 12; m++) root.append(svgText(f.cx(m), f.base + 20, (m + 1) + (roomy ? "월" : ""), "tick"));
  }

  function vbarPath(x, y, w, h) {
    var r = Math.min(3, w / 2, h); // 바닥은 네모, 위 끝만 둥글게
    return "M" + x + " " + (y + h) + "V" + (y + r) + "Q" + x + " " + y + " " + (x + r) + " " + y + "H" + (x + w - r) +
      "Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) + "V" + (y + h) + "Z";
  }

  /* 달별: 작년(넓은 옅은 회색) 막대 위에 올해(좁은 파랑) 막대를 겹친다. 올해가 작년을 넘는 달이 바로 보인다.
   * 아직 끝나지 않은 이번 달 막대는 옅게 + 점선 테두리 */
  function monthBars(A, B, W, fitH, tipAt, pickAt) {
    var f = monthFrame(W, fitH, Math.max.apply(null, A.concat(B)));
    var root = svgEl("svg", { viewBox: "0 0 " + W + " " + f.H, role: "group", "class": "month-chart",
      "aria-label": "달별 국고보조금 공고 수, 올해와 작년 비교 막대 그래프" });
    monthAxes(root, f, B.length - 1);
    var wp = Math.min(30, f.band * 0.72), wc = Math.max(5, Math.round(wp * 0.46));
    for (var i = 0; i < 12; i++) {
      var g = svgEl("g", { "class": "mark", style: "--i:" + i });
      g.append(svgEl("rect", { x: f.left + f.band * i, y: 0, width: f.band, height: f.H, rx: 6, "class": "hit" }));
      var bars = [{ v: A[i], w: wp, c: LAST_YEAR_BAR }];
      if (i < B.length) bars.push({ v: B[i], w: wc, c: SERIES_BLUE, partial: i === B.length - 1 });
      bars.forEach(function (b) {
        if (!b.v) return;
        var h = Math.max(2, f.base - f.Y(b.v));
        g.append(svgEl("path", { d: vbarPath(f.cx(i) - b.w / 2, f.base - h, b.w, h), "class": "bar" + (b.partial ? " partial" : ""),
          style: "fill:" + b.c + (b.partial ? ";stroke:" + b.c : "") }));
      });
      var t = tipAt(i), onPick = pickAt ? pickAt(i) : null;
      activate(g, t.value + ". " + t.label + (onPick ? ". 누르면 요약을 봅니다" : ""), onPick);
      if (onPick) { g.setAttribute("aria-haspopup", "dialog"); g.setAttribute("aria-expanded", "false"); }
      tipFor(g, t.value, t.label);
      root.append(g);
    }
    return root;
  }

  /* 누적: 1월부터 쌓은 수. 작년은 회색 선과 옅은 면, 올해는 파랑 선과 옅은 면.
   * 그림 칸은 달별 막대와 같은 폭(오른쪽 여백을 따로 두지 않는다). 합계 글은 선 끝 안쪽에 쓴다:
   * 작년은 12월 점 위 왼쪽, 올해는 이번 달 점 아래 왼쪽(선이 오른쪽 위로 오르므로 아래 왼쪽은 비어 있다) */
  function monthCum(CA, CB, W, fitH) {
    var f = monthFrame(W, fitH, Math.max(CA[11], CB[CB.length - 1] || 0));
    var root = svgEl("svg", { viewBox: "0 0 " + W + " " + f.H, role: "group", "class": "month-chart",
      "aria-label": "1월부터 쌓은 국고보조금 공고 수, 올해와 작년 비교 선 그래프" });
    monthAxes(root, f, CB.length - 1);
    function pts(v) { return v.map(function (x, i) { return [f.cx(i), f.Y(x)]; }); }
    function area(p, cls) {
      root.append(svgEl("path", { d: "M" + p[0][0] + " " + f.base + "L" + p.map(pt).join("L") + "L" + p[p.length - 1][0] + " " + f.base + "Z",
        "class": cls }));
    }
    var PA = pts(CA), PB = pts(CB);
    area(PA, "area last");
    root.append(svgEl("path", { d: "M" + PA.map(pt).join("L"), pathLength: 1, "class": "line", style: "stroke:" + SERIES_GRAY }));
    if (PB.length) {
      area(PB, "area cur");
      root.append(svgEl("path", { d: "M" + PB.map(pt).join("L"), pathLength: 1, "class": "line thick", style: "stroke:" + SERIES_BLUE }));
      var e = PB[PB.length - 1];
      root.append(svgEl("circle", { cx: e[0], cy: e[1], r: 4.5, "class": "dot", style: "fill:" + SERIES_BLUE }));
      root.append(svgText(e[0] - 8, e[1] + 20, "올해 " + fmtN(CB[CB.length - 1]), "cat halo", "end"));
      root.append(svgText(e[0] - 8, e[1] + 36, "(" + CB.length + "월 진행 중)", "tick halo", "end"));
    }
    root.append(svgText(PA[11][0], PA[11][1] - 12, "작년 " + fmtN(CA[11]), "cat halo muted", "end"));
    for (var k = 0; k < 12; k++) (function (i) {
      var g = svgEl("g", { "class": "mark" });
      g.append(svgEl("rect", { x: f.left + f.band * i, y: 0, width: f.band, height: f.H, rx: 6, "class": "hit" }));
      g.append(svgEl("line", { x1: f.cx(i), x2: f.cx(i), y1: f.top, y2: f.base, "class": "cross" }));
      g.append(svgEl("circle", { cx: PA[i][0], cy: PA[i][1], r: 5, "class": "hover-dot", style: "fill:" + SERIES_GRAY }));
      if (PB[i]) g.append(svgEl("circle", { cx: PB[i][0], cy: PB[i][1], r: 5, "class": "hover-dot", style: "fill:" + SERIES_BLUE }));
      var label = (i < CB.length ? "올해 " + fmtN(CB[i]) + "건 · " : "") + "작년 " + fmtN(CA[i]) + "건";
      activate(g, (i + 1) + "월까지 " + label, null);
      tipFor(g, (i + 1) + "월까지", label);
      root.append(g);
    })(k);
    return root;
  }

  function chartHeight(W) { return Math.max(236, Math.min(290, Math.round(W * 0.4))); }

  /* 누구를 위한 지원이 많나요?: 대상별 모집 공고(파랑, 왼쪽)와 상시 제도(초록, 오른쪽) 수를 나비 그래프로.
   * 두 수를 더한 순. 한 사업이 여러 대상일 수 있다. 상시 제도 수는 META.svc에 미리 센 값 */
  function personaCard(live) {
    var ppN = countBy(live, function (i) { return i.pp; });
    var series = [{ name: "모집 공고", color: SERIES_BLUE }, { name: "상시 제도", color: SERIES_GREEN }];
    // 막대를 누르면 그 대상 요약 창(모집 공고는 바로 계산, 상시 제도는 peek.js)
    function bar(p, n, kind, tab) {
      return { n: n, tipValue: fmtN(n) + "건", tipLabel: p + " 대상 " + kind,
        aria: p + " 대상 " + kind + " " + n + "건" + (n ? ". 누르면 요약을 봅니다" : ""),
        onPick: n ? function (node) {
          openPeek("persona:" + tab + ":" + p, node, function () {
            if (tab === "services") return servicePeek(p, { title: regionPrefix() + p + " 대상 상시 제도", n: n, more: { au: [p] } });
            var items = live.filter(function (i) { return (i.pp || []).indexOf(p) >= 0; });
            return noticePeek(items, regionPrefix() + p + " 대상 모집 공고", "지금 신청할 수 있는 것",
              { label: fmtN(items.length) + "건 모두 보기", go: function () { goTo({ tab: "open", au: [p] }); } });
          });
        } : null };
    }
    var data = META.personas.map(function (p) { return { label: p, a: ppN[p] || 0, b: svcCount(p) || 0 }; })
      .sort(function (x, y) { return (y.a + y.b) - (x.a + x.b) || x.label.localeCompare(y.label, "ko"); })
      .map(function (d) {
        return { label: d.label, values: [bar(d.label, d.a, "모집 공고", "open"), bar(d.label, d.b, "상시 제도", "services")] };
      });
    function draw(fitH) { return butterflyBars(data, series, "대상별 모집 공고와 상시 제도 나비 그래프", chartWidth(), fitH); }
    var card = vizCard("누구를 위한 지원이 많나요?", "많은 순 · 적은 수도 보이게 막대 차이를 줄여 그림(정확한 수는 숫자)", draw(), null);
    card._redraw = draw;
    return card;
  }

  /* 언제 마감되나요?: 이번 달부터 석 달 마감 달력. 보통 달력처럼 가로 = 요일(일~토), 세로 = 주.
   * 달마다 6주 칸을 늘 그리고, 그 달에 없는 날은 회색 선만 있는 빈칸으로 둔다(달이 바뀌어도 모양이 같다).
   * 진할수록 그날 마감하는 접수 중 공고가 많다. 칸을 누르면 그날 마감 공고 목록으로 간다(due = 그날~그날).
   * 석 달 뒤에 마감하는 공고는 아래 '이후 마감' 단추로 모아 본다.
   * 색 4단계 경계는 석 달 동안 마감이 있는 날들의 분포(33·66·90%)로 정한다(달을 바꿔도 같은 색 = 같은 양) */
  var DUE_MONTHS = 3, dueMonth = 0;
  var DUE_SHADES = MAP_SHADES.slice(0, 4); // 지도 파랑 단계와 같은 색

  function monthStart(iso, add) {
    var p = iso.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1 + add, 1)).toISOString().slice(0, 10);
  }

  function dueCard(live) {
    var W = chartWidth();
    var months = [];
    for (var m = 0; m < DUE_MONTHS; m++) months.push(monthStart(today, m));
    var last = addDays(monthStart(today, DUE_MONTHS), -1);
    var perDay = {}, later = 0;
    live.forEach(function (it) {
      if (statusOf(it) !== "접수 중" || !it.e || it.e < today) return;
      if (it.e > last) later++;
      else perDay[it.e] = (perDay[it.e] || 0) + 1;
    });
    // 내 달력: 지역 조건과 상관없이 넣은 것은 다 보인다(접수 예정 공고도)
    var mineByDay = {}, mineLater = 0;
    calItems().forEach(function (it) {
      if (it.e > last) mineLater++;
      else (mineByDay[it.e] = mineByDay[it.e] || []).push(it);
    });
    var values = Object.keys(perDay).map(function (k) { return perDay[k]; }).sort(function (a, b) { return a - b; });
    var breaks = values.length >= 8 ?
      [0.33, 0.66, 0.9].map(function (q) { return values[Math.floor(q * (values.length - 1))]; }) : [1, 2, 3];
    function level(n) { return n ? 1 + breaks.filter(function (b) { return n > b; }).length : 0; }

    if (dueMonth >= DUE_MONTHS) dueMonth = 0;
    var first = months[dueMonth], ym = first.slice(0, 7);
    var lead = new Date(Date.parse(first + "T00:00:00Z")).getUTCDay(); // 1일 앞 빈칸 수
    var gridStart = addDays(first, -lead);

    // 칸 폭은 카드 폭을 7로 나눈 값, 높이는 폭에 맞춰 36~52px(휴대폰에서도 누를 수 있게)
    var top = 24, gap = 4;
    var cw = Math.floor((W - 6 * gap) / 7);
    var ch = Math.max(36, Math.min(52, Math.round(cw * 0.72)));
    var gridW = 7 * cw + 6 * gap;
    var H = top + 6 * ch + 5 * gap + 1;
    var root = svgEl("svg", { viewBox: "-0.5 -0.5 " + (gridW + 1) + " " + H, role: "group", "class": "duecal",
      "aria-label": (+ym.slice(5)) + "월 날짜별 마감 공고 수 달력", style: "max-width:" + (gridW + 1) + "px" });
    // 지난날 칸의 빗금 무늬(style.css .duecal .past .cell)
    var defs = svgEl("defs", {});
    var hatch = svgEl("pattern", { id: "duecal-past", width: 6, height: 6, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)" });
    hatch.append(svgEl("rect", { width: 6, height: 6, fill: "#ffffff" }), svgEl("rect", { width: 3, height: 6, fill: "#f3f3f3" }));
    defs.append(hatch);
    root.append(defs);

    WEEKDAY.forEach(function (w, d) {
      root.append(svgText(d * (cw + gap) + cw / 2, 15, w, "tick", "middle"));
    });

    // 날짜는 늘 왼쪽 위. 마감 수는 넓은 칸이면 오른쪽 아래에 '12건'처럼 단위를 붙이고,
    // 좁은 칸(휴대폰)은 단위가 너무 작아지므로 흰 알약 안에 숫자만 넣어 날짜와 모양으로 구분한다
    var big = cw >= 44;
    for (var i = 0; i < 42; i++) {
      var iso = addDays(gridStart, i);
      var x = (i % 7) * (cw + gap), y = top + Math.floor(i / 7) * (ch + gap);
      var inMonth = iso.slice(0, 7) === ym;
      var rx = Math.min(8, cw / 5);
      if (!inMonth) {
        // 그 달에 없는 날: 회색 선만
        root.append(svgEl("rect", { x: x, y: y, width: cw, height: ch, rx: rx, "class": "blank", "aria-hidden": "true" }));
        continue;
      }
      var past = iso < today;
      var n = past ? 0 : (perDay[iso] || 0);
      var mine = past ? [] : (mineByDay[iso] || []);
      var lvl = level(n);
      var g = svgEl("g", { "class": "day" + (n || mine.length ? " mark" : "") + (past ? " past" : "") + (iso === today ? " today" : "") +
        (lvl === 4 ? " deep" : "") + (mine.length ? " mine" : ""), style: "--i:" + i });
      g.append(svgEl("rect", { x: x, y: y, width: cw, height: ch, rx: rx,
        "class": "cell", style: lvl ? "fill:" + DUE_SHADES[lvl - 1] : "" }));
      g.append(svgText(x + (big ? 6 : 4), y + (big ? 15 : 12), String(+iso.slice(8)), "dnum", "start"));
      if (n && big) {
        var cnt = svgText(x + cw - 6, y + ch - 7, fmtN(n), "dcnt", "end");
        var unit = svgEl("tspan", { "class": "dunit" });
        unit.textContent = "건";
        cnt.append(unit);
        g.append(cnt);
      } else if (n) {
        var txt = fmtN(n), pw = Math.min(cw - 6, txt.length * 7.6 + 8), ph = 17;
        var px = x + (cw - pw) / 2, py = y + ch - ph - 4;
        g.append(svgEl("rect", { x: px, y: py, width: pw, height: ph, rx: ph / 2, "class": "dpill" }));
        g.append(svgText(px + pw / 2, py + ph / 2 + 4.5, txt, "dcnt pill"));
      }
      if (mine.length) {
        // 내 달력에 넣은 날: 칸 오른쪽 위에 검은 점(진한 칸은 흰 테두리)
        g.append(svgEl("circle", { cx: x + cw - (big ? 9 : 7), cy: y + (big ? 9 : 7), r: big ? 4.5 : 4, "class": "dmine" }));
      }
      if (n || mine.length) {
        (function (day, cnt, mineItems) {
          activate(g, fmtDate(day, true) + " 마감 " + cnt + "건" + (mineItems.length ? ", 내 달력 " + mineItems.length + "건" : "") +
            ". 누르면 요약을 봅니다", function (node) {
            openPeek("due:" + day, node, function () {
              var items = live.filter(function (it) { return statusOf(it) === "접수 중" && it.e === day; });
              var d = daysBetween(today, day);
              var spec = noticePeek(items, regionPrefix() + fmtDate(day) + " 마감 모집 공고", "이날까지 신청해야 하는 공고",
                { label: fmtN(items.length) + "건 모두 보기", go: function () { goTo({ tab: "open", due: day + "~" + day }); } },
                d === 0 ? "오늘 마감" : "D-" + d, d <= 3 ? "urgent" : d <= SOON_DAYS ? "soon" : "line");
              spec.pinned = mineItems;
              return spec;
            });
          });
          g.setAttribute("aria-haspopup", "dialog");
          g.setAttribute("aria-expanded", "false");
          tipFor(g, fmtN(cnt) + "건", fmtDate(day, true) + " 마감" + (mineItems.length ? " · 내 달력 " + mineItems.length + "건" : ""));
        })(iso, n, mine);
      } else {
        g.setAttribute("aria-hidden", "true");
      }
      root.append(g);
    }

    var inShown = Object.keys(perDay).filter(function (k) { return k.slice(0, 7) === ym; });
    var total = inShown.reduce(function (a, k) { return a + perDay[k]; }, 0);
    var busiest = inShown.sort(function (a, b) { return perDay[b] - perDay[a] || a.localeCompare(b); }).slice(0, 3);
    var sub = (+ym.slice(5)) + "월 마감 " + fmtN(total) + "건" + (busiest.length ?
      " · 몰린 날 " + busiest.map(function (k) { return fmtDate(k) + " " + fmtN(perDay[k]) + "건"; }).join(", ") : "");
    var scale = el("div", { className: "scale duecal-scale", "aria-hidden": "true" }, "적음");
    DUE_SHADES.forEach(function (color) { scale.append(el("i", { style: "background:" + color })); });
    scale.append("많음");
    var myShown = Object.keys(mineByDay).filter(function (k) { return k.slice(0, 7) === ym; })
      .reduce(function (t, k) { return t + mineByDay[k].length; }, 0);
    if (Object.keys(mineByDay).length || mineLater) {
      scale.append(el("span", { className: "mine-key" }, el("b", { className: "dot" }), "내 달력" + (myShown ? " " + myShown : "")));
    }
    var laterBtn = null;
    if (later) {
      var after = addDays(last, 1);
      laterBtn = el("button", { type: "button", className: "more-link duecal-later" },
        fmtDate(after) + " 이후 마감 " + fmtN(later) + "건" + (mineLater ? " (내 달력 " + mineLater + ")" : ""),
        el("i", { className: "ph ph-arrow-right", "aria-hidden": "true" }));
      laterBtn.addEventListener("click", function () { goTo({ tab: "open", due: after + "~9999-12-31" }); });
    }
    return vizCard("언제 마감되나요?", sub,
      el("div", { className: "viz-fig duecal-fig" }, root, el("div", { className: "duecal-foot" }, scale, laterBtn)), null,
      segToggle("due", "달력에 보일 달", months.map(function (iso, k) {
        return { value: k, label: (+iso.slice(5, 7)) + "월" };
      }), dueMonth, function (v) { dueMonth = v; }));
  }

  /* 실제 지도(vendor/korea-map.js, svg-maps CC BY 4.0). 작은 광역시는 지도 위 숫자가 가려지므로
   * 옆에 16개 지역 순위 목록을 두고, 지도와 목록은 가리키기·고르기가 서로 이어진다 */
  function koreaMap(counts, bin, pick, scale, peek) {
    var map = window.HUB_KOREA_MAP;
    var svg = svgEl("svg", { viewBox: map.viewBox, role: "group", "aria-label": "지역별 " + MAP_WHAT[mapKind] + " 지도", "class": "kmap" });
    var hoverLine = svgEl("g", { "class": "kmap-outline", "aria-hidden": "true" });
    var selLine = svgEl("g", { "class": "kmap-outline sel", "aria-hidden": "true" });
    var rows = {};

    function outline(group, name) {
      group.replaceChildren.apply(group, (name ? map.regions[name] || [] : []).map(function (d) {
        return svgEl("path", { d: d });
      }));
    }
    function hover(name) {
      outline(hoverLine, name);
      Object.keys(rows).forEach(function (k) { rows[k].classList.toggle("hover", k === name); });
    }

    META.regions.forEach(function (name, idx) {
      var v = counts[name] || 0;
      var g = svgEl("g", { "class": "kmap-region", style: "--i:" + idx });
      (map.regions[name] || []).forEach(function (d) {
        g.append(svgEl("path", { d: d, style: "fill:" + mapShades()[bin(v)] }));
      });
      activate(g, name + " 한정 " + MAP_WHAT[mapKind] + " " + v + "건. 누르면 요약을 봅니다", function (node) { peek(name, node, rows[name]); });
      g.setAttribute("aria-haspopup", "dialog");
      g.setAttribute("aria-expanded", "false");
      g.dataset.region = name;
      tipFor(g, fmtN(v) + "건", name + " 한정 " + MAP_WHAT[mapKind]);
      g.addEventListener("pointerenter", function () { hover(name); });
      g.addEventListener("pointerleave", function () { hover(""); });
      g.addEventListener("focus", function () { hover(name); });
      g.addEventListener("blur", function () { hover(""); });
      svg.append(g);
    });
    outline(selLine, state.r);
    svg.append(selLine, hoverLine); // 테두리는 맨 위에 그려 이웃 지역에 가려지지 않게

    var list = el("ol", { className: "kmap-list", "aria-label": "지역별 " + MAP_WHAT[mapKind] + " 순위" });
    META.regions.slice().sort(function (a, b) { return (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b, "ko"); })
      .forEach(function (name) {
        var v = counts[name] || 0;
        var b = el("button", { type: "button", "aria-pressed": String(state.r === name) },
          el("i", { style: "background:" + mapShades()[bin(v)] }),
          el("span", { className: "name", text: name }),
          el("span", { className: "cnt", text: fmtN(v) }));
        b.setAttribute("aria-haspopup", "dialog");
        b.addEventListener("click", function () { peek(name, b, svg.querySelector('[data-region="' + name + '"]')); });
        b.addEventListener("pointerenter", function () { hover(name); });
        b.addEventListener("pointerleave", function () { hover(""); });
        b.addEventListener("focus", function () { hover(name); });
        b.addEventListener("blur", function () { hover(""); });
        rows[name] = b;
        list.append(el("li", null, b));
      });

    return el("div", { className: "kmap-wrap" + (chartWidth() >= 520 ? " wide" : "") },
      el("div", { className: "kmap-figure" }, svg, scale), list);
  }

  function regionCard() {
    var counts = {};
    var national = 0;
    var what = MAP_WHAT[mapKind];
    META.regions.forEach(function (r) { counts[r] = 0; });
    if (mapKind === "s") {
      META.regions.forEach(function (r) { counts[r] = (META.svc.region[r] || {}).all || 0; });
      national = META.svc.national.all || 0;
    } else {
      NOTICES.forEach(function (n) {
        if (statusOf(n) === "마감") return;
        var rg = n.rg || [];
        if (rg[0] === "전국") national++;
        else rg.forEach(function (r) { if (r in counts) counts[r]++; });
      });
    }
    // 5단계 경계는 지금 자료의 분포(20·40·60·80%)로 정한다
    var sorted = META.regions.map(function (r) { return counts[r]; }).sort(function (x, y) { return x - y; });
    var breaks = [0.2, 0.4, 0.6, 0.8].map(function (q) { return sorted[Math.floor(q * (sorted.length - 1))]; });
    function bin(v) { return breaks.filter(function (t) { return v > t; }).length; }

    function pick(name) {
      state.r = state.r === name ? "" : name;
      animScope = "persona"; // 지도에서 고르면 '누구를 위한 지원' 그래프만 다시 자란다
      renderHome();
      writeHash(false);
    }
    var scale = el("div", { className: "scale", "aria-hidden": "true" });
    var lo = 0;
    breaks.concat([Infinity]).forEach(function (hi, i) {
      if (hi !== Infinity && hi < lo) return;
      var text = hi === Infinity ? (fmtN(lo) + "건 이상") : (lo === hi ? fmtN(hi) + "건" : fmtN(lo) + "~" + fmtN(hi) + "건");
      scale.append(el("span", null, el("i", { style: "background:" + mapShades()[i] }), text));
      lo = hi + 1;
    });
    // 지역을 누르면 요약 창: 그 지역 한정 건수(지도 숫자와 같음)와 분야·대상, 목록 단추와 '홈을 이 지역 기준으로' 단추
    function peek(name, node, pair) {
      var what = MAP_WHAT[mapKind];
      var regionBtn = { label: state.r === name ? "지역 선택 풀기" : "홈 화면을 " + name + " 기준으로 보기", go: function () { pick(name); } };
      openPeek("map:" + mapKind + ":" + name, node, function () {
        if (mapKind === "s") {
          return servicePeek("all", { title: name + " 한정 상시 제도", sub: "전국 대상 제도는 빼고 셈", n: counts[name] || 0,
            region: name, more: { r: name, nat: false }, more2: regionBtn });
        }
        var items = NOTICES.filter(function (n) { return statusOf(n) !== "마감" && (n.rg || []).indexOf(name) >= 0 && (n.rg || [])[0] !== "전국"; });
        var spec = noticePeek(items, name + " 한정 모집 공고", "전국 대상 공고는 빼고 셈",
          { label: fmtN(items.length) + "건 모두 보기", go: function () { goTo({ tab: "open", r: name, nat: false }); } }, undefined, undefined, "rg");
        spec.more2 = regionBtn;
        return spec;
      }, [pair]);
    }
    var body = koreaMap(counts, bin, pick, scale, peek);
    var card = vizCard("어느 지역에 많나요?", "전국 대상 " + fmtN(national) + "건 제외", body, null,
      segToggle("map", "지도에 보일 자료", [{ value: "n", label: "모집 공고" }, { value: "s", label: "상시 제도" }], mapKind,
        function (v) { mapKind = v; }));
    // 고른 지역은 같은 지역을 다시 누르거나, 카드의 빈 곳을 누르거나, Esc로 푼다
    card.addEventListener("click", function (e) {
      if (state.r && !e.target.closest(".kmap-region, button, a, select, input")) pick(state.r);
    });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.r) { pick(state.r); }
    });
    return card;
  }

  /* 공고는 언제 올라오나요?: 국고보조금 공고가 접수를 시작한 달, 올해(파랑)와 작년(회색). META.openMonths.
   * 카드 머리 단추로 '달별'(겹친 막대)과 '누적'(1월부터 쌓은 선)을 바꾼다. 누적 보기의 부제는
   * 지난달까지(이번 달은 아직 진행 중이라 빼고) 올해와 작년을 비교한다 */
  var monthsView = "month";
  function openMonthsCard() {
    var am = META.openMonths;
    var title = "공고는 언제 올라오나요?";
    var foot = null;
    if (!am || !am.years) return vizCard(title, null, el("p", { className: "muted", text: "공고 자료가 없습니다." }), foot);
    var prev = String(am.years[0]), cur = String(am.years[1]), upto = am.month;
    function vals(y) {
      return am.total[y].map(function (v, i) {
        if (!state.r) return v;
        return (((am.region[state.r] || {})[y] || [])[i] || 0) + (state.nat ? am.national[y][i] : 0);
      });
    }
    function sum(a) { return a.reduce(function (t, v) { return t + v; }, 0); }
    function cum(a) { var t = 0; return a.map(function (v) { return (t += v); }); }
    var A = vals(prev), B = vals(cur).slice(0, upto); // 올해는 자료를 모은 달까지만
    if (!sum(A) && !sum(B)) {
      return vizCard(title, null, el("p", { className: "muted", text: "이 지역의 공고 자료가 없습니다." }), foot);
    }
    var byCum = monthsView === "cum";
    var sub = "국고보조금 공고 기준";
    if (byCum) {
      var done = B.length - 1, sa = sum(A.slice(0, done)), sb = sum(B.slice(0, done));
      sub = "1월부터 쌓은 수";
      if (done > 0 && sa) {
        var d = Math.round((sb - sa) / sa * 100);
        sub += " · " + done + "월까지 올해 " + fmtN(sb) + "건, 작년 " + fmtN(sa) + "건(" + (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d) + "%)";
      }
    }
    var CA = cum(A), CB = cum(B);
    /* 달 막대 요약: 올해(이번 달까지) 또는 작년(아직 오지 않은 달) 건수와, 그 달에 접수를 시작해 지금 신청할 수 있는
     * 국고보조금 공고(분야는 출처에 없어 대상·지역·부처로 나눈다) */
    function monthPeek(i) {
      var m = i + 1, mm = (m < 10 ? "0" : "") + m, thisYear = i < B.length;
      var items = NOTICES.filter(function (n) {
        return n.src === "bojo" && statusOf(n) !== "마감" && inRegion(n) && (n.s || n.e || "").slice(0, 7) === cur + "-" + mm;
      });
      var spec = noticePeek(items, regionPrefix() + (thisYear ? cur + "년 " : prev + "년 ") + m + "월에 올라온 국고보조금 공고",
        thisYear ? "접수를 시작한 공고(마감 포함)" : "올해 " + m + "월은 아직 오지 않았습니다",
        thisYear && items.length ? { label: "지금 신청할 수 있는 " + m + "월 공고 " + fmtN(items.length) + "건 보기",
          go: function () { goTo({ tab: "open", src: ["bojo"], om: cur + "-" + mm }); } }
          : { label: "국고보조금 공고 모두 보기", go: function () { goTo({ tab: "open", src: ["bojo"] }); } }, null, null, "nf");
      spec.n = thisYear ? B[i] : A[i];
      spec.flag = thisYear ? "작년 " + m + "월 " + fmtN(A[i]) + "건" : null;
      spec.flagTone = "soft";
      spec.groups.push({ label: "부처", rows: topN(countBy(items, function (n) { return n.ag; })) });
      spec.note = thisYear ? (items.length ? "이 가운데 지금 신청할 수 있는 공고 " + fmtN(items.length) + "건" : "지금 신청할 수 있는 공고는 없습니다")
        : "작년 이맘때 올라온 공고 수입니다";
      spec.itemsLabel = "지금 신청할 수 있는 공고";
      if (!thisYear) { spec.groups = []; spec.items = []; }
      return spec;
    }
    function draw(fitH) {
      if (byCum) return monthCum(CA, CB, chartWidth(), fitH);
      return monthBars(A, B, chartWidth(), fitH, function (i) {
        var parts = [];
        if (i < B.length) parts.push("올해 " + fmtN(B[i]) + "건" + (i === B.length - 1 ? "(모은 날까지)" : ""));
        parts.push("작년 " + fmtN(A[i]) + "건");
        return { value: (i + 1) + "월", label: parts.join(" · ") };
      }, function (i) {
        if (!(i < B.length ? B[i] : A[i])) return null;
        return function (node) { openPeek("month:" + i, node, function () { return monthPeek(i); }); };
      });
    }
    var series = [{ name: cur + "년(올해)", color: SERIES_BLUE }, { name: prev + "년(작년)", color: byCum ? SERIES_GRAY : LAST_YEAR_BAR }];
    var card = vizCard(title, sub, el("div", { className: "viz-fig" }, legend(series), draw()), foot,
      segToggle("months", "공고 그래프 보기", [{ value: "month", label: "달별" }, { value: "cum", label: "누적" }], monthsView,
        function (v) { monthsView = v; }));
    card._redraw = draw;
    return card;
  }

  var chartsDrawnAt = 0;
  window.addEventListener("resize", function () {
    clearTimeout(renderCharts.timer);
    renderCharts.timer = setTimeout(function () {
      if (state.tab === "home" && Math.abs(chartWidth() - chartsDrawnAt) > 40) renderHome();
    }, 200);
  });

  /* 상시 제도 분야(무엇을)·지원 방식(어떻게) 도넛. 지역별 건수는 META.svc에 미리 셈("cat:", "sp:", "all").
   * 조각 크기 = 그 분야(방식)의 제도 수. 한 제도가 여러 지원 방식일 수 있어 방식별 합은 가운데 전체보다 크다.
   * 색은 한 계열(초록) 진하기로, 큰 조각일수록 진하다. '기타'는 회색. 오른쪽(좁으면 아래) 목록과
   * 가리키기가 서로 이어지고, 조각이나 목록을 누르면 그 조건의 상시 제도 목록으로 간다 */
  var svcKind = "cat";
  var DONUT_GREENS = ["#0c440c", "#155c15", "#1d721d", "#2b8a2b", "#3fa33f", "#62b862", "#8fd08f", "#addfad", "#c4e9c4", "#d9f2d9"]; // --green-900 → --green-100 사이를 10단계로
  var DONUT_BLUES = ["#0d366b", "#164a8c", "#1c5cab", "#2a6fc6", "#3987e5", "#5c9ce9", "#86b6ef", "#a9cbf4", "#cde2fb"]; // --blue-900 → --blue-100
  var DONUT_OTHER = "var(--gray-300)";

  function donutArc(cx, cy, R, r, a0, a1) {
    function p(rad, a) { return (cx + rad * Math.sin(a)).toFixed(2) + " " + (cy - rad * Math.cos(a)).toFixed(2); }
    var big = a1 - a0 > Math.PI ? 1 : 0;
    return "M" + p(R, a0) + "A" + R + " " + R + " 0 " + big + " 1 " + p(R, a1) +
      "L" + p(r, a1) + "A" + r + " " + r + " 0 " + big + " 0 " + p(r, a0) + "Z";
  }

  /* 도넛 + 범례(Bklit UI Pie Chart 모양: size 180, innerRadius 55). data = [{key, n, color, what, pct}],
   * total = 가운데 수, cap = 가운데 아랫말.
   *  - 조각이나 범례를 가리키면(또는 눌러 요약 창을 열면) 그 조각이 바깥으로 8px 나오고 나머지는 옅어지며,
   *    가운데 숫자가 그 조각의 건수·이름으로 바뀐다(숫자는 짧게 굴러간다). 범례도 그 칸만 진하게.
   *  - 크기는 자료와 상관없이 같다: 도넛 180px, 범례는 가장 긴 목록(rowsMax개)이 들어갈 줄 수만큼 자리를 늘 차지한다
   *    (분야 ↔ 지원 방식을 바꿔도, 나란한 공고·제도 두 카드도 크기가 그대로) */
  // 도넛 크기: 카드 폭(W)으로만 정한다. 넓으면 범례를 오른쪽 한 줄씩(도넛 최대 280px), 좁으면(휴대폰) 범례를 아래 두 칸.
  // 안쪽 구멍은 Bklit 모양 비율(55/180) 그대로
  var DONUT_MAX = 280, DONUT_INNER_K = 55 / 180, DONUT_OFFSET = 8, DONUT_SIDE_MIN = 360;
  // 가운데 구멍에 들어가게 긴 이름은 줄인다(전체 이름은 범례·요약 창에)
  function shortName(k, max) { max = max || 7; return k.length > max ? k.slice(0, max - 1) + "…" : k; }
  function donutFigure(data, total, cap, listLabel, go, peek) {
    var sum = data.reduce(function (t, d) { return t + d.n; }, 0);
    var W = chartWidth();
    var rowsMax = Math.max((META.serviceCats || []).length, (META.supports || []).length, (META.noticeFields || []).length);
    var side = W >= DONUT_SIDE_MIN, S, cols, rowH, legendW = 0, gapX = 20;
    if (side) {
      legendW = Math.round(Math.min(210, Math.max(150, W * 0.36)));
      S = Math.min(DONUT_MAX, W - legendW - gapX);
      cols = 1;
      rowH = Math.max(26, Math.floor((S - (rowsMax - 1) * 2) / rowsMax)); // 범례 높이 = 도넛 높이
    } else {
      S = Math.min(240, W - 20);
      cols = 2;
      rowH = 34;
    }
    var c = S / 2, R = c - DONUT_OFFSET - 2, r = Math.round(S * DONUT_INNER_K), k = S / 180;
    var legendRows = Math.ceil(rowsMax / cols), rowGap = side ? 2 : 4;
    var svg = svgEl("svg", { viewBox: "0 0 " + S + " " + S, width: S, height: S, "class": "donut", "aria-hidden": "true" });
    var list = el("ol", { className: "donut-legend" + (side ? " side" : ""), style: "--cols:" + cols + ";--row:" + rowH + "px;--rgap:" + rowGap +
      "px;min-height:" + (legendRows * rowH + (legendRows - 1) * rowGap) + "px", "aria-label": listLabel });
    var rows = [], slices = [], hoverIdx = -1;
    // 가운데 세 줄: 건수 / 이름 / 몫(%). 글자 크기는 도넛 크기에 맞춰 키운다(180px일 때 24·12·11.5px)
    var nameMax = Math.max(7, Math.floor((2 * r - 20) / (12 * k + 1)));
    function fs(t, px) { t.style.fontSize = (px * Math.min(1.35, k)).toFixed(1) + "px"; return t; }
    var totalText = fs(svgText(c, c - 4 * k, fmtN(total), "donut-total"), 24), capText = fs(svgText(c, c + 16 * k, cap, "donut-cap"), 12),
      pctText = fs(svgText(c, c + 33 * k, "100%", "donut-pct"), 11.5);

    // 가운데 숫자: from → to 로 0.3초 굴린다(움직임 줄이기 설정이면 바로)
    var shown = total, rollId = 0;
    function roll(to) {
      var from = shown, id = ++rollId, t0 = performance.now(), dur = 300;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) { shown = to; totalText.textContent = fmtN(to); return; }
      (function step(now) {
        if (id !== rollId) return;
        var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        shown = Math.round(from + (to - from) * e);
        totalText.textContent = fmtN(shown);
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }
    // 보이는 조각 = 마우스로 가리킨 것(hoverIdx), 없으면 요약 창으로 고른 것(.picked). 손가락 터치는 가리키기로 치지 않는다
    function hover(i, e) {
      if (e && e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      hoverIdx = i;
      show();
    }
    function show() {
      var i = hoverIdx;
      if (i < 0) i = slices.findIndex(function (g) { return g.classList.contains("picked"); });
      slices.forEach(function (g, k) { g.classList.toggle("on", k === i); });
      rows.forEach(function (b, k) { b.classList.toggle("on", k === i); });
      svg.classList.toggle("has-on", i >= 0);
      list.classList.toggle("has-on", i >= 0);
      roll(i >= 0 ? data[i].n : total);
      capText.textContent = i >= 0 ? shortName(data[i].key, nameMax) : cap;
      pctText.textContent = i >= 0 ? (data[i].n && !data[i].pct ? "1% 미만" : data[i].pct + "%") : "100%";
    }
    // 요약 창이 열리고 닫힐 때(조각에 .picked가 붙고 떨어질 때) 가운데·범례를 맞춘다
    var lastPicked = -1;
    new MutationObserver(function () {
      var p = slices.findIndex(function (g) { return g.classList.contains("picked"); });
      if (p !== lastPicked) { lastPicked = p; show(); }
    }).observe(svg, { subtree: true, attributes: true, attributeFilter: ["class"] });

    var a = 0;
    data.forEach(function (d, i) {
      var span = sum ? d.n / sum * Math.PI * 2 : 0;
      var a0 = a, a1 = Math.max(a0 + 0.001, a + span);
      if (data.length === 1) { a0 = 0; a1 = Math.PI * 2 - 0.0001; }
      a += span;
      var mid = (a0 + a1) / 2;
      var g = svgEl("g", { "class": "slice", style: "--i:" + i + ";--dx:" + (Math.sin(mid) * DONUT_OFFSET).toFixed(2) + "px;--dy:" +
        (-Math.cos(mid) * DONUT_OFFSET).toFixed(2) + "px" });
      // 마우스를 받는 칸(hit)은 움직이지 않고, 보이는 조각(vis)만 튀어나온다. 칸이 같이 움직이면 가장자리에서
      // 들어옴·나감이 번갈아 생겨 조각이 커졌다 작아졌다 떨린다. hit은 튀어나온 자리까지 덮게 바깥을 넓힌다
      g.append(svgEl("path", { d: donutArc(c, c, R + DONUT_OFFSET + 2, r, a0, a1), "class": "hit" }),
        svgEl("path", { d: donutArc(c, c, R, r, a0, a1), "class": "vis", style: "fill:" + d.color }));
      g.addEventListener("pointerenter", function (e) { hover(i, e); });
      g.addEventListener("pointerleave", function (e) { hover(-1, e); });
      g.setAttribute("aria-haspopup", "dialog");
      g.addEventListener("click", function () { if (peek) peek(d, g, rows[i]); else go(d); });
      slices.push(g);
      svg.append(g);

      var b = el("button", { type: "button", title: d.key + " " + fmtN(d.n) + "건 · " + d.pct + "%",
        "aria-haspopup": peek ? "dialog" : null, "aria-expanded": peek ? "false" : null,
        "aria-label": d.what + " " + d.n + "건, 전체의 " + d.pct + "%. " + (peek ? "누르면 요약을 봅니다" : "누르면 목록으로 갑니다") },
        el("i", { style: "background:" + d.color }),
        el("span", { className: "name", text: d.key }));
      b.addEventListener("click", function () { if (peek) peek(d, b, slices[i]); else go(d); });
      b.addEventListener("pointerenter", function (e) { hover(i, e); });
      b.addEventListener("pointerleave", function (e) { hover(-1, e); });
      b.addEventListener("focus", function () { if (b.matches(":focus-visible")) hover(i); });
      b.addEventListener("blur", function () { if (hoverIdx === i) hover(-1); });
      rows.push(b);
      list.append(el("li", { style: "--i:" + i }, b));
    });
    svg.append(totalText, capText, pctText);
    return el("div", { className: "donut-wrap" + (side ? " side" : ""), style: side ? "--legend:" + legendW + "px" : null },
      el("div", { className: "donut-box", style: "width:" + S + "px;height:" + S + "px" }, svg), list);
  }

  /* 조각 색: 많은 순으로 진한 색부터, '기타'는 회색. 비율은 전체(total) 대비 */
  function donutData(rows, palette, total, what) {
    var shade = 0;
    return rows.filter(function (d) { return d.n > 0; })
      .sort(function (a, b) { return (a.key === "기타") - (b.key === "기타") || b.n - a.n; })
      .map(function (d) {
        d.color = d.key === "기타" ? DONUT_OTHER : palette[Math.min(palette.length - 1, shade++)];
        d.what = what(d.key);
        d.pct = total ? Math.round(d.n / total * 100) : 0;
        return d;
      });
  }

  function supportCard() {
    var byCat = svcKind === "cat";
    var keys = byCat ? (META.serviceCats || []) : META.supports;
    var all = svcCount("all") || 0;
    var data = donutData(keys.map(function (x) { return { key: x, n: svcCount((byCat ? "cat:" : "sp:") + x) || 0 }; }),
      DONUT_GREENS, all, function (k) { return byCat ? k + " 분야 상시 제도" : k + " 방식으로 지원하는 상시 제도"; });
    function go(d) { goTo(byCat ? { tab: "services", cg: [d.key] } : { tab: "services", sp: [d.key] }); }
    function peek(d, node, pair) {
      var key = (byCat ? "cat:" : "sp:") + d.key;
      openPeek("svc:" + key, node, function () {
        return servicePeek(key, { title: regionPrefix() + d.what, n: d.n, more: byCat ? { cg: [d.key] } : { sp: [d.key] } });
      }, [pair]);
    }
    function draw() {
      return donutFigure(data, all, "상시 제도", byCat ? "분야별 상시 제도 수" : "지원 방식별 상시 제도 수", go, peek);
    }
    // 제목은 두 보기에 같게 둔다(더 긴 제목이 좁은 화면에서 두 줄이 되면 카드 높이가 바뀐다)
    var card = vizCard("제도는 무엇을 지원하나요?",
      byCat ? "상시 제도 기준 · 분야별" : "상시 제도 기준 · 지원 방식별(여러 방식이면 겹쳐 셈)", draw(), null,
      segToggle("svc", "상시 제도 나누는 기준", [{ value: "cat", label: "분야" }, { value: "sp", label: "지원 방식" }], svcKind,
        function (v) { svcKind = v; }));
    return card;
  }

  /* 공고는 무엇을 지원하나요?: 지금 신청할 수 있는 모집 공고(홈에서 고른 지역 적용)의 분야(nf) 도넛, 파랑.
   * 분야는 기업마당 지원분야·K-Startup 분류를 맞춘 것(build_site.py NOTICE_FIELDS), 국고보조금은 '기타'.
   * 조각이나 목록을 누르면 그 분야의 모집 공고 목록으로 간다 */
  function noticeFieldCard(live) {
    var n = countBy(live, function (i) { return i.nf; });
    var data = donutData((META.noticeFields || []).map(function (x) { return { key: x, n: n[x] || 0 }; }),
      DONUT_BLUES, live.length, function (k) { return k + " 분야 모집 공고"; });
    function go(d) { goTo({ tab: "open", cg: [d.key] }); }
    function peek(d, node, pair) {
      openPeek("nf:" + d.key, node, function () {
        var items = live.filter(function (i) { return i.nf === d.key; });
        return noticePeek(items, regionPrefix() + d.what, "지금 신청할 수 있는 것",
          { label: fmtN(items.length) + "건 모두 보기", go: function () { go(d); } }, undefined, undefined, "nf");
      }, [pair]);
    }
    var card = vizCard("공고는 무엇을 지원하나요?", "모집 공고 기준",
      donutFigure(data, live.length, "모집 공고", "분야별 모집 공고 수", go, peek), null);
    return card;
  }


  /* 곧 올라올 수 있는 공고: 작년 이맘때 접수를 시작한 국고보조금 공고(META.upcoming, build_site.py가 사업별로 묶음) */
  var upcomingShown = HOME_FIRST;
  function upcomingRow(u) {
    var last = fmtDate(u.od, true);
    var b = el("button", { className: "row", type: "button",
      "aria-label": u.t + ". 작년 " + last + " 접수 시작. " + (u.cid ? "올해 공고가 올라와 있습니다" : "올해 공고는 아직 없습니다") },
      el("span", { className: "row-main" },
        el("span", { className: "row-title", text: u.t }),
        el("span", { className: "row-meta", text: [u.ag, regionText(u), fmtDate(u.od) + " 시작", u.bg ? "사업 예산 " + u.bg : ""]
          .filter(Boolean).join(" · ") })),
      el("span", { className: "row-side" },
        u.cid ? badge("올해 공고 있음", "new") : badge("아직 없음", "soft")));
    b.title = u.cid ? "올해 공고 보기" : "작년 공고 원문 보기(새 창)";
    b.addEventListener("click", function () {
      if (u.cid) goTo({ tab: /^gov24:/.test(u.cid) ? "services" : "open", id: u.cid });
      else if (safeUrl(u.u)) window.open(safeUrl(u.u), "_blank", "noopener");
    });
    return el("li", null, b);
  }

  function upcomingCard() {
    var up = META.upcoming || { items: [] };
    var items = up.items.filter(inRegion);
    var list = el("ul", { className: "results upcoming" });
    fillList(list, items.slice(0, upcomingShown).map(upcomingRow), "해당하는 공고가 없습니다.");
    var foot = null;
    if (items.length > upcomingShown) {
      var more = el("button", { type: "button", className: "btn gray more", text: "더 보기 (" + fmtN(items.length - upcomingShown) + "건 더)" });
      more.addEventListener("click", function () {
        var prev = upcomingShown, top = list.scrollTop;
        upcomingShown += HOME_STEP;
        renderHome();
        var ul = document.querySelector("#homeCharts .results.upcoming");
        if (ul) revealNew(ul, prev, top, ul.closest(".viz-card").querySelector(".more"));
      });
      foot = el("div", null, more);
    }
    function md(iso) { var p = iso.split("-"); return (+p[1]) + "." + (+p[2]); }
    var range = up.from ? md(up.from) + "~" + md(up.to) : "";
    var card = vizCard("곧 올라올 수 있는 공고",
      "작년 " + range + "에 접수를 시작한 국고보조금 공고 " + fmtN(items.length) + "개",
      list, foot);
    card.classList.add("list-card");
    card._expandable = items.length > HOME_FIRST;
    return card;
  }

  function renderCharts(live) {
    closePeek(false); // 표시가 새로 그려지므로 열린 요약 창은 닫는다
    chartsDrawnAt = chartWidth();
    $("#vizTip").hidden = true;
    var support = supportCard();
    support.querySelector(".viz-body").classList.add("top"); // 옆 목록 카드가 길어도 막대는 제목 바로 아래에
    var due = dueCard(live), months = openMonthsCard();
    due.querySelector(".viz-body").classList.add("bottom");
    months.querySelector(".viz-body").classList.add("top"); // 범례를 제목 바로 아래에, 남는 높이는 그래프가 채운다
    var persona = personaCard(live);
    persona.querySelector(".viz-body").classList.add("top"); // 범례를 제목 바로 아래에
    var fields = noticeFieldCard(live);
    fields.querySelector(".viz-body").classList.add("top");
    var upcoming = upcomingCard(), region = regionCard();
    var cards = [persona, region, due, months, fields, support, upcoming];
    ["persona", "map", "due", "months", "nf", "svc", "upcoming"].forEach(function (k, i) { cards[i].dataset.key = k; });
    // 그래프를 누르면 요약이 뜬다는 안내(휴대폰은 가리키기가 없어 단서가 필요하다)
    var hint = el("p", { className: "charts-hint" }, icon("hand-tap"), "그래프의 막대·칸·지역을 누르면 요약을 볼 수 있어요");
    $("#homeCharts").replaceChildren.apply($("#homeCharts"), [hint].concat(cards));
    fitListHeight(upcoming.querySelector(".results"), upcoming._expandable, WIDE_CHARTS); // 막대 채우기보다 먼저
    [persona, months].forEach(fillCard);
    setupMotion(cards);
    placeSegGliders(); // 글꼴이 온 뒤 그래프만 다시 그릴 때도 전환 단추 알약을 맞춘다
  }

  /* ---------- 그래프 움직임 ----------
   * 카드가 화면에 들어올 때(play): 카드가 올라오며 나타나고 막대가 자라나고 선이 그려진다.
   * 스크롤로 카드가 화면 밖으로 완전히 나가면 다시 준비(pending)해 두었다가, 돌아오면 또 움직인다.
   * 다른 탭에서 홈으로 돌아오면 seenCards를 비워 다시 처음처럼 움직인다.
   * 지역을 바꾸거나 카드의 전환 단추를 누르면 바뀐 그래프만 다시 자라난다(replay). 창 크기 변경 등은 그대로.
   * 움직임 줄이기 설정이면 style.css에서 모두 끈다. 웹 글꼴을 기다린 뒤 시작한다(글꼴이 오면 다시 그리므로) */
  var seenCards = {}, animScope = null, chartObserver = null, chartGen = 0;
  var fontsReady = document.fonts && document.fonts.ready ?
    Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1500); })]) : Promise.resolve();

  function setupMotion(cards) {
    var scope = animScope, gen = ++chartGen;
    animScope = null;
    if (chartObserver) chartObserver.disconnect();
    if (!("IntersectionObserver" in window)) return;
    chartObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var c = e.target, pending = c.classList.contains("pending");
        if (!e.isIntersecting) {
          // 화면 밖으로 완전히 나갔다: 다음에 들어올 때 다시 움직이게 준비
          if (!pending) { c.classList.remove("play", "replay"); c.classList.add("pending"); delete seenCards[c.dataset.key]; }
        } else if (pending && e.intersectionRatio >= 0.2) {
          c.classList.remove("pending");
          c.classList.add("play");
          seenCards[c.dataset.key] = true;
        }
      });
    }, { threshold: [0, 0.2] });
    // 카드 전환 단추로 다시 그릴 때(scope = 그 카드)는 그 카드만 움직인다. 다른 카드는 아직 '본 적 없음'이어도
    // 지금 화면에 보이면 본 것으로 치고 그대로 둔다(옆 카드 단추를 눌렀는데 이 카드가 처음처럼 움직이지 않게)
    var vh = window.innerHeight || document.documentElement.clientHeight;
    cards.forEach(function (c) {
      var key = c.dataset.key;
      if (!seenCards[key] && scope && scope !== "all" && scope !== key) {
        var r = c.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) seenCards[key] = true;
      }
      if (!seenCards[key]) c.classList.add("pending");
      else if (scope === "all" || scope === key) c.classList.add("replay");
    });
    fontsReady.then(function () {
      if (gen === chartGen) cards.forEach(function (c) { chartObserver.observe(c); });
    });
  }

  function fillCard(card) {
    var body = card.querySelector(".viz-body"), svg = body.querySelector("svg.hb, svg.month-chart");
    if (!svg || !card._redraw) return;
    var used = (svg.closest(".viz-fig") || svg).getBoundingClientRect().height;
    var free = body.clientHeight - (parseFloat(getComputedStyle(body).paddingTop) || 0) - used;
    if (free >= 12) svg.replaceWith(card._redraw(svg.getBoundingClientRect().height + free - 2));
  }

  /* ---------- 이벤트 ---------- */

  /* 머리(지원모아 이름·소리·글자 크게)는 그대로 두고 탭 줄만 위에 고정한다.
   * 스크롤로 머리의 단추가 화면 밖으로 나가면 그 단추 묶음(.top-actions)을 탭 줄 오른쪽(#tabsDock)으로 옮기고,
   * 다시 보일 만큼 올라오면 제자리로 돌려놓는다. 같은 단추를 옮기므로 상태·눌림 동작은 그대로다.
   * 머리에서 빠진 자리는 같은 크기의 빈 칸으로 채워 머리 높이가 흔들리지 않게 한다 */
  function dockTopActions() {
    var actions = document.querySelector(".top-actions"), dock = $("#tabsDock"), tabs = document.querySelector(".tabs");
    var header = document.querySelector("header.top");
    if (!actions || !dock || !header || !("IntersectionObserver" in window)) return;
    var hold = el("div", { className: "top-actions-hold", "aria-hidden": "true" });
    var docked = false;
    function setDocked(on) {
      if (on === docked) return;
      var focused = actions.contains(document.activeElement) ? document.activeElement : null;
      if (on) {
        var r = actions.getBoundingClientRect();
        hold.style.width = Math.round(r.width) + "px";
        hold.style.height = Math.round(r.height) + "px";
        actions.replaceWith(hold);
        dock.append(actions);
        // 탭 줄에서는 '글자 크게'가 아이콘만으로 줄어들 수 있으니 옮긴 뒤의 실제 폭을 잰다
        document.documentElement.style.setProperty("--dock-w", Math.round(dock.getBoundingClientRect().width) + "px");
      } else {
        hold.replaceWith(actions);
      }
      tabs.classList.toggle("docked", on);
      docked = on;
      if (focused) focused.focus({ preventScroll: true });
    }
    // 휴대폰(639px 이하)은 이름 줄을 접어(style.css) 단추가 늘 탭 줄에 있다.
    // 넓은 화면은 머리 단추 줄이 화면 위로 나가면(= 가려지면) 옮기고, 다시 보이면 돌려놓는다
    var phone = window.matchMedia("(max-width: 639px)"), scrolledPast = false;
    function update() { setDocked(phone.matches || scrolledPast); }
    var probe = header.querySelector(".top-inner");
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      scrolledPast = !e.isIntersecting && e.boundingClientRect.top < 0;
      update();
    }, { threshold: 0 }).observe(probe);
    if (phone.addEventListener) phone.addEventListener("change", update); else if (phone.addListener) phone.addListener(update);
    update();
  }

  function bind() {
    dockTopActions();
    var tabs = document.querySelectorAll("[role=tab]");
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { switchTab(t.dataset.tab); });
      t.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        var next = tabs[(i + d + tabs.length) % tabs.length];
        next.focus();
        switchTab(next.dataset.tab);
      });
    });

    $("#homeLink").addEventListener("click", function (e) { e.preventDefault(); switchTab("home"); });
    $("#homeSearch").addEventListener("submit", function (e) {
      e.preventDefault();
      goTo({ tab: "open", q: $("#homeQ").value.trim() });
    });
    $("#homeRegion").addEventListener("change", function (e) {
      state.r = e.target.value; animScope = "all"; renderHome(); writeHash(false);
    });
    $("#homeNat").addEventListener("change", function (e) {
      state.nat = e.target.checked; animScope = "all"; renderHome(); writeHash(false);
    });
    $("#homeSoonAll").addEventListener("click", function () { goTo({ tab: "open" }); });
    ["#homeFav", "#homeSoon", "#homeNew", "#homePop"].forEach(function (sel) {
      $(sel).addEventListener("click", function (e) {
        var b = e.target.closest(".row[data-id]");
        if (b) goTo({ tab: /^gov24:/.test(b.dataset.id) ? "services" : "open", id: b.dataset.id });
      });
    });
    $("#homeNewAll").addEventListener("click", function () { goTo({ tab: "open", nw: true, sort: "posted" }); });
    $("#homeTodayNew").addEventListener("click", function () { goTo({ tab: "open", td: true, sort: "posted" }); });
    $("#homeTodayDue").addEventListener("click", function () { goTo({ tab: "open", due: today + "~" + today }); });
    [["#homeSoonMore", "soon", "#homeSoon"], ["#homeNewMore", "fresh", "#homeNew"], ["#homePopMore", "pop", "#homePop"]]
      .forEach(function (m) {
        $(m[0]).addEventListener("click", function () {
          var ul = $(m[2]), prev = homeShown[m[1]], top = ul.scrollTop;
          homeShown[m[1]] += HOME_STEP;
          renderHomeLists(homeLive());
          revealNew(ul, prev, top, $(m[0]));
        });
      });
    // 넓은·좁은 화면이 바뀌면 목록 칸 높이를 다시 정한다
    [WIDE_LISTS, WIDE_CHARTS].forEach(function (q) {
      var mq = window.matchMedia(q);
      var redo = function () { if (state.tab === "home") renderHome(); };
      if (mq.addEventListener) mq.addEventListener("change", redo); else if (mq.addListener) mq.addListener(redo);
    });
    $("#homePopKind").append(el("span", { className: "seg-glider", "aria-hidden": "true" }));
    document.querySelectorAll("#homePopKind button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.pop === popKind) return;
        var from = $("#homePopKind [aria-pressed=\"true\"]");
        segFrom.pop = from ? { left: from.offsetLeft, width: from.offsetWidth } : null;
        popKind = b.dataset.pop;
        homeShown.pop = HOME_FIRST;
        renderPopular(homeLive());
        placeSegGliders();
      });
    });

    var timer = null;
    $("#q").addEventListener("input", function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = e.target.value.trim(); shown = PAGE; renderList(); writeHash(false); }, 200);
    });
    $("#region").addEventListener("change", function (e) { state.r = e.target.value; changed(false); });
    $("#withNational").addEventListener("change", function (e) { state.nat = e.target.checked; changed(false); });
    $("#priv").addEventListener("change", function (e) { state.pv = e.target.checked; changed(false); });
    // 내 조건: 나이는 입력을 멈추면(0.4초) 바로 거른다
    var ageTimer = null;
    $("#meAge").addEventListener("input", function (e) {
      clearTimeout(ageTimer);
      ageTimer = setTimeout(function () {
        var v = e.target.value.replace(/\D/g, "").slice(0, 3);
        state.ag = v && +v <= 120 ? String(+v) : "";
        saveMe(); changed(false);
      }, 400);
    });
    $("#meInc").addEventListener("change", function (e) { state.ic = e.target.value; saveMe(); changed(false); });
    $("#meSex").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-sx]");
      if (!b) return;
      state.sx = state.sx === b.dataset.sx ? "" : b.dataset.sx;
      saveMe(); changed(false);
    });
    $("#meClear").addEventListener("click", function () { state.ag = state.ic = state.sx = ""; saveMe(); changed(false); });
    $("#sort").addEventListener("change", function (e) { state.sort = e.target.value; changed(false); });
    $("#soonToggle").addEventListener("click", function () { state.soon = !state.soon; changed(false); });

    $("#filters").addEventListener("click", function (e) {
      var c = e.target.closest(".chip[data-key]");
      if (!c) return;
      var arr = state[c.dataset.key];
      var i = arr.indexOf(c.dataset.value);
      if (i >= 0) arr.splice(i, 1); else arr.push(c.dataset.value);
      if (c.dataset.key === "au") {
        if (!agriSelected()) state.tp = [];
        setupTopics();
      }
      changed(false);
    });

    $("#activeFilters").addEventListener("click", function (e) {
      var c = e.target.closest("[data-clear]");
      if (!c) return;
      var clear = $("#activeFilters")._clears[+c.dataset.clear];
      if (clear) { clear(); setupTopics(); changed(false); }
    });

    document.addEventListener("click", function (e) {
      var a = e.target.closest("[data-action]");
      if (!a) return;
      var act = a.dataset.action;
      if (act === "reset") resetFilters();
      else if (act === "retry") renderList();
      else if (act === "close") closeDetail();
    });


    $("#results").addEventListener("click", function (e) {
      var b = e.target.closest(".row[data-id]");
      if (b) openDetail(b.dataset.id, b);
    });
    $("#more").addEventListener("click", function () {
      shown += PAGE;
      renderList();
    });

    function openFilters() {
      document.body.classList.add("filters-open", "lock");
      $("#filterOpen").setAttribute("aria-expanded", "true");
      $("#filtersTitle").focus();
    }
    function closeFilters() {
      document.body.classList.remove("filters-open");
      if (!document.body.classList.contains("detail-open") || !narrow()) document.body.classList.remove("lock");
      $("#filterOpen").setAttribute("aria-expanded", "false");
      $("#filterOpen").focus();
    }
    $("#filterOpen").addEventListener("click", openFilters);
    $("#filterClose").addEventListener("click", closeFilters);
    $("#filterDone").addEventListener("click", closeFilters);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (document.body.classList.contains("filters-open")) closeFilters();
      else if (state.id && narrow()) closeDetail();
    });

    window.addEventListener("popstate", function () {
      var wasHome = state.tab === "home";
      state = readHash();
      applyView();
      if (state.tab === "home") {
        if (!wasHome) seenCards = {}; // 뒤로 가기로 홈에 돌아와도 다시 움직인다
        renderHome();
        renderDetail();
        return;
      }
      setupFilters();
      shown = PAGE;
      renderList();
      renderDetail();
    });

    var fontBtn = $("#fontToggle");
    function applyFont(large) {
      document.documentElement.dataset.size = large ? "large" : "";
      fontBtn.setAttribute("aria-pressed", String(large));
      fontBtn.querySelector("span").textContent = large ? "글자 보통" : "글자 크게";
    }
    try { applyFont(localStorage.getItem("hub-size") === "large"); } catch (e) { applyFont(false); }
    fontBtn.addEventListener("click", function () {
      var large = fontBtn.getAttribute("aria-pressed") !== "true";
      applyFont(large);
      try { localStorage.setItem("hub-size", large ? "large" : ""); } catch (e) { /* 저장 못 해도 동작 */ }
      if (state.tab === "home") renderHome();
    });
  }

  function init() {
    ["#region", "#homeRegion"].forEach(function (sel) {
      var region = $(sel);
      META.regions.forEach(function (r) { region.append(el("option", { value: r, text: r })); });
    });
    renderBasis();
    renderTabCounts();
    bind();
    bindFooter();
    applyView();
    // 웹 글꼴이 오면 가로 막대 이름 칸 폭을 다시 재도록 한 번 더 그린다(움직임은 이 뒤에 시작)
    fontsReady.then(function () { if (state.tab === "home") renderCharts(homeLive()); });
    if (state.tab === "home") {
      renderHome();
      renderDetail();
    } else {
      setupFilters();
      renderList();
      renderDetail();
    }
    // 첫 화면을 그린 뒤 공고 긴 글을 받아 둔다(검색·상세가 쓴다)
    setTimeout(ensureNoticeText, 0);
  }

  init();
})();
