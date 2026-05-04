"""Tests for the KPI formula safe-eval. The formula language must be tightly
locked down — anything that smells like a sandbox escape should raise."""
from __future__ import annotations

import pytest

from app.services.kpi_service import FormulaError, _safe_eval


def test_simple_arithmetic():
    assert _safe_eval("present_days / work_days * 100", {"present_days": 18, "work_days": 22}) == pytest.approx(81.81, rel=1e-3)


def test_min_max_round():
    assert _safe_eval("min(100, present_days * 5)", {"present_days": 30}) == 100
    assert _safe_eval("round(present_days / work_days * 100, 2)", {"present_days": 19, "work_days": 22}) == pytest.approx(86.36, rel=1e-3)


def test_unknown_variable_rejected():
    with pytest.raises(FormulaError):
        _safe_eval("evil_var * 2", {"present_days": 0})


def test_attribute_access_rejected():
    with pytest.raises(FormulaError):
        _safe_eval("(1).__class__", {})


def test_import_call_rejected():
    with pytest.raises(FormulaError):
        _safe_eval("__import__('os')", {})


def test_subscript_rejected():
    # ast.Subscript is not in the allow list — list/dict access is forbidden.
    with pytest.raises(FormulaError):
        _safe_eval("[1, 2, 3][0]", {})


def test_lambda_rejected():
    with pytest.raises(FormulaError):
        _safe_eval("(lambda: 1)()", {})


def test_generator_rejected():
    with pytest.raises(FormulaError):
        _safe_eval("sum(i for i in [1, 2, 3])", {})


def test_call_to_unauth_function_rejected():
    with pytest.raises(FormulaError):
        _safe_eval("len('abc')", {})
