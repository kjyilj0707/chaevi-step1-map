"""시연 충전소 9곳: 도보 10분(780m) 안 가게를 충전소별 파일로 만들기.
입력: ../analysis/walk_9/walk_routes_9_v2.csv (팀 확정판. 없으면 같은 칸 구성의 제안판 walk_routes_osm_9_v2_proposed.csv)
      ../data/team_drive/1121/sewon_sbiz_subcat_202609.csv (세원 소진공 전처리판, 11/21. 상가업소번호로 세원 중분류·소분류를 붙임.
        이 파일에 없는 가게(세원 77개 소분류 밖: 주점·구내식당·뷔페·서비스업 등)는 뺌.
        범주(칩) = 새 대분류(v3e, 준엽 결정 11/22): ../analysis/reco_tables/reco_tables.json 의 category_map(소분류 → 대분류)을 소진공 소분류(공백 제거)로 붙임.
        v5b: store_overrides(가게 단위 예외: 올리브영 → 화장품, 전자담배 → 담배)를 category_map 보다 먼저 씀(place_id 로 소분류를 바꿈).
        excluded=1(inclusion = exclude, 11/22 동권 표 13 소분류)인 가게는 뺌(카드·목록·지도 모두). 담배 소매는 v5b 부터 포함(기타 소매 칩).
        올리브영 중복 묶음(merged_into)은 충전소마다 도보가 가장 짧은 1곳만 남김. 가게 하나 = 대분류 하나. 칩 순서는 BIGS(화장실 칩은 화면이 공중화장실 파일로 끝에 붙임)
출력: data/walk9/<충전소ID>.json  (지도에서 9곳 중 하나를 누를 때만 읽음)
      data/walk9/index.json        (9곳 목록과 요약. 페이지가 처음 열릴 때 읽음)
입력 CSV는 읽기만 함. 실행: ~/.venvs/work/bin/python -I build_walk9.py

가게 한 줄 = [이름, 칩 번호(대표), 소분류, 위도, 경도, 도보 분, 도보 m, 5분 안(1/0), 카카오 도보 경로값(1/0), 세원 중분류(, 속한 칩 번호 목록: 둘 이상일 때만)]
파일의 pid·wm = 줄 순서와 같은 place_id(shop: 뺌)·도보 m(소수 첫째 자리). 추천 점수(data/reco, index.html RECO)가 재이 ★·× 맞추기와 순서 비교에 씀
n5·n10 = 칩별 가게 수(한 가게가 두 칩에 들면 둘 다 셈). index.json 의 n5·n10 = 가게 수(겹침 없이)
- 도보 분 = ceil(walk_sec / 60), walk_sec = walk_m / 1.3. 5분 안 = walk_m <= 390, 10분 안 = walk_m <= 780
- route_status 가 ok 가 아닌 가게(경로 미확인)는 파일에 넣지 않고 index.json 에 개수만 적음
- 가게 이름 안의 전화번호 패턴은 "[전화번호]"로 바꿈
- 세원 77개 소분류 밖의 가게(학원·병원·주점·서비스업 등)는 뺌
"""
import ast, json, math, os, re, shutil
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
WALK_DIR = os.path.join(HERE, "..", "analysis", "walk_9")
SRC_FINAL = os.path.join(WALK_DIR, "walk_routes_9_v2.csv")                 # 확정판이 생기면 이것을 씀
SRC_PROPOSED = os.path.join(WALK_DIR, "walk_routes_osm_9_v2_proposed.csv")  # 확정판 전 개발용
SBIZ = os.path.join(HERE, "..", "data", "team_drive", "1121", "sewon_sbiz_subcat_202609.csv")   # 세원 소진공 전처리판(77개 소분류)
CMAP = os.path.join(HERE, "..", "analysis", "reco_tables", "reco_tables.json")    # 추천 표 v3e: category_map(소분류 → 새 대분류, 동권 가게 활동)
# 지도 칩 = 새 대분류(가게 12개). 화장실(13번째)은 index.html 이 공중화장실 파일로 끝에 붙임. 오락 2종도 칩으로 있음(가중치 바닥값이라 추천 카드엔 거의 안 나옴)
BIGS = ["식사", "간편식", "카페·음료", "디저트·간식", "패션·잡화", "식품·편의", "뷰티·건강", "생활·리빙", "취미·문화", "기타 소매", "유원지·오락", "스포츠 서비스"]
ACTS = [(b, [b]) for b in BIGS]      # (칩 이름, 묶인 값) 모양은 옛 판과 같게 둠
OUT = os.path.join(HERE, "data", "walk9")
SPEED, M5, M10 = 1.3, 390, 780
PHONE = re.compile(r"0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}")   # 가게 이름에 들어간 전화번호(공개 사이트라 가림)
STATIONS = ["CV002017", "CV000826", "CV001539", "CV001523", "CV004090", "CV001087", "CV004512", "CV000939", "CV002137"]


