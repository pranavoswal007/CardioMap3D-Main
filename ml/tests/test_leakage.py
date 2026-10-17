"""Unit test verifying enforcement of Hard Rule 1: Target Leakage Prevention."""

import pytest
from cardiomap_ml.config import (
    FORBIDDEN_TARGET_NAMES,
    assert_no_target_leakage,
)


def test_empty_feature_list_passes() -> None:
    """Verify that an empty list of features passes without error."""
    assert_no_target_leakage([])


def test_clean_features_pass() -> None:
    """Verify that clinical features without targets pass successfully."""
    clean_features = [
        "Age",
        "Weight",
        "Length",
        "Sex",
        "BMI",
        "DM",
        "HTN",
        "Current Smoker",
        "BP",
        "PR",
        "Typical Chest Pain",
        "EF",
        "FBS",
    ]
    # Should not raise any assertion error
    assert_no_target_leakage(clean_features)


def test_substring_features_accepted() -> None:
    """Verify legitimate columns that merely contain forbidden sequences as substrings are accepted."""
    substring_features = [
        "Cadence",
        "Placard",
        "Scathing",
        "Ladder",
        "Arcade",
        "catholic",
        "broadcast",
        "Cascade",
        "Cardio",
    ]
    assert_no_target_leakage(substring_features)


@pytest.mark.parametrize(
    "leaked_feature",
    [
        # Exact names
        "Cath",
        "cath",
        "CATH",
        "LAD",
        "lad",
        "LCX",
        "lcx",
        "RCA",
        "rca",
        "CAD",
        "cad",
        # Whitespace variants
        "  LAD  ",
        " cath\t",
        " \nRCA ",
        "  cad  ",
        " lcx ",
        # Underscore / hyphen / space variants
        "L_A_D",
        "l_a_d",
        "L-A-D",
        "l-a-d",
        "l a d",
        "L C X",
        "l_c_x",
        "l-c-x",
        "R_C_A",
        "r-c-a",
        "r c a",
        "C_A_T_H",
        "c-a-t-h",
        "c a t h",
        "C_A_D",
        "c-a-d",
        "c a d",
    ],
)
def test_target_leakage_raises_assertion_error(leaked_feature: str) -> None:
    """Verify that including any forbidden target column raises an explicit AssertionError."""
    features_with_leak = ["Age", "Sex", "BMI", leaked_feature, "BP"]
    with pytest.raises(AssertionError, match="CRITICAL TARGET LEAKAGE DETECTED"):
        assert_no_target_leakage(features_with_leak)


def test_forbidden_target_names_constant() -> None:
    """Verify FORBIDDEN_TARGET_NAMES contains exactly the five specified targets."""
    assert set(FORBIDDEN_TARGET_NAMES) == {"LAD", "LCX", "RCA", "Cath", "CAD"}
    assert len(FORBIDDEN_TARGET_NAMES) == 5


@pytest.mark.parametrize(
    "annotated_header",
    [
        "LAD (Target)",
        "Cath (Target / Overall CAD outcome)",
        "LCX (Target vessel)",
        "RCA (stenosis outcome)",
        "CAD (binary outcome)",
    ],
)
def test_annotated_target_headers_rejected(annotated_header: str) -> None:
    """Verify that annotated headers with parenthetical notes are still strictly rejected."""
    with pytest.raises(AssertionError, match="CRITICAL TARGET LEAKAGE DETECTED"):
        assert_no_target_leakage(["Age", "Sex", annotated_header])
