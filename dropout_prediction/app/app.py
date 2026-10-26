"""Streamlit app: predict whether a student will graduate, drop out, or still be enrolled.

Run from the project folder:  streamlit run app/app.py
"""
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import joblib
import pandas as pd
import streamlit as st

from src.features import BINARY_LABELS, COURSE_NAMES, MARITAL_STATUS, MODELS_DIR, clean_columns

st.set_page_config(page_title="Student Dropout Predictor", layout="wide")


@st.cache_resource
def load_model():
    model = joblib.load(MODELS_DIR / "dropout_model.joblib")
    meta = json.loads((MODELS_DIR / "model_meta.json").read_text())
    return model, meta


try:
    model, meta = load_model()
except FileNotFoundError:
    st.error("No trained model found. Run notebooks/dropout_prediction.ipynb first to create models/dropout_model.joblib.")
    st.stop()

CLASSES = meta["class_names"]
INPUTS = meta["input_columns"]
DEFAULTS = meta["defaults"]
RANGES = meta["numeric_ranges"]


def predict(frame: pd.DataFrame) -> pd.DataFrame:
    proba = model.predict_proba(frame[INPUTS])
    out = pd.DataFrame(proba, columns=[f"P({c})" for c in CLASSES], index=frame.index)
    out.insert(0, "Prediction", [CLASSES[i] for i in proba.argmax(axis=1)])
    return out


def number_input(col, label=None, step=1.0):
    lo, hi = RANGES[col]
    is_int = float(lo).is_integer() and float(hi).is_integer() and step == 1.0
    if is_int:
        return st.number_input(label or col, int(lo), int(hi), int(round(DEFAULTS[col])), step=1)
    return st.number_input(label or col, float(lo), float(hi), float(DEFAULTS[col]), step=step)


def yes_no(col, label=None):
    labels = BINARY_LABELS.get(col, {0: "No", 1: "Yes"})
    return st.selectbox(label or col, [0, 1], index=int(DEFAULTS[col]), format_func=labels.get)


def code_select(col, names=None):
    options = meta["categories"][col]
    default = DEFAULTS[col]
    return st.selectbox(col, options, index=options.index(default) if default in options else 0,
                        format_func=(lambda v: f"{names.get(v, v)} ({v})") if names else str)


st.title("Student Dropout Predictor")
st.caption(
    f"Model: {meta['model_name']} · trained {meta['trained_on']} · "
    f"test macro-F1 {meta['test_metrics']['macro_f1']:.3f} · test accuracy {meta['test_metrics']['accuracy']:.3f}"
)

single_tab, batch_tab, about_tab = st.tabs(["Single student", "Batch (CSV)", "About the model"])

with single_tab:
    st.write("Fill in the key fields. Everything else starts at the typical (median / most common) training value "
             "and can be changed under **Other fields**.")
    values = dict(DEFAULTS)

    with st.form("student"):
        c1, c2, c3 = st.columns(3)
        with c1:
            st.subheader("Student")
            values["Course"] = code_select("Course", COURSE_NAMES)
            values["Age at enrollment"] = number_input("Age at enrollment")
            values["Gender"] = yes_no("Gender")
            values["Marital status"] = code_select("Marital status", MARITAL_STATUS)
            values["Admission grade"] = number_input("Admission grade", "Admission grade (0-200)", step=0.5)
            values["Daytime/evening attendance"] = yes_no("Daytime/evening attendance")
        with c2:
            st.subheader("Finances")
            values["Tuition fees up to date"] = yes_no("Tuition fees up to date")
            values["Debtor"] = yes_no("Debtor")
            values["Scholarship holder"] = yes_no("Scholarship holder")
            values["Displaced"] = yes_no("Displaced", "Displaced (studies away from home)")
        with c3:
            st.subheader("Academic progress")
            for sem in ("1st", "2nd"):
                st.markdown(f"**{sem} semester**")
                for measure in ("enrolled", "approved", "grade"):
                    col = f"Curricular units {sem} sem ({measure})"
                    label = f"{sem} sem units {measure}" if measure != "grade" else f"{sem} sem average grade (0-20)"
                    values[col] = number_input(col, label, step=0.1 if measure == "grade" else 1.0)

        shown = {"Course", "Age at enrollment", "Gender", "Marital status", "Admission grade", "Daytime/evening attendance",
                 "Tuition fees up to date", "Debtor", "Scholarship holder", "Displaced"} | {
            f"Curricular units {s} sem ({m})" for s in ("1st", "2nd") for m in ("enrolled", "approved", "grade")}
        with st.expander("Other fields"):
            cols = st.columns(3)
            for i, col in enumerate(c for c in INPUTS if c not in shown):
                with cols[i % 3]:
                    if col in meta["binary_columns"]:
                        values[col] = yes_no(col)
                    elif col in meta["nominal_columns"]:
                        values[col] = code_select(col)
                    else:
                        values[col] = number_input(col, step=0.1 if not float(DEFAULTS[col]).is_integer() else 1.0)

        submitted = st.form_submit_button("Predict", type="primary")

    if submitted:
        result = predict(pd.DataFrame([values]))
        label = result.iloc[0]["Prediction"]
        probs = result.iloc[0][[f"P({c})" for c in CLASSES]].astype(float)
        probs.index = CLASSES
        msg = f"Predicted outcome: **{label}** ({probs[label]:.0%} probability)"
        {"Dropout": st.error, "Enrolled": st.warning, "Graduate": st.success}[label](msg)
        st.bar_chart(probs.rename("Probability"), horizontal=True)

with batch_tab:
    st.write("Upload a CSV with the same columns as the original dataset (semicolon- or comma-separated). "
             "A `Target` column is optional; if present, accuracy is shown.")
    upload = st.file_uploader("CSV file", type="csv")
    if upload is not None:
        frame = clean_columns(pd.read_csv(upload, sep=None, engine="python", encoding="utf-8-sig"))
        missing = [c for c in INPUTS if c not in frame.columns]
        if missing:
            st.error(f"Missing {len(missing)} required column(s): {', '.join(missing)}")
        else:
            result = pd.concat([predict(frame), frame], axis=1)
            st.write(f"{len(result):,} students scored.")
            st.dataframe(result.round(3), width="stretch")
            st.bar_chart(result["Prediction"].value_counts())
            if "Target" in frame.columns:
                st.metric("Accuracy on uploaded labels", f"{(result['Prediction'] == frame['Target']).mean():.1%}")
            st.download_button("Download predictions", result.to_csv(index=False).encode(), "predictions.csv", "text/csv")

with about_tab:
    m = meta["test_metrics"]
    cols = st.columns(4)
    cols[0].metric("Macro-F1", f"{m['macro_f1']:.3f}")
    cols[1].metric("Balanced accuracy", f"{m['balanced_accuracy']:.3f}")
    cols[2].metric("Accuracy", f"{m['accuracy']:.3f}")
    cols[3].metric("ROC-AUC (OvR)", f"{m['roc_auc_ovr_macro']:.3f}")
    st.write(f"Evaluated on a held-out test set of {meta['split']['test_rows']:,} students. "
             f"A majority-class baseline scores macro-F1 {meta['baseline_test_metrics']['macro_f1']:.3f}.")
    st.subheader("Most important inputs")
    st.dataframe(pd.DataFrame(meta["permutation_importance_top15"]), width="stretch")
    st.info("Predictions are statistical estimates meant to flag students who may benefit from support. "
            "They should not be used on their own to make decisions about individual students.")
