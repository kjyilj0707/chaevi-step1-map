"""서울 전체 충전소(급속 + 완속): 도보 10분(780m) 안 가게를 충전소별 파일로 만들기. build_walk9.py 의 서울판.
입력: 분석 담당의 서울 전체 도보 경로 CSV (칸은 walk_routes_9_v2.csv 와 같은 세원 방식 + kind, stay, osm_flag, correction)
      아래 SRC_CANDIDATES 중 처음 있는 파일을 씀. 다른 파일을 쓰려면 --src 경로
      ../data/team_drive/1121/sewon_sbiz_subcat_202609.csv (세원 77개 소분류·세원 중분류, build_walk9.attach_cats 와 같음)
출력: data/walk_seoul/<충전소ID>.json  (가게 줄 모양은 data/walk9 와 같음)
      data/walk_seoul/index.json        (충전소 요약 + demo(시연 9곳) + label + 정확도 낮음 표시)
화면(index.html)은 data/walk_seoul/index.json 이 있으면 이것을 먼저 쓰고, 없으면 data/walk9 를 씀.
실행: ~/.venvs/work/bin/python -I build_walk_seoul.py [--src CSV] [--out 폴더]

정확도 낮음(low): 입력 CSV 옆의 summary_seoul_all_v*.csv 가 있으면 분석 담당의 충전소 단위 confidence(low)를 그대로 씀
  (analysis/walk_seoul_all/README.md: 직선 추정 충전소(graph_src=none), osm_flag 충전소). 이유 문구는 graph_src·osm_flag 로 만듦
  summary 가 없으면 임시안: osm_flag 값이 있거나, 10분 안 가게 중 대체·추정 줄이 LOW_SHARE 넘는 충전소
"""
import argparse, glob, json, os, re, shutil, sys
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)            # -I 로 실행해도 같은 폴더의 build_walk9 를 읽게 함
import build_walk9 as B             # noqa: E402

AN = os.path.join(HERE, "..", "analysis")
SRC_CANDIDATES = [os.path.join(AN, "walk_seoul_all", "walk_routes_seoul_all_v2_within10_app_share.csv"),   # 공유용(전화번호 두 패턴 가림)
                  os.path.join(AN, "walk_seoul_all", "walk_routes_seoul_all_v2_within10_app.csv"),
                  os.path.join(AN, "walk_seoul_all", "walk_routes_seoul_all_v1_within10_app.csv"),
                  os.path.join(AN, "walk_seoul_all", "walk_routes_seoul_v2.csv"),
                  os.path.join(AN, "walk_seoul_all", "walk_routes_seoul.csv"),
                  os.path.join(AN, "walk_seoul_fast", "walk_routes_seoul_v2.csv")]
SRC_GLOBS = [os.path.join(AN, "walk_seoul_all", "walk_routes*.csv"), os.path.join(AN, "walk_seoul_fast", "walk_routes*.csv")]
OUT = os.path.join(HERE, "data", "walk_seoul")
WALK9 = os.path.join(HERE, "data", "walk9")
LOW_SHARE = 0.3
FLAG_OK = {"", "0", "0.0", "ok", "none", "nan", "false"}
PHONE2 = re.compile(r"(?<!\d)\d{3,4}[-.]\d{4}(?!\d)")    # 지역번호 없는 번호(1588-0000 등). 공유용 CSV와 같은 규칙으로 한 번 더 가림
WHY_PENDING = "도보 거리 카카오 미확인(정확도 낮음)"
EXCL_WHY = "측정 이상으로 도보 정보 제외"


def pick_src():
    for p in SRC_CANDIDATES:
        if os.path.exists(p):
            return p
    found = sorted((p for g in SRC_GLOBS for p in glob.glob(g)), key=os.path.getmtime)
    return found[-1] if found else None


def station_extra(d, dk):
    """충전소 단위 참고 값: kind, stay, 정확도 낮음(low, lowWhy)"""
    ex = {}
    for col in ("kind", "stay"):
        if col in d.columns and d[col].notna().any():
            v = d[col].dropna().iloc[0]
            ex[col] = v.item() if hasattr(v, "item") else v
    why = []
    if "osm_flag" in d.columns:
        flags = sorted({str(v).strip() for v in d["osm_flag"].dropna()} - FLAG_OK, key=str)
        if flags:
            why.append("OSM 길망 표시: " + ", ".join(flags[:3]))
    corr = dk["correction"].fillna("")
    share = float(corr.str.contains("대체|추정").mean()) if len(dk) else 0.0
    if share > LOW_SHARE:
        why.append(f"추정 보정 {share:.0%}")
    if why:
        ex["low"] = 1; ex["lowWhy"] = " · ".join(why)
    return ex


