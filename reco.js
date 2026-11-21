/* 주변 인프라 추천 점수 (2026-11-22). 기준 구현 = analysis/reco_tables/score_reference.py (같은 결과가 나와야 함)
   점수 = 시간 계수 × 페르소나 가중치(활동) × Π 상황 곱셈값
   가용 = 남은 − 왕복 도보 − α − 복합시설 왕복(2 × 재이 편도 분) − 여유 5
   시간 계수: 가용 ≥ 상한 → 1(가능) / 하한 ≤ 가용 < 상한 → 0.5(빠듯) / 가용 < 하한 → 0(불가). 쇼핑은 하한만
   장소 점수 = 장소가 가진 활동 중 최댓값(같으면 앞 활동). 순서 = 점수 큰 순 → 편도 짧은 순 → place_id
   후보 = 편도 ≤ 상한(기본 10분, 비·심야 5분), 재이 × 제외, 점수 0 제외. 심야 화장실은 개방시간 '상시'만
   보여 주기: score = 순서대로 max_cards / per_activity = 화면 묶음마다 대표 1곳. 키워드 필터가 켜지면 필터 안 점수순
   화면(index.html)과 시험(node)이 같이 씀: window.RECO 또는 globalThis.RECO */
(function (g) {
  const R = {};
  /* 조건 이름: 시각(아침 07~10시 morning, 심야 22~06시 night) + 날씨(rain / snow) */
  R.conditions = (hour, wx) => {
    const c = [];
    if (hour >= 22 || hour < 6) c.push('night');
    else if (hour >= 7 && hour < 10) c.push('morning');
    if (wx === 'rain' || wx === 'snow') c.push(wx);
    return c;
  };
  R.effects = (T, conds) => {
    const P = T.params, mult = {}, openf = {};
    let cap = P.walk_cap_min, speed = P.walk_speed_mps;
    T.ctx.forEach(r => {
      if (!conds.includes(r.condition)) return;
      if (r.rule_type === 'weight') mult[r.activity] = (r.activity in mult ? mult[r.activity] : 1.0) * Number(r.multiplier);
      else if (r.rule_type === 'open_filter') openf[r.activity] = String(r.value);
      else if (r.rule_type === 'walk_cap') cap = Math.min(cap, Number(r.value));
      else if (r.rule_type === 'walk_speed') speed = Math.min(speed, Number(r.value));
    });
    return {mult, cap, speed, openf};
  };
  R.timeFactor = (T, avail, act) => {
    const tf = T.params.time_factor, t = T.time[act], lo = t[0], hi = T.params.shopping_low_only && act === '쇼핑' ? t[0] : t[1];
    if (avail >= hi) return [tf.ok, '가능'];
    if (avail >= lo) return [tf.tight, '빠듯'];
    return [tf.no, '불가'];
  };
  /* 남길 활동: null = 전부. P4a 범위와 키워드가 같이 켜지면 교집합, 비면 키워드 활동만 */
  R.allowed = (T, persona, keyword) => {
    const scope = T.display[persona].allowed_activities, sc = scope === '*' ? null : new Set(scope.split('|'));
    const kw = keyword && T.kw[keyword] ? new Set(T.kw[keyword]) : null;
    if (!sc) return kw;
    if (!kw) return sc;
    const both = new Set([...sc].filter(a => kw.has(a)));
    return both.size ? both : kw;
  };
  /* places: [{pid, wm(도보 m), acts:[활동], open(개방시간), x(재이 ×), mall(복합시설 편도 분), ...}]
     돌려줌: 점수 > 0 인 후보 [{p, ow, avail, score, act, time, group}] (순서대로) */
  R.score = (T, places, o) => {
    const P = T.params, e = R.effects(T, o.conds || []), allow = R.allowed(T, o.persona, o.keyword), pw = T.pw[o.persona];
    const out = [];
    for (const p of places){
      if (p.x) continue;
      const ow = p.wm / (e.speed * 60);
      if (!(ow <= e.cap)) continue;
      const avail = o.remain - 2 * ow - (o.alpha || 0) - 2 * (p.mall || 0) - P.buffer_min;
      let top = [0.0, null, '불가'];
      for (const a of p.acts){
        if (allow && !allow.has(a)) continue;
        if (a in e.openf && !String(p.open || '').startsWith(e.openf[a])) continue;
        const [tf, st] = R.timeFactor(T, avail, a), v = tf * (pw[a] || 0.0) * (a in e.mult ? e.mult[a] : 1.0);
        if (v > top[0]) top = [v, a, st];
      }
      if (top[0] > 0) out.push({p, ow, avail, score:top[0], act:top[1], time:top[2], group:T.group[top[1]]});
    }
    out.sort((a, b) => b.score - a.score || a.ow - b.ow || (a.p.pid < b.p.pid ? -1 : a.p.pid > b.p.pid ? 1 : 0));
    return out;
  };
  R.display = (T, res, persona, keyword) => {
    const d = T.display[persona], n = +d.max_cards;
    if (d.display_mode === 'score' || (keyword && T.kw[keyword])) return res.slice(0, n);
    const seen = new Set(), rep = [];
    for (const r of res){ if (seen.has(r.group)) continue; seen.add(r.group); rep.push(r); }
    return rep.slice(0, n);
  };
  /* 도보 파일(data/walk_seoul/<id>.json) + 화장실 파일(data/reco/toilet/<id>.json) → places.
     cats = index.json 의 칩 이름(빠른 식사 = 포장·매장 두 활동). 재이 표시는 T.jaeyi[충전소][pid] */
  const CHIP_ACTS = {'빠른 식사': ['빠른 식사(포장)', '빠른 식사(매장)']};
  R.places = (T, sid, walk, toilets, cats) => {
    const jy = (T.jaeyi && T.jaeyi[sid]) || {}, out = [];
    const mark = (p, key) => { const j = jy[key]; if (j){ p.star = j[0]; p.brand = j[1]; p.x = j[2]; p.mall = j[3]; } return p; };
    if (walk && walk.pid) walk.p.forEach((x, i) => {
      const acts = [];
      (x[10] || [x[1]]).forEach(c => (CHIP_ACTS[cats[c]] || [cats[c]]).forEach(a => acts.push(a)));
      out.push(mark({pid:'shop:' + walk.pid[i], wm:walk.wm[i], acts, row:i, kind:'shop'}, walk.pid[i]));
    });
    (toilets || []).forEach((t, i) => out.push(mark({pid:'toilet:' + t[0], wm:t[4], acts:['화장실'], open:t[5], row:i, kind:'toilet'}, 'toilet:' + t[0])));
    return out;
  };
  g.RECO = R;
})(typeof window !== 'undefined' ? window : globalThis);
