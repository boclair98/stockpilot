import pytest
from scripts.migrate_practice_once import EXPECTED_PARENT, TARGET, migration_action


def test_only_the_approved_parent_can_be_upgraded():
    assert migration_action([EXPECTED_PARENT]) == "upgrade"


def test_repeat_boot_skips_migration_entirely():
    assert migration_action([TARGET]) == "skip"


@pytest.mark.parametrize(
    "revisions",
    [[], ["0015_toss_game"], ["future_revision"], [TARGET, EXPECTED_PARENT]],
)
def test_unknown_or_multiple_heads_never_auto_upgrade(revisions):
    with pytest.raises(RuntimeError):
        migration_action(revisions)
