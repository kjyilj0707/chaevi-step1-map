"""주변 인프라 추천 화면용 자료 만들기 (2026-11-22, 프론트엔드)
입력(읽기만 함)
  ../analysis/reco_tables/reco_tables.json                        추천 점수 표 v3e(새 대분류, 분석 담당, 준엽 11/22 결정 반영판)
  ../analysis/walk_seoul_all/walk_routes_seoul_toilet_v2.csv      공중화장실 도보(10분 안)
  ../analysis/walk_seoul_all/walk_routes_seoul_trashbin_v2.csv    쓰레기통 도보(10분 안) + 옆의 summary_seoul_trashbin_v2.csv
  ../data/team_drive/1121/jaeyi_9stations_final_1122.csv          재이 9곳 최종판: ★·브랜드명·×·복합시설 편도 분 칸만 씀(주소·URL 등은 안 씀)
  ../data/team_drive/1121/cloud_inputs/dongkwon_1121/scenario_inputs.csv   충전소별 α(지하주차장 출구 분, 동권)
출력
  data/reco/tables.json        화면이 쓰는 표(설명 칸은 뺌) + 재이 표시 + α + 화장실 파일 목록 + 쓰레기통(있으면)
  data/reco/toilet/<id>.json   충전소별 도보 10분 안 공중화장실 [연번, 이름, 위도, 경도, 도보 m, 개방시간, 유형]
  data/reco/trash/<id>.json    충전소별 도보 10분 안 가로쓰레기통 [연번, 세부 위치, 위도, 경도, 도보 m, 종류]
점수 계산은 index.html 의 RECO(= analysis/reco_tables/score_reference.py 와 같은 규칙)
실행: ~/.venvs/work/bin/python -I build_reco.py
"""
import json, os, re, shutil
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
TABLES = os.path.join(ROOT, "analysis/reco_tables/reco_tables.json")
TOILET = os.path.join(ROOT, "analysis/walk_seoul_all/walk_routes_seoul_toilet_v2.csv")
TRASH = os.path.join(ROOT, "analysis/walk_seoul_all/walk_routes_seoul_trashbin_v2.csv")
JAEYI = os.path.join(ROOT, "data/team_drive/1121/jaeyi_9stations_final_1122.csv")
DONGKWON = os.path.join(ROOT, "data/team_drive/1121/cloud_inputs/dongkwon_1121/scenario_inputs.csv")
OUT = os.path.join(HERE, "data", "reco")
USE_TRASH = True       # 쓰레기통(11/22 도보표 준비됨). False 면 화면에 쓰레기통 줄·지도 표시가 안 나옴
PHONE = re.compile(r"0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}|(?<!\d)\d{3,4}[-.]\d{4}(?!\d)")


def clean(v):
    v = "" if pd.isna(v) else str(v).strip()
    return PHONE.sub("[전화번호]", v)


