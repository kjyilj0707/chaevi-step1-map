"""STEP 1 대시보드용 자료 만들기.
입력: raw/stations.csv, raw/chargers.csv, raw/status_daily/status_*.csv (팀 드라이브 01_충전소_지도/raw 원본 그대로)
출력: data/stations.json (지도 페이지가 읽는 파일), data/usage_by_hour.csv (충전소 x 시각 이용률)

이용률 계산 방법
 1) 상태 기록(full=전체, delta=바뀐 것만)을 충전기별로 시간순 정렬
 2) 수집 시각마다 충전기 상태 = 그 시각까지의 마지막 기록 (바뀌지 않으면 delta에 안 나오므로 앞 값 유지)
 3) 수집 시각별·충전소별 이용률 = 충전중(3) 대수 / (충전대기(2)+충전중(3)) 대수  (통신이상·미확인은 분모에서 제외)
 4) 같은 시(0~23시)에 속한 수집 시각들의 평균
"""
import glob, json, os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(HERE, "raw")
KIND = {"A0": "공공시설", "B0": "주차시설", "C0": "휴게시설", "D0": "관광시설", "E0": "상업시설",
        "F0": "차량정비시설", "G0": "기타시설", "H0": "공동주택시설", "I0": "근린생활시설", "J0": "교육문화시설"}

stn = pd.read_csv(os.path.join(R, "stations.csv"))
chg = pd.read_csv(os.path.join(R, "chargers.csv"), dtype={"chgerId": str})
st = pd.concat([pd.read_csv(f, dtype={"chgerId": str})
                for f in sorted(glob.glob(os.path.join(R, "status_daily", "status_*.csv")))])
# 범위: 서울특별시 (주소 첫 단어 기준), 아파트(is_apt) 제외
REGION = "서울특별시"
stn = stn[(stn["addr"].str.split().str[0] == REGION) & (~stn["is_apt"].astype(bool))].reset_index(drop=True)  # 아파트 제외
chg = chg[chg["statId"].isin(stn["statId"])]
st = st[st["statId"].isin(stn["statId"])]
st["collected_at"] = pd.to_datetime(st["collected_at"])
st["key"] = st["statId"] + "|" + st["chgerId"]
st = st.sort_values("collected_at")

# 1~2) 수집 시각 x 충전기 표, 앞 값 유지
wide = st.pivot_table(index="collected_at", columns="key", values="stat", aggfunc="last").ffill()
polls = wide.index
fast = dict(zip(chg["statId"] + "|" + chg["chgerId"], chg["is_fast"]))
key_stat = pd.Series([k.split("|")[0] for k in wide.columns], index=wide.columns)
key_fast = pd.Series([bool(fast.get(k, False)) for k in wide.columns], index=wide.columns)

busy = (wide == 3)
usable = wide.isin([2, 3])

# 3) 충전소별
busy_s = busy.T.groupby(key_stat).sum().T
usable_s = usable.T.groupby(key_stat).sum().T
occ = (busy_s / usable_s.where(usable_s > 0))            # 수집 시각 x 충전소
# 4) 시별 평균
occ_h = occ.groupby(polls.hour).mean()                   # 시 x 충전소
occ_h = occ_h.reindex(range(24))
n_polls_h = pd.Series(polls.hour).value_counts().reindex(range(24), fill_value=0).sort_index()

# 범위 전체 급속/완속 시별 이용률
def nat(mask):
    b = busy.loc[:, mask].sum(axis=1); u = usable.loc[:, mask].sum(axis=1)
    return (b / u).groupby(polls.hour).mean().reindex(range(24))
nat_fast, nat_slow = nat(key_fast.values), nat(~key_fast.values)

# 충전 1회 시간(분): 충전기별 (마지막 충전 시작 시각) 하나를 1회로 봄, 1분 미만·24시간 초과 제외
ses = st.dropna(subset=["lastTsdt", "charge_min"]).drop_duplicates(["key", "lastTsdt"])
ses = ses[(ses["charge_min"] >= 1) & (ses["charge_min"] <= 1440)].copy()
ses["fast"] = ses["key"].map(lambda k: bool(fast.get(k, False)))
med_fast = ses[ses["fast"]].groupby("statId")["charge_min"].median()
n_ses = ses.groupby("statId").size()

# 통신이상 비율(수집 시각 평균)
bad_s = (wide == 1).T.groupby(key_stat).sum().T
tot_s = wide.notna().T.groupby(key_stat).sum().T
bad = (bad_s / tot_s.where(tot_s > 0)).mean()

rows = []
for r in stn.itertuples():
    o = occ_h[r.statId] if r.statId in occ_h.columns else None
    oc = [-1 if (o is None or pd.isna(v)) else int(round(v * 100)) for v in (o if o is not None else [None] * 24)]
    rows.append([r.statId, r.statNm, r.addr, round(float(r.lat), 5), round(float(r.lng), 5),
                 r.addr.split()[1], KIND.get(r.kind, r.kind), int(r.n_chargers), int(r.n_fast), int(r.max_kw),
                 int(bool(r.is_apt)), int(bool(r.is_chaevistay)), oc,
                 round(float(med_fast[r.statId]), 1) if r.statId in med_fast.index else -1,
                 int(n_ses.get(r.statId, 0)),
                 int(round(bad[r.statId] * 100)) if r.statId in bad.index and pd.notna(bad[r.statId]) else -1])

pc = lambda s: [None if pd.isna(v) else round(float(v) * 100, 1) for v in s]
out = {
    "meta": {
        "region": REGION, "first": str(polls.min()), "last": str(polls.max()), "n_polls": int(len(polls)),
        "n_records": int(len(st)), "n_stations": int(len(stn)), "n_chargers": int(len(chg)),
        "n_fast": int(chg["is_fast"].sum()), "n_stay": int(stn["is_chaevistay"].sum()),
        "n_sessions": int(len(ses)),
        "med_fast_min": round(float(ses[ses["fast"]]["charge_min"].median()), 1),
        "med_slow_min": round(float(ses[~ses["fast"]]["charge_min"].median()), 1),
        "polls_by_hour": [int(v) for v in n_polls_h],
        "days_by_hour": [int(pd.Series(polls[polls.hour == h].date).nunique()) for h in range(24)],
    },
    "national": {"fast": pc(nat_fast), "slow": pc(nat_slow)},
    "cols": ["id", "name", "addr", "lat", "lng", "sido", "kind", "n", "n_fast", "max_kw", "apt", "stay",
             "occ24", "med_fast_min", "n_sessions", "bad_pct"],
    "stations": rows,
}
os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
with open(os.path.join(HERE, "data", "stations.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

long = occ_h.T.rename_axis("statId").reset_index().melt("statId", var_name="hour", value_name="occupancy")
long = long.dropna().sort_values(["statId", "hour"])
long["occupancy"] = long["occupancy"].round(4)
long.to_csv(os.path.join(HERE, "data", "usage_by_hour.csv"), index=False, encoding="utf-8-sig")

print(json.dumps(out["meta"], ensure_ascii=False, indent=1))
print("national fast", out["national"]["fast"]); print("national slow", out["national"]["slow"])
print("stations with occ:", sum(1 for r in rows if max(r[12]) >= 0), "/", len(rows))
print("stay:", [(r[1], r[12], r[13]) for r in rows if r[11]])
