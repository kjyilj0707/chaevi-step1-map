"""서울 전체 충전소(급속 + 완속): 도보 10분(780m) 안 가게를 충전소별 파일로 만들기. build_walk9.py 의 서울판.
입력: 분석 담당의 서울 전체 도보 경로 CSV (칸은 walk_routes_9_v2.csv 와 같은 세원 방식 + kind, stay, osm_flag, correction)
      아래 SRC_CANDIDATES 중 처음 있는 파일을 씀. 다른 파일을 쓰려면 --src 경로
      raw/step2/sbiz_서울.csv (중분류·소분류, build_walk9.load_routes 와 같음)
출력: data/walk_seoul/<충전소ID>.json  (가게 줄 모양은 data/walk9 와 같음)
      data/walk_seoul/index.json        (충전소 요약 + demo(시연 9곳) + label + 정확도 낮음 표시)
화면(index.html)은 data/walk_seoul/index.json 이 있으면 이것을 먼저 쓰고, 없으면 data/walk9 를 씀.
실행: ~/.venvs/work/bin/python -I build_walk_seoul.py [--src CSV] [--out 폴더]

정확도 낮음(low) 판정은 임시안(분석 담당 칸 정의 확인 전):
- osm_flag 칸이 비어 있지 않고 0/ok/none 이 아닌 값이 있는 충전소, 또는
- 10분 안 가게 중 correction 에 "대체"·"추정"이 들어간 줄이 LOW_SHARE 넘는 충전소
"""
import argparse, glob, json, os, shutil, sys
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)            # -I 로 실행해도 같은 폴더의 build_walk9 를 읽게 함
import build_walk9 as B             # noqa: E402

AN = os.path.join(HERE, "..", "analysis")
SRC_CANDIDATES = [os.path.join(AN, "walk_seoul_all", "walk_routes_seoul_v2.csv"),
                  os.path.join(AN, "walk_seoul_all", "walk_routes_seoul.csv"),
                  os.path.join(AN, "walk_seoul_fast", "walk_routes_seoul_v2.csv")]
SRC_GLOBS = [os.path.join(AN, "walk_seoul_all", "walk_routes*.csv"), os.path.join(AN, "walk_seoul_fast", "walk_routes*.csv")]
OUT = os.path.join(HERE, "data", "walk_seoul")
WALK9 = os.path.join(HERE, "data", "walk9")
LOW_SHARE = 0.3
FLAG_OK = {"", "0", "0.0", "ok", "none", "nan", "false"}


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src"); ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    src = a.src or pick_src()
    if not src or not os.path.exists(src):
        sys.exit("입력 CSV 없음. 분석 담당의 서울 전체 도보 경로 파일 경로를 --src 로 주거나 SRC_CANDIDATES 를 고칠 것")
    print("입력", os.path.relpath(src, HERE))
    w, CATS = B.load_routes(src)
    print("충전소", w["station_id"].nunique(), "· 상가정보에서 못 찾은 가게", int(w["sub"].isna().sum()))

    out = a.out
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    idx, size, total = [], 0, 0
    for sid, d in w.groupby("station_id", sort=True):
        summ, sz, _ = B.write_station(d, sid, out, len(CATS))
        summ.update(station_extra(d, d[d["ok"] & (d["walk_m"] <= B.M10)]))
        idx.append(summ); size += sz; total += summ["n10"]

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
    meta = {"src": os.path.basename(src), "speed": B.SPEED, "m5": B.M5, "m10": B.M10, "cats": CATS, "note": B.NOTE,
            "label": f"서울 도보 {len(idx)}곳", "demo": demo, "stations": idx}
    json.dump(meta, open(os.path.join(out, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"충전소 파일 {len(idx)} · 합계 가게 {total} · 파일 합계 MB {size/1e6:.1f} · 정확도 낮음 {n_low} · 시연 {len(demo)}")


if __name__ == "__main__":
    main()
