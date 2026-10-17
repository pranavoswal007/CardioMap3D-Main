"""Feature preprocessing utilities for CardioMap 3D ML pipeline."""

from __future__ import annotations

from typing import Any

import numpy as np
import numpy.typing as npt
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin


class BinaryFeatureEncoder(BaseEstimator, TransformerMixin):  # type: ignore[misc]
    """Transformer for clinical boolean and binary features.

    Handles 'Y'/'N', 'Male'/'Fmale', numeric 0/1, strings '0'/'1', and missing values.
    Defined as a formal class in a standalone module to ensure safe pickling across processes.
    """

    def fit(self, X: Any, y: Any = None) -> BinaryFeatureEncoder:
        """Fit transformer (stateless)."""
        return self

    def transform(self, X: Any) -> npt.NDArray[np.float64]:
        """Transform binary dataframe or array into float matrix of 0.0 and 1.0."""
        if not isinstance(X, pd.DataFrame):
            X = pd.DataFrame(X)
        n_rows, n_cols = X.shape
        out = np.zeros((n_rows, n_cols), dtype=np.float64)
        for j, col in enumerate(X.columns):
            vals = X[col].to_numpy()
            col_out = np.zeros(n_rows, dtype=np.float64)
            for i, v in enumerate(vals):
                if v in ("Y", "Male", 1, "1", 1.0):
                    col_out[i] = 1.0
                elif v in ("N", "Fmale", 0, "0", 0.0):
                    col_out[i] = 0.0
                else:
                    col_out[i] = 0.0
            out[:, j] = col_out
        return out
