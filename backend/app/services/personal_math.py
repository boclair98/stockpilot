"""Pure arithmetic and scheduling; Decimal only for all ledger amounts."""

import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo


def aware(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def next_weekly(now, weekday, local_time, timezone):
    if weekday not in range(5):
        raise ValueError("월요일부터 금요일까지 선택해 주세요.")
    hour, minute = map(int, local_time.split(":"))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("실행 시간을 확인해 주세요.")
    zone = ZoneInfo(timezone)
    local = aware(now).astimezone(zone)
    candidate = local.replace(
        hour=hour, minute=minute, second=0, microsecond=0
    ) + timedelta(days=(weekday - local.weekday()) % 7)
    if candidate <= local:
        candidate += timedelta(days=7)
    return candidate.astimezone(UTC)


def parse_ecb(xml, today):
    if len(xml) > 200_000 or "<!DOCTYPE" in xml.upper() or "<!ENTITY" in xml.upper():
        raise ValueError("환율 자료를 확인하지 못했어요.")
    root = ET.fromstring(xml)
    for cube in root.iter():
        if "time" not in cube.attrib:
            continue
        observed = datetime.strptime(cube.attrib["time"], "%Y-%m-%d").date()
        age = (today - observed).days
        if not 0 <= age <= 7:
            raise ValueError("환율 기준일이 오래됐어요.")
        rates = {
            row.attrib.get("currency"): Decimal(row.attrib["rate"])
            for row in cube
            if "rate" in row.attrib
        }
        usd, krw = rates.get("USD"), rates.get("KRW")
        if (
            not usd
            or not krw
            or not usd.is_finite()
            or not krw.is_finite()
            or usd <= 0
            or krw <= 0
            or not Decimal("100") < krw / usd < Decimal("10000")
        ):
            raise ValueError("원화·달러 환율을 확인하지 못했어요.")
        return {
            "rate": str((krw / usd).quantize(Decimal("0.000001"))),
            "date": observed.isoformat(),
            "source": "ECB 일별 기준환율",
            "sourceUrl": "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
        }
    raise ValueError("환율 기준일이 없어요.")


def fx_amount(amount, direction, rate):
    amount, rate = Decimal(str(amount)), Decimal(str(rate))
    if not amount.is_finite() or not rate.is_finite() or amount <= 0 or rate <= 0:
        raise ValueError("환전 금액을 확인해 주세요.")
    unit = Decimal("1") if direction == "KRW_TO_USD" else Decimal("0.01")
    if direction not in {"KRW_TO_USD", "USD_TO_KRW"} or amount != amount.quantize(unit):
        raise ValueError("환전 금액의 단위를 확인해 주세요.")
    received = amount / rate if direction == "KRW_TO_USD" else amount * rate
    received = received.quantize(
        Decimal("0.01") if direction == "KRW_TO_USD" else Decimal("1"),
        rounding=ROUND_DOWN,
    )
    if received <= 0:
        raise ValueError("환전 후 금액이 최소 단위보다 작아요.")
    return received


def split_values(quantity, average_price, ratio):
    quantity, average_price, ratio = map(
        lambda n: Decimal(str(n)), (quantity, average_price, ratio)
    )
    if (
        any(not n.is_finite() or n <= 0 for n in (quantity, ratio))
        or not average_price.is_finite()
        or average_price < 0
    ):
        raise ValueError("분할 수량과 비율을 확인해 주세요.")
    new_quantity = quantity * ratio
    if new_quantity != new_quantity.quantize(Decimal("0.000001")):
        raise ValueError("단주 처리 자료를 확인하기 전에는 반영할 수 없어요.")
    return new_quantity, (average_price / ratio).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )


def verified_source_url(url):
    parsed = urlsplit(url)
    hosts = (
        "dart.fss.or.kr",
        "opendart.fss.or.kr",
        "sec.gov",
        "koreainvestment.com",
        "apiportal.koreainvestment.com",
    )
    return (
        parsed.scheme == "https"
        and not parsed.username
        and not parsed.password
        and parsed.hostname
        and any(
            parsed.hostname == h or parsed.hostname.endswith("." + h) for h in hosts
        )
    )
