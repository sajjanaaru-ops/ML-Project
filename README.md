# ML-Project

Student dropout prediction: an XGBoost model that predicts whether a higher-education student will graduate,
drop out, or still be enrolled, plus a web app for single-student what-ifs and batch scoring.

```bash
cd dropout_prediction
pip install -r requirements.txt
python app/server.py          # opens http://127.0.0.1:8000
```

Details, training notebook and layout: [`dropout_prediction/README.md`](dropout_prediction/README.md).

## Data

`Analysis/Track_1_Academic_Performance_and_Dropout/predict_students_dropout_uci/data.csv` is the UCI
[Predict Students' Dropout and Academic Success](https://archive.ics.uci.edu/dataset/697/predict+students+dropout+and+academic+success)
dataset (Realinho, Vieira Martins, Machado & Baptista), licensed under CC BY 4.0.
