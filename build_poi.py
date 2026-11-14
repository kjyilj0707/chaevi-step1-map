"""STEP 2 예비: 충전소 주변 상권(반경 300m)을 충전소별 파일로 만들기.
입력: raw/step2/sbiz_*.csv (팀 드라이브 02_충전소_유형/raw 의 소상공인시장진흥공단 상가(상권)정보 원본 그대로)
      data/stations.json (build_data.py 결과)
출력: data/poi/<충전소ID>.json  (지도에서 충전소를 누를 때만 읽음)
      data/stations.json 에 충전소별 7개 카테고리 개수(poi7) 열과 meta.poi 추가
      data/poi_counts.csv (충전소 x 7개 카테고리 개수, STEP 2 유형 분류용)
실행 순서: build_data.py → build_poi.py

카테고리 대응표는 임시안임(세원의 기준 확인 전). 소분류 이름 기준.
"""
import glob, json, os, shutil
import numpy as np, pandas as pd
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
RADIUS = 300          # m
MAX_ITEMS = 400       # 충전소 파일 하나에 담는 가게 수 상한(가까운 순)
CATS = ["식사", "카페", "테이크아웃", "쇼핑", "편의", "관광·여가", "업무"]
MID = {  # 중분류 통째로
    "한식": 0, "중식": 0, "일식": 0, "서양식": 0, "동남아시아": 0,
    "비알코올": 1, "기타 간이": 2,
}
SUB = {  # 소분류 단위
    "뷔페": 0,
    "여성 의류 소매업": 3, "남성 의류 소매업": 3, "기타 의류 소매업": 3, "유아용 의류 소매업": 3, "신발 소매업": 3,
    "가방 소매업": 3, "액세서리/잡화 소매업": 3, "화장품 소매업": 3, "서점": 3, "문구/회화용품 소매업": 3,
    "장난감 소매업": 3, "운동용품 소매업": 3, "기념품점": 3, "가전제품 소매업": 3, "시계/귀금속 소매업": 3,
    "그 외 기타 종합 소매업": 3,
    "편의점": 4, "슈퍼마켓": 4, "약국": 4, "자동차 세차장": 4, "셀프 빨래방": 4,
    "노래방": 5, "PC방": 5, "전자 게임장": 5, "기타 오락장": 5, "당구장": 5, "볼링장": 5, "골프 연습장": 5,
    "목욕탕/사우나": 5, "마사지/안마": 5, "수상/해양 레저업": 5, "낚시터 운영업": 5,
    "독서실/스터디 카페": 6, "복사업": 6, "기타 사무 지원 서비스업": 6,
}
COLS = ["상호명", "지점명", "상권업종중분류명", "상권업종소분류명", "시도명", "경도", "위도"]

frames = []
for f in sorted(glob.glob(os.path.join(HERE, "raw", "step2", "sbiz_*.csv"))):
    d = pd.read_csv(f, dtype=str, usecols=COLS)
    d["cat"] = d["상권업종소분류명"].map(SUB)
    m = d["cat"].isna()
    d.loc[m, "cat"] = d.loc[m, "상권업종중분류명"].str.strip().map(MID)
    covered_here = d["시도명"].dropna().unique().tolist()
    d = d.dropna(subset=["cat", "경도", "위도"])
    frames.append(d)
    print(os.path.basename(f), "쓴 가게", len(d), covered_here)
shops = pd.concat(frames, ignore_index=True)
shops["cat"] = shops["cat"].astype(int)
shops["lat"] = shops["위도"].astype(float); shops["lng"] = shops["경도"].astype(float)
shops["name"] = shops["상호명"].fillna("") + shops["지점명"].fillna("").map(lambda s: " " + s if s else "")
covered = sorted(shops["시도명"].unique())

def xyz(lat, lng):      # 지구 위 좌표 → 3차원 좌표(m). 300m 범위에서는 직선거리 ≈ 지표 거리
    la, lo = np.radians(lat), np.radians(lng); R = 6371000.0
    return np.c_[R * np.cos(la) * np.cos(lo), R * np.cos(la) * np.sin(lo), R * np.sin(la)]

tree = cKDTree(xyz(shops["lat"].values, shops["lng"].values))
S = json.load(open(os.path.join(HERE, "data", "stations.json"), encoding="utf-8"))
cols = S["cols"]
if "poi7" in cols:                               # 다시 돌릴 때 옛 열 제거
    k = cols.index("poi7"); cols.pop(k); [r.pop(k) for r in S["stations"]]
iS, iLat, iLng, iId = cols.index("sido"), cols.index("lat"), cols.index("lng"), cols.index("id")
out_dir = os.path.join(HERE, "data", "poi")
shutil.rmtree(out_dir, ignore_errors=True); os.makedirs(out_dir)
name, cat, sub, la, lo = (shops[c].values for c in ["name", "cat", "상권업종소분류명", "lat", "lng"])
rows = []; n_files = 0; size = 0
for r in S["stations"]:
    if r[iS] not in covered:
        r.append(None); continue
    p = xyz(np.array([r[iLat]]), np.array([r[iLng]]))[0]
    idx = tree.query_ball_point(p, RADIUS)
    dist = np.linalg.norm(tree.data[idx] - p, axis=1) if idx else np.array([])
    order = np.argsort(dist)
    cnt = [0] * len(CATS)
    for i in idx: cnt[cat[i]] += 1
    items = [[name[idx[o]], int(cat[idx[o]]), sub[idx[o]], round(float(la[idx[o]]), 5), round(float(lo[idx[o]]), 5), int(round(dist[o]))] for o in order[:MAX_ITEMS]]
    fp = os.path.join(out_dir, r[iId] + ".json")
    json.dump({"n": cnt, "total": len(idx), "p": items}, open(fp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    size += os.path.getsize(fp); n_files += 1
    r.append(cnt); rows.append([r[iId]] + cnt)
cols.append("poi7")
S["meta"]["poi"] = {"radius": RADIUS, "cats": CATS, "covered": covered, "max_items": MAX_ITEMS,
                    "source": "소상공인시장진흥공단 상가(상권)정보 2026-09", "n_shops": int(len(shops))}
json.dump(S, open(os.path.join(HERE, "data", "stations.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
pc = pd.DataFrame(rows, columns=["statId"] + CATS)
pc.to_csv(os.path.join(HERE, "data", "poi_counts.csv"), index=False, encoding="utf-8-sig")
print("자료 있는 시·도", covered)
print("충전소 파일", n_files, "/", len(S["stations"]), "합계 MB", round(size / 1e6, 1))
print(pc[CATS].describe().loc[["mean", "50%", "max"]].round(1).to_string())
print("상한에 걸린 충전소", int((pc[CATS].sum(axis=1) > MAX_ITEMS).sum()))
