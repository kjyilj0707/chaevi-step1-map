"""붐빔 v2(최신 기록) 값을 지도 자료에 넣기 (2026-11-22, 프론트엔드)
- STEP 1 build_data.py·data/usage_by_hour.csv(다은)는 그대로 둠. 이 스크립트는 build_data.py → build_poi.py 다음에 돌림
- 입력: data/usage_by_hour_v2.csv (= analysis/station_reco/usage_by_hour_v2.csv 복사본, 같은 형식 statId,hour,occupancy)
  v2 = 같은 (충전기, 수집 시각)에 기록이 둘이면 statUpdDt 최신 하나만(동점 delta, 안정 정렬). 기준 analysis/station_reco/README.md §4
- 출력: data/stations.json 의 occ24(시별 이용률 %, 정수, 기록 없음 -1)를 v2 값으로 바꾸고 meta.busy 에 판 표시
  → 지도 목록·충전소 상세 곡선·충전소 추천 패널(data/reco/station_reco.json, 같은 v2)이 같은 값을 씀
- 다시 돌려도 결과 같음. 전국 급속·완속 곡선(national)·통신이상 비율(bad_pct)은 다시 계산하지 않음(README §4-2 한계)
실행: ~/.venvs/work/bin/python -I apply_busy_v2.py
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "usage_by_hour_v2.csv")
OUT = os.path.join(HERE, "data", "stations.json")

occ = {}
with open(SRC, encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        occ.setdefault(r["statId"], {})[int(r["hour"])] = float(r["occupancy"])
S = json.load(open(OUT, encoding="utf-8"))
i = S["cols"].index("occ24")
changed = cells = 0
for row in S["stations"]:
    o = occ.get(row[0], {})
    new = [int(round(o[h] * 100)) if h in o else -1 for h in range(24)]
    changed += sum(a != b for a, b in zip(row[i], new)); cells += 24
    row[i] = new
S["meta"]["busy"] = {"version": "v2", "label": "11/08~11/11 수집, 최신 기록 기준",
                     "source": "analysis/station_reco/usage_by_hour_v2.csv",
                     "rule": "같은 충전기·같은 수집 시각 기록이 둘 이상이면 statUpdDt 최신 하나만"}
json.dump(S, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"occ24 v2 반영: 바뀐 칸 {changed} / {cells}")
