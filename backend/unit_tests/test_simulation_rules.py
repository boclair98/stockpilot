import pytest
from fastapi import Response

from app.routes.trading import simulation_rules


@pytest.mark.asyncio
async def test_simulation_rules_are_explicit_and_safe() -> None:
    body = await simulation_rules(Response())

    assert body["isSimulation"] is True
    assert body["initialCash"] == {"KRW": 100_000_000, "USD": 100_000}
    assert {item["key"] for item in body["orderTypes"]} == {
        "MARKET",
        "LIMIT",
        "STOP",
        "STOP_LIMIT",
    }
    assert body["dataPolicy"]["maxQuoteAgeSeconds"] > 0
    assert "실제 증권계좌" in body["disclaimer"]