def main():
    T = json.load(open(TABLES, encoding="utf-8"))
    shutil.rmtree(OUT, ignore_errors=True); os.makedirs(os.path.join(OUT, "toilet"))

    # 표: 점수에 쓰는 칸만 (v3e: 가중치 = 대분류, 시간·상황 = 가게 동권 활동, 키워드 = 소분류 필터)
    pw = {}
    for r in T["persona_activity"]:
        if r["mapped"] == 1:
            pw.setdefault(r["persona_id"], {})[r["big_category"]] = float(r["weight_mapped"])
    names = {}
    for r in T["persona_activity"]:
        names.setdefault(r["persona_id"], r["persona_name"])
    kw = {}        # 키워드 → None(필터 없음) 또는 {big: [대분류], sub: [소분류]}
    for r in T["keyword_activity"]:
        if r["mode"] == "none":
            kw[r["keyword"]] = None
        else:
            k = kw.setdefault(r["keyword"], {"big": [], "sub": []})
            if r["big_category"] not in k["big"]: k["big"].append(r["big_category"])
            k["sub"] += [x for x in (r["subcat_filter"] or "").split("|") if x and x not in k["sub"]]
    ctx = [{"condition": r["condition"], "rule_type": r["rule_type"], "activity": r["store_activity"], "multiplier": r["multiplier"], "value": r["value"]}
           for r in T["context_activity"] if r["rule_type"] in ("weight", "walk_cap", "walk_speed", "open_filter")]
    # 소분류 → [대분류, [가게 활동]] (담배 소매 등 excluded 는 안 담음 = 후보에서 빠짐)
    cmap = {str(r["소분류"]).strip(): [r["대분류"], r["store_activity"].split("|")] for r in T["category_map"] if int(r["excluded"]) == 0}
    out = {
        "version": T["version"], "built": T["built"], "params": T["params"],
        "time": {r["category"]: [float(r["act_min_low"]), float(r["act_min_high"])] for r in T["activity_time"]},
        "pw": pw, "personaName": names, "kw": kw, "ctx": ctx, "cmap": cmap,
        "bigs": [r["big_category"] for r in T["big_categories"]],
        "display": {r["persona_id"]: {k: r[k] for k in ("display_mode", "max_cards", "allowed_big", "allowed_store_activity", "card_units")} for r in T["persona_display"]},
        "amenity": [{k: r[k] for k in ("amenity", "display")} for r in T["amenity"]],
    }
    # 슬롯 틀(v4c 이상): 페르소나 → 슬롯에 든 대분류 목록(대체 칸은 안 넣음). 정보 입력 화면(onboard.js)이 카드 클릭 때 +1/n 나눌 때 씀
    slots = {}
    for r in T.get("persona_slots", []):
        for b in str(r["big_categories"]).split("|"):
            b = b.strip()
            if b and b not in slots.setdefault(r["persona_id"], []):
                slots[r["persona_id"]].append(b)
    if slots:
        out["slots"] = slots

    # α (동권 시나리오 입력, 충전소별 한 값)
    sc = pd.read_csv(DONGKWON, encoding="utf-8-sig", dtype={"station_id": str}).drop_duplicates("station_id")
    out["alpha"] = {r.station_id: float(r.alpha_min) for r in sc.itertuples() if float(r.alpha_min) != 0}

    # 재이 9곳 최종판: (충전소, 장소) → [★ 1/0, 브랜드명, × 1/0, 복합시설 편도 분]. 기본값(○, ★ 없음, 복합시설 없음)인 줄은 안 담음
    j = pd.read_csv(JAEYI, dtype=str, usecols=["충전소 ID", "장소ID", "기본 추천 구분", "브랜드 우선 추천(★)", "브랜드명", "복합시설 내부 이동 가정(편도 분)"])
    j = j.drop_duplicates(["충전소 ID", "장소ID"])[["충전소 ID", "장소ID", "기본 추천 구분", "브랜드 우선 추천(★)", "브랜드명", "복합시설 내부 이동 가정(편도 분)"]]
    jy, n_j = {}, 0
    for r in j.itertuples(index=False):
        sid, pid, cls, star, brand, mall = r
        star = 1 if str(star).strip() == "★" else 0
        x = 1 if str(cls).strip() == "×" else 0
        mall = pd.to_numeric(mall, errors="coerce")
        mall = 0 if pd.isna(mall) else float(mall)
        if not (star or x or mall):
            continue
        key = str(pid).replace("shop:", "")       # 가게는 도보 파일 pid 와 같은 모양(shop: 뺌), 화장실은 toilet:연번 그대로
        jy.setdefault(sid, {})[key] = [star, clean(brand) if star else "", x, mall]
        n_j += 1
    out["jaeyi"] = jy

    # 공중화장실: 충전소별 파일
    t = pd.read_csv(TOILET, encoding="utf-8-sig", dtype={"station_id": str, "place_id": str})
    t = t[pd.to_numeric(t["walk_m"], errors="coerce").notna()].copy()
    t["walk_m"] = t["walk_m"].astype(float)
    tid = {}
    for sid, d in t.sort_values(["station_id", "walk_m", "place_id"]).groupby("station_id"):
        rows = [[str(r.place_id).replace("toilet:", ""), clean(r.name), round(float(r.lat), 6), round(float(r.lng), 6),
                 round(float(r.walk_m), 1), clean(r.개방시간), clean(r.유형)] for r in d.itertuples()]
        json.dump(rows, open(os.path.join(OUT, "toilet", sid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        tid[sid] = len(rows)
    out["toilet"] = tid

    # 쓰레기통(amenity, 점수 밖): 충전소별 파일 [연번, 세부 위치, 위도, 경도, 도보 m, 종류] + 표에 가장 가까운 곳 [도보 m, 종류, 10분 안 수]
    #   같은 위치 일반·재활용은 분석 담당이 한 줄로 묶음(kinds). 10분 안 없음 문구를 낼 충전소 = 요약 파일에 있는 충전소(trashCovered)
    out["trash"], out["trashCovered"] = {}, []
    if USE_TRASH and os.path.exists(TRASH):
        os.makedirs(os.path.join(OUT, "trash"))
        tr = pd.read_csv(TRASH, encoding="utf-8-sig", dtype={"station_id": str, "place_id": str})
        tr = tr[pd.to_numeric(tr["walk_m"], errors="coerce").notna()].copy()
        tr["walk_m"] = tr["walk_m"].astype(float)
        for sid, d in tr.sort_values(["station_id", "walk_m", "place_id"]).groupby("station_id"):
            rows = [[str(r.place_id).replace("trash:", ""), clean(r.name), round(float(r.lat), 6), round(float(r.lng), 6),
                     round(float(r.walk_m), 1), clean(r.kinds)] for r in d.itertuples()]
            json.dump(rows, open(os.path.join(OUT, "trash", sid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            out["trash"][sid] = [rows[0][4], rows[0][5], len(rows)]
        sm = os.path.join(os.path.dirname(TRASH), "summary_seoul_trashbin_v2.csv")
        if os.path.exists(sm):
            s = pd.read_csv(sm, encoding="utf-8-sig", dtype=str)
            out["trashCovered"] = sorted(s.loc[~s["excluded"].fillna("0").isin(["1", "True", "true"]), "station_id"])

    json.dump(out, open(os.path.join(OUT, "tables.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"표 저장 · 재이 표시 {n_j}줄({len(jy)}곳) · α {out['alpha']} · 화장실 파일 {len(tid)}곳 {sum(tid.values())}줄 · 쓰레기통 {len(out['trash'])}곳 / 요약 {len(out['trashCovered'])}곳")


if __name__ == "__main__":
    main()
