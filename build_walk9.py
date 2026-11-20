"""시연 충전소 9곳: 도보 10분(780m) 안 가게를 충전소별 파일로 만들기.
입력: ../analysis/walk_9/walk_routes_9_v2.csv (팀 확정판. 없으면 같은 칸 구성의 제안판 walk_routes_osm_9_v2_proposed.csv)
      raw/step2/sbiz_서울.csv (상가업소번호로 중분류·소분류를 붙임. 7개 카테고리 대응은 build_poi.py의 표를 그대로 읽어 씀)
출력: data/walk9/<충전소ID>.json  (지도에서 9곳 중 하나를 누를 때만 읽음)
      data/walk9/index.json        (9곳 목록과 요약. 페이지가 처음 열릴 때 읽음)
입력 CSV는 읽기만 함. 실행: ~/.venvs/work/bin/python -I build_walk9.py

가게 한 줄 = [이름, 카테고리 번호, 소분류, 위도, 경도, 도보 분, 도보 m, 5분 안(1/0), 카카오 도보 경로값(1/0)]
- 도보 분 = ceil(walk_sec / 60), walk_sec = walk_m / 1.3. 5분 안 = walk_m <= 390, 10분 안 = walk_m <= 780
- route_status 가 ok 가 아닌 가게(경로 미확인)는 파일에 넣지 않고 index.json 에 개수만 적음
- 가게 이름 안의 전화번호 패턴은 "[전화번호]"로 바꿈
- 7개 카테고리에 대응되지 않는 업종(학원·병원·부동산 등)은 뺌
"""
import ast, json, math, os, re, shutil
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
WALK_DIR = os.path.join(HERE, "..", "analysis", "walk_9")
SRC_FINAL = os.path.join(WALK_DIR, "walk_routes_9_v2.csv")                 # 확정판이 생기면 이것을 씀
SRC_PROPOSED = os.path.join(WALK_DIR, "walk_routes_osm_9_v2_proposed.csv")  # 확정판 전 개발용
SBIZ = os.path.join(HERE, "raw", "step2", "sbiz_서울.csv")
OUT = os.path.join(HERE, "data", "walk9")
SPEED, M5, M10 = 1.3, 390, 780
PHONE = re.compile(r"0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}")   # 가게 이름에 들어간 전화번호(공개 사이트라 가림)
STATIONS = ["CV002017", "CV000826", "CV001539", "CV001523", "CV004090", "CV001087", "CV004512", "CV000939", "CV002137"]


def poi_tables():
    """build_poi.py 는 실행하면 전체를 다시 만들므로 import 하지 않고, 맨 위의 CATS·MID·SUB 표만 읽음"""
    tree = ast.parse(open(os.path.join(HERE, "build_poi.py"), encoding="utf-8").read())
    got = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and getattr(node.targets[0], "id", None) in ("CATS", "MID", "SUB"):
            got[node.targets[0].id] = ast.literal_eval(node.value)
    return got["CATS"], got["MID"], got["SUB"]


def load_routes(src, stations=None):
    """도보 경로 CSV(세원 칸 방식) → 7개 카테고리(cat), 도보 m·초, 성공 여부(ok), 카카오 도보 경로값 여부(kakao) 칸을 붙인 표.
    stations 를 주면 그 충전소만. 서울 전체판(build_walk_seoul.py)도 이 함수를 그대로 씀"""
    CATS, MID, SUB = poi_tables()
    w = pd.read_csv(src, dtype={"station_id": str, "place_id": str, "route_status": str, "correction": str, "kakao_checked": str, "osm_flag": str})
    if stations is not None:
        w = w[w["station_id"].isin(stations)].copy()
    w["sid"] = w["place_id"].str.replace("shop:", "", regex=False)
    s = pd.read_csv(SBIZ, dtype=str, usecols=["상가업소번호", "상권업종중분류명", "상권업종소분류명"])
    s = s.rename(columns={"상가업소번호": "sid", "상권업종중분류명": "mid", "상권업종소분류명": "sub"})
    w = w.drop(columns=[c for c in ["상권업종소분류명", "상권업종중분류명"] if c in w.columns]).merge(s, on="sid", how="left")
    cat = w["sub"].map(SUB)
    m = cat.isna(); cat[m] = w.loc[m, "mid"].str.strip().map(MID)
    w["cat"] = cat
    w["ok"] = w["route_status"].eq("ok")
    w["walk_m"] = pd.to_numeric(w["walk_m"], errors="coerce")
    w["walk_sec"] = w["walk_m"] / SPEED
    w["kakao"] = w["correction"].fillna("").eq("kakao_measured")
    return w, CATS


def write_station(d, sid, out, n_cats):
    """충전소 하나의 표 d → out/<sid>.json. 요약(dict)과 파일 크기를 돌려줌"""
    dk = d[d["ok"] & (d["walk_m"] <= M10)]
    in_cat = dk[dk["cat"].notna()].sort_values(["walk_m", "name"])
    n5, n10 = [0] * n_cats, [0] * n_cats
    items = []
    for _, r in in_cat.iterrows():
        c = int(r["cat"]); in5 = int(r["walk_m"] <= M5)
        n10[c] += 1; n5[c] += in5
        items.append([PHONE.sub("[전화번호]", str(r["name"]).strip()), c, r["sub"], round(float(r["lat"]), 5), round(float(r["lng"]), 5),
                      max(1, math.ceil(r["walk_sec"] / 60 - 1e-9)), int(round(r["walk_m"])), in5, int(r["kakao"])])
    fail = d[~d["ok"] & (pd.to_numeric(d["straight_m"], errors="coerce") <= M10)]
    fail_cat = int(fail["cat"].notna().sum())
    fp = os.path.join(out, sid + ".json")
    json.dump({"id": sid, "n5": n5, "n10": n10, "fail": fail_cat, "p": items}, open(fp, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    summ = {"id": sid, "n5": sum(n5), "n10": sum(n10), "fail": fail_cat, "other10": int(dk["cat"].isna().sum()),
            "kakao10": int(in_cat["kakao"].sum())}
    return summ, os.path.getsize(fp), len(dk)


NOTE = "도보 시간 = OSM 보행 경로(카카오 도보 경로값 보정), 보행 1.3 m/s 가정. 영업 여부 미확인"


def main():
    src = SRC_FINAL if os.path.exists(SRC_FINAL) else SRC_PROPOSED
    print("입력", os.path.relpath(src, HERE))
    w, CATS = load_routes(src, STATIONS)
    no_match = int(w["sub"].isna().sum())
    shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
    idx, total, size = [], 0, 0
    for sid in STATIONS:
        summ, sz, n_dk = write_station(w[w["station_id"] == sid], sid, OUT, len(CATS))
        idx.append(summ); size += sz; total += summ["n10"]
        print(f"{sid} 10분 {n_dk:>5} 중 카테고리 {summ['n10']:>5} (5분 {summ['n5']:>4}) · 경로 미확인 {summ['fail']} · 카카오 도보 경로값 {summ['kakao10']} · {sz/1e3:.0f}KB")
    meta = {"src": os.path.basename(src), "final": src == SRC_FINAL, "speed": SPEED, "m5": M5, "m10": M10, "cats": CATS,
            "note": NOTE, "stations": idx}
    json.dump(meta, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("상가정보에서 못 찾은 가게", no_match)
    print("합계 가게", total, "· 파일 합계 KB", round(size / 1e3))


if __name__ == "__main__":
    main()
