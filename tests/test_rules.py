"""수집 자료를 화면용으로 고르는 규칙(collector/normalize.py, build_site.py) 회귀 테스트.

표준 라이브러리 unittest만 쓴다(이 저장소는 외부 패키지를 설치하지 않는다).
    python3 -m unittest discover -s tests -v
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "collector"))

import build_site  # noqa: E402
import normalize as n  # noqa: E402


class ParsePeriodTest(unittest.TestCase):
    """신청기간 원문 → (시작, 마감, 종류). 원문에 없는 날짜를 만들지 않는다."""

    def kind(self, text):
        return n.parse_period(text)[2]

    def test_dates_win_over_words(self):
        self.assertEqual(n.parse_period("2026.10.01 ~ 2026.10.15"), ("2026-10-01", "2026-10-15", "기간"))
        self.assertEqual(n.parse_period("~ 2026년 11월 30일 18:00"), (None, "2026-11-30", "기간"))
        # 날짜가 있으면 '상이' 같은 단어가 섞여 있어도 기간으로 본다
        self.assertEqual(self.kind("2026.10.01~2026.10.15 (기관별 상이)"), "기간")

    def test_no_application_needed(self):
        for text in ("신청 불필요", "직권신청", "서비스 신청없이 자동가입", "별도 신청 없음(추천)"):
            self.assertEqual(self.kind(text), "신청불필요", text)

    def test_until_budget_runs_out(self):
        for text in ("예산 소진 시까지", "선착순", "모집규모 충족시", "선순 마감", "출연금 소진 시까지"):
            self.assertEqual(self.kind(text), "소진시", text)

    def test_always_open(self):
        for text in ("상시", "연중 수시 접수"):
            self.assertEqual(self.kind(text), "상시", text)

    def test_deadline_counts_from_an_event(self):
        for text in ("분만일로부터 6개월 이내", "사고일로부터 3년 이내", "혼인신고일로부터 1년 경과 후 ~ 5년 이내",
                     "전입일부터 만 5년이내 신청 가능"):
            self.assertEqual(self.kind(text), "사유발생", text)

    def test_monthly_or_quarterly(self):
        for text in ("매월 10일 18:00까지", "분기별 사전신청", "매주 월요일 오전 10시 예약"):
            self.assertEqual(self.kind(text), "주기", text)

    def test_yearly(self):
        for text in ("매년 3월", "1~2월(모집기간 별도)", "상반기 중"):
            self.assertEqual(self.kind(text), "정기", text)

    def test_differs_by_agency(self):
        for text in ("접수기관 별 상이", "세부사업별 상이", "자세한 날짜는 시군구청에 따라 다를 수 있음"):
            self.assertEqual(self.kind(text), "기관별", text)

    def test_unknown_stays_unknown(self):
        # 해석할 근거가 없는 글은 '확인 필요'로 남긴다(신청 불필요 등으로 추측하지 않는다)
        for text in ("추후 공지", "공고에 따름"):
            self.assertEqual(self.kind(text), "별도", text)
        for text in ("해당없음", "", "-"):
            self.assertEqual(self.kind(text), "미상", repr(text))


class StatusTest(unittest.TestCase):
    def rec(self, ptype, start=None, end=None):
        return {"period_type": ptype, "apply_start": start, "apply_end": end}

    def test_dated_status_by_today(self):
        today = "2026-10-02"
        self.assertEqual(n.status_of(self.rec("기간", "2026-10-05", "2026-10-30"), today), "접수 예정")
        self.assertEqual(n.status_of(self.rec("기간", "2026-09-01", "2026-10-02"), today), "접수 중")
        self.assertEqual(n.status_of(self.rec("기간", "2026-09-01", "2026-10-01"), today), "마감")

    def test_every_period_type_has_a_label(self):
        kinds = {kind for kind, _ in n.PERIOD_RULES} | {"미상"}
        for kind in kinds:
            self.assertTrue(n.status_of(self.rec(kind), "2026-10-02"), kind)
        self.assertEqual(n.status_of(self.rec("기관별"), "2026-10-02"), "기관별로 다름")
        self.assertEqual(n.status_of(self.rec("미상"), "2026-10-02"), "확인 필요")

    def test_app_js_knows_every_label(self):
        """화면(site/app.js)의 상태 목록이 수집기 상태 이름과 어긋나면 필터 칩·정렬이 빠진다."""
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        for label in set(n.STATUS_BY_TYPE.values()) | {"접수 중", "접수 예정"}:
            self.assertIn(f'"{label}"', app, label)


class TextHelpersTest(unittest.TestCase):
    def test_clean_text(self):
        self.assertEqual(n.clean_text("<p>가&amp;나</p><br>다"), "가&나\n다")
        self.assertEqual(n.clean_text(None), "")

    def test_substantive_drops_filler(self):
        self.assertEqual(n.substantive("공고문 참조"), "")
        self.assertEqual(n.substantive("서울시 강남구"), "서울시 강남구")

    def test_money_and_age(self):
        self.assertEqual(n.won(1234567890), "12억 3,456만 원")
        self.assertEqual(n.won(0), "")
        self.assertEqual(n.age_text(19, 39), "19~39세")

    def test_region_from_agency_name(self):
        self.assertEqual(n.regions_from_name("충청북도 청주시"), {"충북"})
        self.assertEqual(n.regions_from_name("(재)경기테크노파크"), {"경기"})
        self.assertEqual(n.regions_from_name("중소벤처기업부"), set())


class PersonaTest(unittest.TestCase):
    def test_title_words(self):
        self.assertIn("청년", n.personas_for(["2026년 청년 창업 지원사업"]))

    def test_livestock_disease_is_not_a_patient_program(self):
        # '가축질병'·'온열질환 예방'이 질병·질환자로 걸렸던 회귀
        self.assertNotIn("질병·질환자", n.personas_for(["가축질병 예방 지원"]))


class DedupeTest(unittest.TestCase):
    def notice(self, nid, pd, **over):
        base = {"id": nid, "src": "bizinfo", "t": "같은 공고", "ag": "해양수산부", "s": None, "e": "2026-10-30",
                "rg": ["전국"], "pd": pd}
        base.update(over)
        return base

    def test_keeps_latest_of_identical_reposts(self):
        a, b = self.notice("bizinfo:1", "2026-07-14"), self.notice("bizinfo:2", "2026-08-12")
        self.assertEqual(build_site.dedupe_notices([a, b]), [b])

    def test_keeps_both_when_anything_differs(self):
        a = self.notice("bizinfo:1", "2026-07-14")
        for change in ({"e": "2026-12-31"}, {"ag": "경상남도"}, {"rg": ["경남"]}, {"src": "kstartup"}, {"t": "다른 공고"}):
            b = self.notice("bizinfo:2", "2026-08-12", **change)
            self.assertEqual(len(build_site.dedupe_notices([a, b])), 2, change)

    def test_order_is_preserved(self):
        items = [self.notice(f"x:{i}", "2026-01-01", t=f"공고 {i}") for i in range(5)]
        self.assertEqual(build_site.dedupe_notices(items), items)


class NoticeFieldTest(unittest.TestCase):
    """출처별 분류 → 모집 공고 분야. 모르는 분류와 국고보조금은 '기타'."""

    def test_mapping(self):
        f = build_site.notice_field
        self.assertEqual(f("bizinfo", "금융"), "자금·융자")
        self.assertEqual(f("bizinfo", "내수"), "판로·수출")
        self.assertEqual(f("kstartup", "멘토링ㆍ컨설팅ㆍ교육"), "경영·컨설팅·교육")
        self.assertEqual(f("kstartup", "시설ㆍ공간ㆍ보육"), "시설·공간")
        self.assertEqual(f("bojo", "지역급식관리지원센터 운영"), "기타")
        self.assertEqual(f("bizinfo", "새 분류"), "기타")

    def test_every_target_is_listed(self):
        for table in build_site.NOTICE_FIELD_OF.values():
            for v in table.values():
                self.assertIn(v, build_site.NOTICE_FIELDS)


class TwiceADayTest(unittest.TestCase):
    """하루 두 번 수집: 오전에 있다가 오후 수집에서 사라진 공고는 '현재 자료'에서 빠진다"""

    def test_load_by_run_time(self):
        import sqlite3
        import collect
        import report
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(collect.SCHEMA)

        def rec(uid):
            r = {f: "" for f in collect.FIELDS}
            r.update(uid=uid, source="bizinfo", kind="공고", title=uid, regions="[]", agri="0", content_hash=uid)
            return r
        am, pm = "2026-10-03T09:00:01", "2026-10-03T16:00:01"
        collect.upsert(conn, [rec("a"), rec("b")], "2026-10-03", am)
        conn.execute("INSERT INTO runs VALUES (?, 'bizinfo', 1, 2, 2, 2, 1, '')", (am,))
        self.assertEqual(sorted(r["uid"] for r in report.load(conn)[0]), ["a", "b"])
        collect.upsert(conn, [rec("a")], "2026-10-03", pm)
        conn.execute("INSERT INTO runs VALUES (?, 'bizinfo', 1, 1, 1, 1, 1, '')", (pm,))
        self.assertEqual([r["uid"] for r in report.load(conn)[0]], ["a"])
        # 오후 수집이 실패하면 오전 자료를 그대로 쓴다
        conn.execute("INSERT INTO runs VALUES ('2026-10-04T09:00:01', 'bizinfo', 0, 0, 0, 0, 1, 'x')")
        self.assertEqual([r["uid"] for r in report.load(conn)[0]], ["a"])
        # 다시 정리(seen_at 없음)는 수집 시각을 지우지 않는다
        collect.upsert(conn, [rec("a")], "2026-10-03")
        self.assertEqual([r["uid"] for r in report.load(conn)[0]], ["a"])


class SigunguRegionTest(unittest.TestCase):
    """기관 이름 앞 법인 종류를 떼고 시군구로 지역을 찾는다"""

    def test_prefix(self):
        table = {"의령군": "경남", "임실군": "전북"}
        self.assertEqual(n.regions_from_sigungu("농업회사법인의령군토요애유통(주)", table), {"경남"})
        self.assertEqual(n.regions_from_sigungu("(주)임실군치즈", table), {"전북"})
        self.assertEqual(n.regions_from_sigungu("남도장학회", table), set())


class LimitsTest(unittest.TestCase):
    """'내 조건으로 거르기'용 나이·소득·성별 값"""

    def test_age(self):
        f = build_site.age_range
        self.assertEqual(f("19~34세"), [19, 34])
        self.assertEqual(f("만 20세 이상"), [20, 999])
        self.assertEqual(f("17세 이하"), [0, 17])
        self.assertEqual(f("만 20세 미만"), [0, 19])
        self.assertEqual(f("만 20~39세"), [20, 39])
        self.assertIsNone(f("만 20세 미만, 만 40세 이상"))  # 여러 구간은 거르지 않는다
        self.assertIsNone(f(""))

    def test_income(self):
        f = build_site.income_range
        self.assertEqual(f("중위소득 50% 이하"), [0, 50])
        self.assertEqual(f("중위소득 75% 초과"), [76, 999])
        self.assertEqual(f("중위소득 51~100%"), [51, 100])
        self.assertIsNone(f("소득 무관"))

    def test_limits(self):
        cd = [["나이", "19~34세"], ["소득", "중위소득 100% 이하"], ["성별", "여성"], ["개인 특성", "대학생"]]
        self.assertEqual(build_site.limits(cd), {"na": [19, 34], "ic": [0, 100], "sx": "f"})
        self.assertEqual(build_site.limits([["나이", "만 20세 미만, 만 40세 이상"]]), {})


class NoticeTextSplitTest(unittest.TestCase):
    """첫 화면을 가볍게: 공고 목록에서 긴 글만 떼고 검색·목록에 쓰는 칸은 남긴다"""

    def test_split(self):
        items = [{"id": "bizinfo:1", "t": "제목", "ag": "기관", "op": "수행", "sm": "개요", "how": "방법", "u": "https://x", "e": "2026-10-09"},
                 {"id": "bojo:2", "t": "제목2", "ag": "부처"}]
        text = build_site.split_notice_text(items)
        self.assertEqual(text, {"bizinfo:1": {"sm": "개요", "how": "방법", "u": "https://x"}})
        self.assertEqual(items[0], {"id": "bizinfo:1", "t": "제목", "ag": "기관", "op": "수행", "e": "2026-10-09"})
        self.assertEqual(items[1], {"id": "bojo:2", "t": "제목2", "ag": "부처"})


class ServicePeekTest(unittest.TestCase):
    """홈 요약 창의 공공서비스 대상 요약: 전체·지역·전국 칸, 분야·방식 건수, 조회수 상위 3개"""

    def test_cells(self):
        def svc(i, pp, rg, cat, sp, vw):
            return {"id": f"gov24:{i}", "src": "gov24", "k": "s", "t": f"제도{i}", "pp": pp, "rg": rg,
                    "cat": cat, "sp": sp, "vw": vw, "sm": "길게 남기지 않는 글"}
        items = [svc(1, ["청년"], ["전국"], "고용·창업", ["현금"], 50),
                 svc(2, ["청년", "구직자"], ["경기"], "고용·창업", ["현금", "융자"], 30),
                 svc(3, ["청년"], ["경기", "서울"], "주거·자립", ["융자"], 0),
                 svc(4, ["청년"], ["서울"], "생활안정", [], 90),
                 svc(5, ["청년"], ["전국"], "생활안정", ["현물"], 10)]
        p = build_site.service_peek(items)
        self.assertEqual(p["total"]["청년"]["cat"], {"고용·창업": 2, "주거·자립": 1, "생활안정": 2})
        self.assertEqual(p["total"]["청년"]["sp"], {"현금": 2, "융자": 2, "현물": 1})
        self.assertEqual(p["total"]["청년"]["top"], ["gov24:4", "gov24:1", "gov24:2"])  # 조회수 0은 뺀다
        self.assertEqual(p["region"]["경기"]["청년"]["cat"], {"고용·창업": 1, "주거·자립": 1})
        self.assertEqual(p["national"]["청년"]["top"], ["gov24:1", "gov24:5"])
        self.assertNotIn("청년", p["region"]["부산"])  # 없는 대상은 칸을 만들지 않는다
        # 도넛용 분야·방식 칸과 전체 칸
        self.assertEqual(p["total"]["cat:생활안정"]["pp"], {"청년": 2})
        self.assertEqual(p["total"]["sp:융자"]["cat"], {"고용·창업": 1, "주거·자립": 1})
        self.assertEqual(p["region"]["서울"]["all"]["top"], ["gov24:4"])
        self.assertEqual(p["total"]["all"]["pp"], {"청년": 5, "구직자": 1})
        self.assertNotIn("sm", p["items"]["gov24:1"])  # 짧은 항목만
        self.assertEqual(set(p["items"]), {"gov24:1", "gov24:2", "gov24:4", "gov24:5"})


class PersonaHistoryTest(unittest.TestCase):
    """대상별 올해 공고 집계: 끝난 공고(마감·목록에서 사라짐)를 따로 세고, 다른 해·제도·재게시는 빼거나 하나로."""

    def row(self, uid, **over):
        base = {"uid": uid, "source": "bizinfo", "kind": "공고", "title": "공고 " + uid, "agency": "중소벤처기업부",
                "operator": "", "category": "", "target": "", "summary": "", "content": "", "how": "",
                "audience": "[]", "personas": '["중소기업"]', "posted": "2026-09-01", "views": "0", "support": "[]",
                "period_text": "", "period_type": "기간", "apply_start": "2026-09-01", "apply_end": "2026-12-31",
                "regions": ["전국"], "region_basis": "", "agri": 0, "is_private": "0", "url": "", "apply_url": "",
                "contact": "", "source_updated": "", "first_seen": "2026-09-30", "last_seen": "2026-10-02"}
        base.update(over)
        return base

    def test_open_closed_gone_and_skips(self):
        rows = [
            self.row("bizinfo:1"),                                            # 열린 공고
            self.row("bizinfo:2", apply_end="2026-09-15"),                    # 마감일 지남
            self.row("bizinfo:3", last_seen="2026-10-01"),                    # 출처 목록에서 사라짐
            self.row("bizinfo:4", apply_start="2025-03-01", apply_end="2025-04-01"),  # 작년 공고
            self.row("bizinfo:6", apply_start="2025-11-01", apply_end="2026-01-31", title="해 넘긴 공고"),  # 올해 1월까지: 끝남
            self.row("bizinfo:7", apply_start=None, apply_end=None, period_type="상시", posted="2024-05-01",
                     title="상시 공고"),  # 날짜 없는 열린 공고: 열림
            self.row("gov24:1", source="gov24", kind="제도"),                 # 제도는 세지 않음
            self.row("bizinfo:5", title="공고 bizinfo:1", posted="2026-08-01"),  # bizinfo:1 재게시
        ]
        h = build_site.persona_history(rows, {"bizinfo": "2026-10-02", "gov24": "2026-10-02"}, "2026-10-02")
        self.assertEqual(h["year"], 2026)
        self.assertEqual(h["total"]["open"]["중소기업"], 2)
        self.assertEqual(h["total"]["closed"]["중소기업"], 3)
        self.assertEqual(h["bySource"]["bizinfo"]["closed"]["all"], 3)
        self.assertEqual(h["national"]["open"]["all"], 2)
        self.assertNotIn("gov24", h["bySource"])


if __name__ == "__main__":
    unittest.main()


class NewServicesTest(unittest.TestCase):
    """홈 '새로 생긴 공공서비스': 첫 수집 날 것은 빼고, 최근 30일 안에 처음 보인 제도를 새것부터."""

    def test_pick_and_order(self):
        import datetime
        s = [
            {"id": "gov24:1", "src": "gov24", "k": "s", "t": "첫날", "fs": "2026-09-30", "vw": 9},
            {"id": "gov24:2", "src": "gov24", "k": "s", "t": "옛날", "fs": "2026-08-01", "vw": 9},
            {"id": "gov24:3", "src": "gov24", "k": "s", "t": "어제", "fs": "2026-10-02", "vw": 1, "rg": ["서울"]},
            {"id": "gov24:4", "src": "gov24", "k": "s", "t": "오늘", "fs": "2026-10-03", "vw": 0},
        ]
        out = build_site.new_services(s, "2026-09-30", datetime.date(2026, 10, 3))
        self.assertEqual([i["t"] for i in out], ["오늘", "어제"])
        self.assertEqual(out[1]["rg"], ["서울"])
        self.assertEqual(out[0]["fs"], "2026-10-03")


class DueServicesTest(unittest.TestCase):
    """홈 마감 숫자·목록·달력에 함께 넣는 '마감일 있는 공공서비스': 기간형이고 마감이 오늘 이후인 것만, 마감 빠른 순."""

    def test_due_services(self):
        import datetime
        s = [
            {"id": "gov24:1", "src": "gov24", "k": "s", "t": "늦게", "py": "기간", "s": "2026-09-01", "e": "2026-11-30", "rg": ["서울"]},
            {"id": "gov24:2", "src": "gov24", "k": "s", "t": "지남", "py": "기간", "e": "2026-10-02"},
            {"id": "gov24:3", "src": "gov24", "k": "s", "t": "상시", "py": "상시"},
            {"id": "gov24:4", "src": "gov24", "k": "s", "t": "오늘", "py": "기간", "e": "2026-10-03", "cd": [["나이", "만 19세"]],
             "cat": "보육·교육", "pp": ["청년"]},
            {"id": "gov24:5", "src": "gov24", "k": "s", "t": "날짜 없음", "py": "기간"},
        ]
        out = build_site.due_services(s, datetime.date(2026, 10, 3))
        self.assertEqual([i["t"] for i in out], ["오늘", "늦게"])
        self.assertNotIn("cd", out[0])  # 홈에 필요한 짧은 값만(요약 창용 분야·대상은 남김)
        self.assertEqual((out[0]["cat"], out[0]["pp"]), ("보육·교육", ["청년"]))
        self.assertEqual(out[1]["rg"], ["서울"])


class MeIndexTest(unittest.TestCase):
    """홈 '내 조건에 맞는 지원사업' 자료: 나이·소득·성별 조건이 있는 공공서비스만, 번호로 줄이고 조회수 상위에만 제목."""

    def test_me_index(self):
        s = [
            {"id": "gov24:1", "t": "청년", "ag": "가", "na": [19, 34], "rg": ["서울"], "cat": "고용", "pp": ["청년"], "vw": 9},
            {"id": "gov24:2", "t": "조건 없음", "rg": ["전국"], "cat": "고용", "vw": 99},
            {"id": "gov24:3", "t": "여성", "sx": "f", "ic": [0, 100], "rg": ["전국"], "cat": "보건", "vw": 1},
        ]
        out = build_site.me_index(s)
        self.assertEqual(len(out["rows"]), 2)
        first = out["rows"][0]
        self.assertEqual(first[:3], [[19, 34], 0, 0])
        self.assertEqual(out["rgs"][first[3][0]], "서울")
        self.assertEqual(out["pps"][first[5][0]], "청년")
        self.assertEqual(first[7:], ["1", "청년", "가"])
        self.assertEqual(out["rows"][1][:3], [0, [0, 100], "f"])


class SecurityHeaderTest(unittest.TestCase):
    """첫 화면 인라인 스크립트를 고치면 CSP의 sha256도 함께 바꿔야 한다(안 그러면 운영에서 스크립트가 막힌다)."""

    def test_csp_hash_matches_inline_script(self):
        import base64
        import hashlib
        import re
        html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        bodies = re.findall(r"<script>(.*?)</script>", html, re.S)
        self.assertEqual(len(bodies), 1, "인라인 스크립트가 늘면 CSP에 해시를 더해야 한다")
        h = base64.b64encode(hashlib.sha256(bodies[0].encode("utf-8")).digest()).decode()
        hosting = (ROOT / "deploy" / "setup_hosting.sh").read_text(encoding="utf-8")
        self.assertIn("'sha256-" + h + "'", hosting)

    def test_no_inline_handlers(self):
        # CSP가 막으므로 onclick= 같은 인라인 처리기와 javascript: 주소를 쓰지 않는다
        html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        self.assertNotRegex(html, r"\son[a-z]+\s*=")
        self.assertNotIn("javascript:", html + app)

    def test_terms(self):
        # 용어(docs/DEVELOPMENT.md): 지원사업 = 모집 공고 + 공공서비스. 옛 이름·헷갈리는 말은 화면 글에 쓰지 않는다
        # (공공데이터 이름 「국고보조금 공모사업 상세」 같은 고유 이름만 예외)
        for name in ("site/app.js", "site/index.html", "site/style.css", "README.md"):
            text = (ROOT / name).read_text(encoding="utf-8")
            bads = ("상시 제도", "상시 지원제도", "지금 모집 중") + (() if name == "README.md" else ("공모",))
            for bad in bads:
                n = text.replace("공모사업 상세", "").count(bad)
                self.assertEqual(n, 0, name + ": '" + bad + "' " + str(n) + "곳")