def act_table():
    """소진공 소분류 → 속한 칩 번호 튜플(대분류 하나). excluded(inclusion != include)는 빈 튜플. 표에 BIGS 밖 대분류가 있으면 멈춤"""
    T = _tables()
    out = {}
    for r in T["category_map"]:
        sub, big = str(r["소분류"]).strip(), str(r["대분류"]).strip()
        if sub == "공중화장실": continue
        if int(r["excluded"]) == 1:
            out[sub] = (); continue
        if big not in BIGS: raise SystemExit(f"BIGS 에 없는 대분류 {big} ({sub})")
        out[sub] = (BIGS.index(big),)
    return out


_T = None


def _tables():
    global _T
    if _T is None:
        _T = json.load(open(CMAP, encoding="utf-8"))
    return _T


def overrides():
    """v5b store_overrides: place_id(shop:…) → (새 소분류, 세원 중분류(새 소분류의 category_map 값), 포함 여부, 묶음 키 merged_into)"""
    T = _tables()
    mid = {str(r["소분류"]).strip(): str(r.get("세원_중분류") or "").strip() for r in T["category_map"]}
    out = {}
    for r in T.get("store_overrides", []):
        sub = str(r["새_소분류"]).strip()
        out[str(r["place_id"])] = (sub, mid.get(sub, ""), str(r.get("inclusion", "include")) == "include", str(r.get("merged_into") or ""))
    return out


def attach_cats(w):
    """place_id(shop:상가업소번호) → 세원 전처리판의 중분류·소분류(mid = 세원 중분류, sub)와 칩(cat = 대표 칩 번호, cats = 속한 칩 목록).
    세원 파일에 없는 가게(77개 소분류 밖)와 excluded(담배 소매) 소분류는 cat 이 빈칸(= 뺌)"""
    T = act_table()
    w = w.copy(); w["sid"] = w["place_id"].str.replace("shop:", "", regex=False)
    s = pd.read_csv(SBIZ, dtype=str, usecols=["상가업소번호", "상권업종대분류명", "상권업종중분류명", "상권업종소분류명"])
    s = s.rename(columns={"상가업소번호": "sid", "상권업종대분류명": "big", "상권업종중분류명": "mid", "상권업종소분류명": "sub"})
    s["mid"] = s["mid"].str.strip(); s["sub"] = s["sub"].str.strip()
    w = w.drop(columns=[c for c in ["상권업종소분류명", "상권업종중분류명", "상권업종대분류명"] if c in w.columns]).merge(s, on="sid", how="left")
    ov = overrides()      # v5b: 가게 단위 예외가 category_map 보다 먼저
    pid = w["place_id"].astype(str)
    hit = pid.isin(ov)
    w.loc[hit, "sub"] = [ov[p][0] for p in pid[hit]]
    w.loc[hit, "mid"] = [ov[p][1] for p in pid[hit]]
    w["dup_key"] = [ov[p][3] if p in ov and ov[p][3] else p for p in pid]
    miss = sorted(set(w["sub"].dropna()) - set(T))
    if miss: raise SystemExit(f"대응표에 없는 소분류 {miss}")
    w["cats"] = w["sub"].map(T)
    off = hit & ~pid.map(lambda p: ov.get(p, (0, 0, True))[2])
    w.loc[off, "cats"] = [()] * int(off.sum())
    w["cat"] = w["cats"].map(lambda t: t[0] if isinstance(t, tuple) and t else None)
    return w


