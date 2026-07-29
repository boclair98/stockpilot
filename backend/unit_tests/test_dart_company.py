import io
import zipfile
from datetime import date
from decimal import Decimal

from app.services.dart_company import (
    financial_highlights,
    parse_amount,
    parse_corp_codes,
    report_candidates,
    safe_http_url,
)


def test_parse_amount_handles_dart_number_formats() -> None:
    assert parse_amount("1,234,567") == Decimal("1234567")
    assert parse_amount("(42)") == Decimal("-42")
    assert parse_amount("-") is None


def test_safe_http_url_allows_only_http_links() -> None:
    assert safe_http_url("www.samsung.com") == "https://www.samsung.com"
    assert safe_http_url("https://example.com/path") == "https://example.com/path"
    assert safe_http_url("javascript:alert(1)") is None


def test_parse_corp_codes_keeps_listed_companies() -> None:
    xml = b"""<result>
      <list><corp_code>00126380</corp_code><stock_code>005930</stock_code></list>
      <list><corp_code>12345678</corp_code><stock_code> </stock_code></list>
    </result>"""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("CORPCODE.xml", xml)
    assert parse_corp_codes(output.getvalue()) == {"005930": "00126380"}


def test_financial_highlights_prefers_consolidated_accounts() -> None:
    rows = [
        {
            "fs_div": "OFS",
            "account_nm": "매출액",
            "thstrm_amount": "100",
            "currency": "KRW",
        },
        {
            "fs_div": "CFS",
            "account_nm": "매출액",
            "thstrm_amount": "200",
            "currency": "KRW",
        },
        {
            "fs_div": "CFS",
            "account_nm": "자산총계",
            "thstrm_amount": "500",
            "currency": "KRW",
        },
    ]
    result = financial_highlights(rows, 2025, "11011")
    assert result["scope"] == "연결"
    assert [metric["value"] for metric in result["metrics"]] == [200.0, 500.0]


def test_report_candidates_use_latest_available_period() -> None:
    assert report_candidates(date(2026, 7, 29)) == [
        (2026, "11013"),
        (2025, "11011"),
    ]
