from app.core.config import settings
from app.services.instrument_catalog import Instrument


def test_logo_dev_uses_exchange_suffixes(monkeypatch) -> None:
    monkeypatch.setattr(settings, "logo_dev_publishable_key", "pk_test")
    kospi = Instrument("005930", "삼성전자", "KR", "KRW", "KRX", "005930")
    kosdaq = Instrument(
        "035720",
        "카카오",
        "KR",
        "KRW",
        "KRX",
        "035720",
        listing_market="KOSDAQ",
    )
    nasdaq = Instrument("AAPL", "Apple", "US", "USD", "NAS", "AAPL")

    assert "/ticker/005930.KS?" in kospi.public()["logoUrl"]
    assert "/ticker/035720.KQ?" in kosdaq.public()["logoUrl"]
    assert "/ticker/AAPL?" in nasdaq.public()["logoUrl"]
    assert "token=pk_test" in nasdaq.public()["logoUrl"]


def test_logo_url_is_optional(monkeypatch) -> None:
    monkeypatch.setattr(settings, "logo_dev_publishable_key", None)
    item = Instrument("AAPL", "Apple", "US", "USD", "NAS", "AAPL")
    assert item.public()["logoUrl"] is None