NOTE_STRAIGHT = "도보 시간 = 직선거리 × 1.45 추정(카카오 서울 표본 기준), 보행 1.3 m/s 가정. 영업 여부 미확인"


def fail_counts(parquet):
    """전체 행 파일(parquet)에서 직선 780m 안인데 경로를 못 찾은(route_status != ok 이고 거리 없음) 가게를 충전소별로, 지도 칩(동권 활동) 안만 셈.
    route_status=excluded(v1.1: 충전소째 제외)는 실패로 세지 않음"""
    import pyarrow.parquet as pq
    t = pq.read_table(parquet, columns=["station_id", "place_id", "straight_m", "route_status", "walk_m"]).to_pandas()
    f = t[~t["route_status"].isin(["ok", "excluded"]) & t["walk_m"].isna() & (pd.to_numeric(t["straight_m"], errors="coerce") <= B.M10)]
    print("경로 미확인(직선 780m 안) 전체", len(f), dict(f["station_id"].value_counts()))
    f = B.attach_cats(f)
    return f[f["cat"].notna()].groupby("station_id").size().to_dict()


def excluded_ids(path):
    """summary 의 excluded 가 참(1/True)인 충전소: 도보 자료 없이 기존 직선 반경으로 둠"""
    s = pd.read_csv(path, dtype=str)
    if "excluded" not in s.columns:
        return set()
    return set(s.loc[s["excluded"].fillna("").str.lower().isin(["1", "true"]), "station_id"])


def straight_only(path):
    """summary 에서 graph_src=none(길 정보 없이 직선 추정)인 충전소"""
    s = pd.read_csv(path, dtype=str)
    return set(s.loc[s["graph_src"].eq("none"), "station_id"])


def summary_low(path):
    """분석 담당 summary → {충전소: 이유 문구}(confidence=low 인 곳만)"""
    s = pd.read_csv(path, dtype=str)
    out = {}
    for _, r in s[s["confidence"].eq("low")].iterrows():
        flag = str(r.get("osm_flag") or "").replace("nan", "").strip()
        if r.get("flag_judge_v2") == "pending_kakao":      # v2 판정 보류(카카오 무작위 쌍 없음). 노량진 대체식(행 단위 low)과 다름
            why = WHY_PENDING
        elif r.get("graph_src") == "none":
            why = "주변 길 정보 없이 직선거리 × 1.45로 추정"
        elif "snap50" in flag:
            why = "주변 길 정보가 덜 들어 있어 거리 오차가 클 수 있음"
        elif "detour" in flag:
            why = "길 따라 거리가 직선보다 유난히 길어 대체식(직선 × 1.4)과 섞어 씀"
        else:
            why = "길 정보 확인 필요"
        out[r["station_id"]] = why
    return out


