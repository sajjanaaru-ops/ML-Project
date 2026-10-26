# Student Dropout Prediction

Predicts whether a higher-education student will **Graduate**, **Drop out**, or still be **Enrolled** at the end of the
normal course duration, using the UCI *Predict Students' Dropout and Academic Success* dataset (4,424 students).

Full project documentation: https://claude.ai/artifact/Q1YL7E55eApAC8iCL9QE4M

## Quick start

```bash
pip install -r requirements.txt

# Re-train (EDA, model comparison, tuning, evaluation, saving) - writes models/ and reports/figures/
cd notebooks
python -m nbconvert --to notebook --execute --inplace dropout_prediction.ipynb
cd ..

# Launch the prediction app (opens http://127.0.0.1:8000 in your browser)
python app/server.py
```

Options: `python app/server.py --port 8001 --no-browser`. The older Streamlit version is still available with
`python -m streamlit run app/app.py`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/features.py` | Data loading, engineered features, preprocessing pipeline (shared by notebook and app) |
| `notebooks/dropout_prediction.ipynb` | Full analysis and training |
| `models/dropout_model.joblib` | Trained pipeline: raw columns in, class probabilities out |
| `models/model_meta.json` | Input columns, defaults, valid codes, all metrics |
| `reports/figures/` | Plots exported by the notebook |
| `app/server.py` | FastAPI server: JSON API (`/api/meta`, `/api/predict`, `/api/batch`) + serves the UI |
| `app/static/` | The web UI: `index.html`, `styles.css`, `app.js` (no build step) |
| `app/app.py` | Original Streamlit app (fallback) |

Raw data is read from `../Analysis/Track_1_Academic_Performance_and_Dropout/predict_students_dropout_uci/data.csv`.
