from app.routes.billing import PLANS, _plan


def test_billing_catalog_has_free_pro_and_team() -> None:
    assert [plan["id"] for plan in PLANS] == ["FREE", "PRO", "TEAM"]
    assert _plan("FREE")["priceKrw"] == 0
    assert _plan("PRO")["priceKrw"] > 0
    assert _plan("TEAM")["limits"]["leagues"] is None


def test_paid_catalog_is_prelaunch_until_checkout_is_configured() -> None:
    assert all(plan["status"] == "prelaunch" for plan in PLANS if plan["id"] != "FREE")
    assert any("알림" in feature for feature in _plan("PRO")["features"])