def no_shop_ids(path):
    """summary 에서 제외가 아니고 직선 1km 안 가게는 있는데 도보 10분 안 가게가 0곳인 충전소 → {id: (kind, stay)}.
    앱용 CSV에는 행이 없어 빠지므로 빈 도보 파일로 넣어 '도보 10분 안 가게 없음'으로 보이게 함.
    직선 1km 안 가게도 0곳인 곳(CV004747)과 좌표 오류(coord_outside_seoul)는 이전 판처럼 직선 반경으로 둠"""
    s = pd.read_csv(path, dtype=str)
    m = (~s["excluded"].fillna("").str.lower().isin(["1", "true"]) & s["graph_src"].ne("coord_outside_seoul")
         & (pd.to_numeric(s["n_straight_1km"], errors="coerce") > 0) & (pd.to_numeric(s["n_walk780"], errors="coerce").fillna(0) == 0))
    return {r["station_id"]: (r["kind"], int(float(r["stay"] or 0))) for _, r in s[m].iterrows()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src"); ap.add_argument("--out", default=OUT); ap.add_argument("--summary")
    a = ap.parse_args()
    src = a.src or pick_src()
    if not src or not os.path.exists(src):
        sys.exit("입력 CSV 없음. 분석 담당의 서울 전체 도보 경로 파일 경로를 --src 로 주거나 SRC_CANDIDATES 를 고칠 것")
    print("입력", os.path.relpath(src, HERE))
    sm = a.summary or next(iter(sorted(glob.glob(os.path.join(os.path.dirname(src), "summary_seoul_all_v*.csv")))[-1:]), None)
    lows = summary_low(sm) if sm and os.path.exists(sm) else None
    print("정확도 판정", os.path.relpath(sm, HERE) if lows is not None else "임시안(행 단위)")
    pq_path = re.sub(r"_within10_app(_share)?\.csv$", ".parquet", src)
    pq_path = pq_path if pq_path != src and os.path.exists(pq_path) else next(iter(sorted(glob.glob(os.path.join(os.path.dirname(src), "walk_routes_seoul_all_v*.parquet")))[-1:]), None)
    fails = fail_counts(pq_path) if pq_path else None
    print("경로 미확인 수", os.path.relpath(pq_path, HERE) if fails is not None else "입력 CSV 안에서(10분 안 행만 있으면 0)")
    straight = straight_only(sm) if lows is not None else set()
    excl = excluded_ids(sm) if lows is not None else set()
    w, CATS = B.load_routes(src)
    n_ph = int(w["name"].astype(str).str.contains(PHONE2).sum())
    w["name"] = w["name"].astype(str).str.replace(PHONE2, "[전화번호]", regex=True)
    print("가게 이름 전화번호(지역번호 없는 패턴) 가림", n_ph)
    if excl:
        print("제외 충전소", sorted(excl), "· 입력에 남아 있던 행", int(w["station_id"].isin(excl).sum()))
        w = w[~w["station_id"].isin(excl)]
    print("충전소", w["station_id"].nunique(), "· 세원 77개 소분류 밖(뺌) 가게 줄", int(w["sub"].isna().sum()), "/", len(w))

    out = a.out
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    idx, size, total = [], 0, 0
    for sid, d in w.groupby("station_id", sort=True):
        summ, sz, _ = B.write_station(d, sid, out, len(CATS), fail=None if fails is None else fails.get(sid, 0))
        if sid in straight: summ["note"] = NOTE_STRAIGHT
        ex = station_extra(d, d[d["ok"] & (d["walk_m"] <= B.M10)])
        if lows is not None:
            ex.pop("low", None); ex.pop("lowWhy", None)
            if sid in lows: ex["low"] = 1; ex["lowWhy"] = lows[sid]
            if lows.get(sid) == WHY_PENDING: ex["pending"] = 1
        summ.update(ex)
        if summ["n10"] == 0: summ["empty"] = 1       # 세원 77개 소분류·동권 활동(대응 없음 뺌)으로 거른 뒤 도보 10분 안 가게가 0곳: v2 CV000753 과 같은 '가게 없음' 표시
        idx.append(summ); size += sz; total += summ["n10"]

    # 도보 10분 안 가게 0곳(앱용 CSV에 행 없음): 빈 파일로 넣어 지도에서 빠지지 않게 함
    empty = {}
    if lows is not None:
        have = {x["id"] for x in idx}
        for sid, (kind, stay) in sorted(no_shop_ids(sm).items()):
            if sid in have: continue
            summ, sz, _ = B.write_station(w.iloc[0:0], sid, out, len(CATS), fail=None if fails is None else fails.get(sid, 0))
            summ.update({"kind": kind, "stay": stay, "empty": 1}); idx.append(summ); size += sz; empty[sid] = 1
        print("도보 10분 안 가게 없음(빈 파일)", sorted(empty))
    idx.sort(key=lambda x: x["id"])

    # 시연 9곳 중 서울 전체판에 없는 곳은 data/walk9 파일을 그대로 가져와 시연 표시를 유지
    have = {x["id"] for x in idx}
    demo = list(B.STATIONS)
    w9 = os.path.join(WALK9, "index.json")
    if os.path.exists(w9):
        m9 = {x["id"]: x for x in json.load(open(w9, encoding="utf-8"))["stations"]}
        for sid in demo:
            if sid not in have and sid in m9:
                shutil.copy(os.path.join(WALK9, sid + ".json"), os.path.join(out, sid + ".json"))
                idx.append(dict(m9[sid], src="walk9")); print("시연 충전소를 walk9 에서 가져옴", sid)
    demo = [s for s in demo if s in {x["id"] for x in idx}]

    n_low = sum(1 for x in idx if x.get("low"))
    excl_why = {sid: EXCL_WHY for sid in sorted(excl)}      # 화면: 직선 반경으로 보이되 이 문구를 붙임
    meta = {"src": os.path.basename(src), "summary": os.path.basename(sm) if lows is not None else None, "speed": B.SPEED, "m5": B.M5, "m10": B.M10, "cats": CATS, "note": B.NOTE,
            "label": f"서울 도보 {len(idx)}곳", "demo": demo, "excluded": excl_why, "stations": idx}
    json.dump(meta, open(os.path.join(out, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"충전소 파일 {len(idx)} · 합계 가게 {total} · 파일 합계 MB {size/1e6:.1f} · 정확도 낮음 {n_low}(보류 {sum(1 for x in idx if x.get('pending'))}) · 가게 없음 {sum(1 for x in idx if x.get('empty'))}(빈 파일 {len(empty)}) · 제외 {len(excl_why)} · 시연 {len(demo)}")


if __name__ == "__main__":
    main()