def load_routes(src, stations=None):
    """도보 경로 CSV(세원 칸 방식) → 칩(cat·cats), 도보 m·초, 성공 여부(ok), 카카오 도보 경로값 여부(kakao) 칸을 붙인 표.
    stations 를 주면 그 충전소만. 서울 전체판(build_walk_seoul.py)도 이 함수를 그대로 씀"""
    CATS = [c for c, _ in ACTS]
    w = pd.read_csv(src, dtype={"station_id": str, "place_id": str, "route_status": str, "correction": str, "kakao_checked": str, "osm_flag": str})
    if stations is not None:
        w = w[w["station_id"].isin(stations)].copy()
    w = attach_cats(w)
    w["walk_m"] = pd.to_numeric(w["walk_m"], errors="coerce")
    # 앱용 줄인 파일(서울 전체 _app.csv)은 route_status·correction 칸이 없음: 거리가 있으면 성공, 카카오 값은 route_mode 로 봄
    w["ok"] = w["route_status"].eq("ok") if "route_status" in w.columns else w["walk_m"].notna()
    w["walk_sec"] = w["walk_m"] / SPEED
    if "correction" in w.columns:
        w["kakao"] = w["correction"].fillna("").eq("kakao_measured")
    else:
        w["kakao"] = w.get("route_mode", pd.Series("", index=w.index)).fillna("").eq("kakao_SHORTEST")
        w["correction"] = w.get("route_mode", pd.Series("", index=w.index))
    return w, CATS


def write_station(d, sid, out, n_cats, fail=None):
    """충전소 하나의 표 d → out/<sid>.json. 요약(dict)과 파일 크기를 돌려줌.
    fail: 경로 미확인 수를 밖에서 셌을 때(10분 안 행만 있는 앱용 파일은 실패 행이 없어 여기서 셀 수 없음)"""
    dk = d[d["ok"] & (d["walk_m"] <= M10)]
    in_cat = dk[dk["cat"].notna()]
    if "dup_key" in in_cat.columns:     # v5b: 올리브영 중복 묶음은 이 충전소에서 도보가 가장 짧은 1곳만(score_reference 와 같은 (도보, place_id) 순)
        in_cat = in_cat.sort_values(["walk_m", "place_id"]).drop_duplicates("dup_key", keep="first")
    in_cat = in_cat.sort_values(["walk_m", "name"])
    n5, n10 = [0] * n_cats, [0] * n_cats
    items, pids, wms = [], [], []      # pids·wms: 추천 점수용(place_id 에서 'shop:' 뺀 값, 도보 m 소수 그대로). 줄 순서와 같음
    for _, r in in_cat.iterrows():
        cs = list(r["cats"]); c = cs[0]; in5 = int(r["walk_m"] <= M5)
        for k in cs: n10[k] += 1; n5[k] += in5
        row = [PHONE.sub("[전화번호]", str(r["name"]).strip()), c, r["sub"], round(float(r["lat"]), 5), round(float(r["lng"]), 5),
               max(1, math.ceil(r["walk_sec"] / 60 - 1e-9)), int(round(r["walk_m"])), in5, int(r["kakao"]), r["mid"]]
        if len(cs) > 1: row.append(cs)
        items.append(row); pids.append(str(r["place_id"]).replace("shop:", "")); wms.append(round(float(r["walk_m"]), 1))
    if fail is None:
        fr = d[~d["ok"] & (pd.to_numeric(d["straight_m"], errors="coerce") <= M10)]
        fail_cat = int(fr["cat"].notna().sum())
    else:
        fail_cat = int(fail)
    fp = os.path.join(out, sid + ".json")
    json.dump({"id": sid, "n5": n5, "n10": n10, "fail": fail_cat, "p": items, "pid": pids, "wm": wms}, open(fp, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    summ = {"id": sid, "n5": int((in_cat["walk_m"] <= M5).sum()), "n10": len(in_cat), "fail": fail_cat, "other10": int(dk["cat"].isna().sum()),
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
    print("세원 77개 소분류 밖(뺌) 가게 줄", no_match)
    print("합계 가게", total, "· 파일 합계 KB", round(size / 1e3))


if __name__ == "__main__":
    main()
