from datetime import UTC, datetime

from app.services.kis_market import parse_kospi_payload


def test_parse_kospi_payload_sorts_and_normalizes_rows():
    now = datetime(2026, 7, 31, 8, 30, tzinfo=UTC)
    payload = {
        "output1": {
            "hts_kor_isnm": "코스피",
            "bstp_nmix_prpr": "3,245.44",
            "bstp_nmix_prdy_vrss": "12.31",
            "bstp_nmix_prdy_ctrt": "0.38",
            "prdy_nmix": "3233.13",
        },
        "output2": [
            {
                "stck_bsop_date": "20260731",
                "bstp_nmix_prpr": "3245.44",
                "bstp_nmix_oprc": "3238.10",
                "bstp_nmix_hgpr": "3250.01",
                "bstp_nmix_lwpr": "3229.88",
                "acml_vol": "502000000",
            },
            {
                "stck_bsop_date": "20260730",
                "bstp_nmix_prpr": "3233.13",
                "bstp_nmix_oprc": "3220.00",
                "bstp_nmix_hgpr": "3240.00",
                "bstp_nmix_lwpr": "3212.00",
                "acml_vol": "490000000",
            },
        ],
    }

    result = parse_kospi_payload(payload, now)

    assert result["name"] == "KOSPI"
    assert result["marketName"] == "코스피"
    assert result["value"] == 3245.44
    assert result["changePercent"] == 0.38
    assert result["asOf"] == "2026-07-31T08:30:00+00:00"
    assert [point["date"] for point in result["points"]] == [
        "2026-07-30",
        "2026-07-31",
    ]
    assert result["points"][-1]["high"] == 3250.01


def test_parse_kospi_payload_uses_latest_close_when_summary_is_missing():
    result = parse_kospi_payload(
        {
            "output2": [
                {
                    "stck_bsop_date": "20260731",
                    "bstp_nmix_prpr": "3010.25",
                }
            ]
        }
    )

    assert result["name"] == "KOSPI"
    assert result["value"] == 3010.25
    assert result["points"][0]["close"] == 3010.25
