/* 주변 인프라 추천 v5d (2026-11-22). 기준 구현 = analysis/reco_tables/score_reference.py (같은 결과가 나와야 함)
   v5d: 공원 슬롯 활성(data/reco/park/<id>.json, 출입구 최소 도보, 어린이공원 포함). 키워드 '산책하고 싶어요'(필터 = 공원)는 공원 후보를 붙여 v3e 점수,
     공원의 페르소나 가중치 = params.keyword_park_weight.value. 비·심야는 산책 곱 0 → 결과 없음(화면이 안내 문구)
   기본 카드 = 페르소나별 고정 슬롯 틀(R.slotCandidates → R.fillSlots, T.slotDef). 키워드(아무거나! 제외)가 켜지면 아래 v3e 점수(R.score → R.display)
   슬롯 후보 = 가게·화장실 + 쓰레기통(시간 1~3분, 상황 곱 없음) + 공원(파일이 있을 때만, 상황 곱 = 산책).
     시간 '불가'·상황 곱 0 제외, 활동이 여럿이면 (가능<빠듯, 곱 큰 순, 같으면 앞 활동). 순서 = 시간 → 곱 큰 순 → 편도 짧은 순 → place_id
     제약: 쓴 장소 다시 안 씀, 같은 대분류 2장(params.big_cap, 슬롯 카드만, params.big_cap_exempt 예외), distinct 면 슬롯 안 소분류 중복 없음
     모자라면 fallback 목록 순서대로 첫 번째로 1장 채울 수 있는 것(대체 카드는 상한 예외), 그래도 없으면 카드 수가 줄어듦. 표시 = 슬롯 순서
   가게 단위 예외(올리브영·전자담배)와 올리브영 중복 묶음은 도보 파일에 이미 반영됨(build_walk9.py). v5b 부터 재이 ×(담배)도 빼지 않음
   ---- 아래는 v3e 점수(키워드가 켜졌을 때) ----
   점수 = 시간 계수(가게 동권 활동) × 페르소나 가중치(가게 대분류) × Π 상황 곱셈값(가게 동권 활동)
   가게 → T.cmap[소분류] = [대분류, [가게 활동]]. 공중화장실 = 대분류·활동 '화장실'. 담배 소매 등 표에 없는 소분류는 뺌
   가용 = 남은 − 왕복 도보 − α − 복합시설 왕복(2 × 재이 편도 분) − 여유 5
   시간 계수: 가용 ≥ 상한 → 1(가능) / 하한 ≤ 가용 < 상한 → 0.5(빠듯) / 가용 < 하한 → 0(불가). 쇼핑은 하한만
   가게 점수 = 가게 활동 중 최댓값(같으면 앞 활동). 순서 = 점수 큰 순 → 편도 짧은 순 → place_id
   후보 = 편도 ≤ 상한(기본 10분, 비·심야 5분), 재이 × 제외, 점수 0 제외. 심야 화장실은 개방시간 '상시'만
   키워드(필터) = 재이가 붙인 소분류만. 허용 대분류(P4a·P4b)와 키워드가 같이 켜지면 대분류 교집합, 비면 키워드 대분류만 + 가게 활동 제한 풂
   보여 주기: score = 순서대로 max_cards / per_big = 대분류마다 대표 1곳 / per_store_activity(P4b) = card_units 단위마다 대표 1곳
   (단위 점수 = 그 단위 활동 점수 최댓값, 카드 순서 = 점수순·가까운 순). 키워드 필터가 켜지면 필터 안 점수순
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
  /* 범위 → {big: 허용 대분류 Set 또는 null, act: 허용 가게 활동 Set 또는 null, sub: 키워드 소분류 Set 또는 null} */
  R.scope = (T, persona, keyword) => {
    const d = T.display[persona], set = v => v === '*' || !v ? null : new Set(v.split('|'));
    const ab = set(d.allowed_big), asa = set(d.allowed_store_activity), k = keyword ? T.kw[keyword] : null;
    if (!k) return {big:ab, act:asa, sub:null};
    const kb = new Set(k.big), sub = new Set(k.sub);
    if (!ab) return {big:kb, act:asa, sub};
    const both = new Set([...ab].filter(b => kb.has(b)));
    return both.size ? {big:both, act:asa, sub} : {big:kb, act:null, sub};
  };
  const cmpPid = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  /* places: [{pid, wm(도보 m), sub(소분류), big(대분류), acts:[가게 활동], open(개방시간), x(재이 ×), mall(복합시설 편도 분), ...}]
     돌려줌: 점수 > 0 인 후보 [{p, ow, avail, score, act, time, group(대분류), per:{활동: [점수, 시간]}}] (순서대로) */
  R.score = (T, places, o) => {
    const P = T.params, e = R.effects(T, o.conds || []), sc = R.scope(T, o.persona, o.keyword), pw = T.pw[o.persona];
    const out = [];
    for (const p of places){
      if (sc.big && !sc.big.has(p.big)) continue;
      if (sc.sub && !sc.sub.has(p.sub)) continue;
      const ow = p.wm / (e.speed * 60);
      if (!(ow <= e.cap)) continue;
      const avail = o.remain - 2 * ow - (o.alpha || 0) - 2 * (p.mall || 0) - P.buffer_min, per = {};
      const w = p.big === '공원' ? Number((P.keyword_park_weight || {}).value || 0) : pw[p.big] || 0.0;     // v5c: 공원 키워드는 표의 고정 가중치
      let top = [0.0, null, '불가'];
      for (const a of p.acts){
        if (sc.act && !sc.act.has(a)) continue;
        if (a in e.openf && !String(p.open || '').startsWith(e.openf[a])) continue;
        const [tf, st] = R.timeFactor(T, avail, a), v = tf * w * (a in e.mult ? e.mult[a] : 1.0);
        per[a] = [v, st];
        if (v > top[0]) top = [v, a, st];
      }
      if (top[0] > 0) out.push({p, ow, avail, score:top[0], act:top[1], time:top[2], group:p.big, per});
    }
    out.sort((a, b) => b.score - a.score || a.ow - b.ow || cmpPid(a.p.pid, b.p.pid));
    return out;
  };
  const LAB = {'카페 테이크아웃': '테이크아웃', '카페 착석': '착석'};
  R.display = (T, res, persona, keyword) => {
    const d = T.display[persona], n = +d.max_cards;
    if (d.display_mode === 'score' || (keyword && T.kw[keyword])) return res.slice(0, n);
    if (d.display_mode === 'per_store_activity'){
      const out = [];
      for (const unit of String(d.card_units).split('|')){
        const [name, s] = unit.split('='), acts = s.split('+');
        let best = null, bs = 0;
        for (const r of res){
          const v = Math.max(0.0, ...acts.filter(a => a in r.per).map(a => r.per[a][0]));
          if (!(v > 0)) continue;
          if (!best || v > bs || (v === bs && (r.ow < best.ow || (r.ow === best.ow && cmpPid(r.p.pid, best.p.pid) < 0)))){ best = r; bs = v; }
        }
        if (!best) continue;
        let time = best.time;
        if (acts.length > 1){      // 카페 카드: 활동별 시간 표시
          const st = acts.filter(a => a in best.per).map(a => [LAB[a] || a, best.per[a][1]]);
          time = st.every(x => x[1] === '가능') ? '테이크아웃·착석 가능' : st.map(x => x[0] + ' ' + x[1]).join('·');
        }
        out.push(Object.assign({}, best, {act:name, score:bs, time, unit:name}));
      }
      out.sort((a, b) => b.score - a.score || a.ow - b.ow || cmpPid(a.p.pid, b.p.pid));
      return out.slice(0, n);
    }
    const seen = new Set(), rep = [];
    for (const r of res){ if (seen.has(r.group)) continue; seen.add(r.group); rep.push(r); }
    return rep.slice(0, n);
  };
  /* 도보 파일(data/walk_seoul/<id>.json, 가게 줄 2번 칸 = 소분류) + 화장실 파일(data/reco/toilet/<id>.json) → places.
     재이 표시는 T.jaeyi[충전소][pid] = [★, 브랜드명, ×, 복합시설 편도 분] */
  R.places = (T, sid, walk, toilets) => {
    const jy = (T.jaeyi && T.jaeyi[sid]) || {}, out = [];
    const mark = (p, key) => { const j = jy[key]; if (j){ p.star = j[0]; p.brand = j[1]; p.x = j[2]; p.mall = j[3]; } return p; };
    if (walk && walk.pid) walk.p.forEach((x, i) => {
      const cm = T.cmap[x[2]]; if (!cm) return;
      out.push(mark({pid:'shop:' + walk.pid[i], wm:walk.wm[i], sub:x[2], big:cm[0], acts:cm[1], row:i, kind:'shop'}, walk.pid[i]));
    });
    (toilets || []).forEach((t, i) => out.push(mark({pid:'toilet:' + t[0], wm:t[4], sub:'공중화장실', big:'화장실', acts:['화장실'], open:t[5], row:i, kind:'toilet'}, 'toilet:' + t[0])));
    return out;
  };
  /* 쓰레기통·공원 파일 → 슬롯 후보 줄. trash: [연번, 세부 위치, 위도, 경도, 도보 m, 종류], park: [공원ID, 이름, 위도, 경도, 도보 m, 공원유형, 어린이공원 1/0] */
  R.extras = (trash, parks) => {
    const out = [];
    (trash || []).forEach((t, i) => out.push({pid:'trash:' + t[0], wm:t[4], sub:'가로쓰레기통', big:'쓰레기통', acts:['쓰레기 버리기'], row:i, kind:'trash'}));
    (parks || []).forEach((t, i) => out.push({pid:'park:' + t[0], wm:t[4], sub:t[5] || '공원', big:'공원', acts:['산책'], row:i, kind:'park', child:t[6] ? 1 : 0}));
    return out;
  };
  const RANK = {'가능': 0, '빠듯': 1};
  /* 슬롯 후보(점수순): [{p, ow, avail, act, time, tr(시간 순위), mult(상황 곱), group}] */
  R.slotCandidates = (T, places, o) => {
    const P = T.params, e = R.effects(T, o.conds || []), out = [];
    for (const p of places){
      const ow = p.wm / (e.speed * 60);
      if (!(ow <= e.cap)) continue;
      const avail = o.remain - 2 * ow - (o.alpha || 0) - 2 * (p.mall || 0) - P.buffer_min;
      let best = null;
      if (p.big === '쓰레기통'){
        const [tf, st] = R.timeFactor(T, avail, '쓰레기 버리기');
        if (tf !== 0) best = [RANK[st], 1.0, '쓰레기 버리기', st];
      } else if (p.big === '공원'){
        const m = '산책' in e.mult ? e.mult['산책'] : 1.0, [tf, st] = R.timeFactor(T, avail, '산책');
        if (m !== 0 && tf !== 0) best = [RANK[st], m, '산책', st];
      } else {
        for (const a of p.acts){
          if (a in e.openf && !String(p.open || '').startsWith(e.openf[a])) continue;
          const [tf, st] = R.timeFactor(T, avail, a), m = a in e.mult ? e.mult[a] : 1.0;
          if (tf === 0 || m === 0) continue;
          if (!best || RANK[st] < best[0] || (RANK[st] === best[0] && m > best[1])) best = [RANK[st], m, a, st];
        }
      }
      if (best) out.push({p, ow, avail, tr:best[0], mult:best[1], act:best[2], time:best[3], group:p.big});
    }
    out.sort((a, b) => a.tr - b.tr || b.mult - a.mult || a.ow - b.ow || cmpPid(a.p.pid, b.p.pid));
    return out;
  };
  /* 슬롯 틀 채우기 → {cards: [후보 + {slot, slotBig, fb(대체로 채운 선택지 이름, 슬롯 카드는 '')}], events: [[원 슬롯 대분류, 대체 이름 또는 null]]} */
  R.fillSlots = (T, c, persona) => {
    const P = T.params, CAP = +P.big_cap, exempt = new Set((P.big_cap_exempt || {})[persona] || []), slots = (T.slotDef || {})[persona] || [];
    const used = new Set(), nBig = {}, cards = [], missing = [], events = [];
    const ok = (r, fb) => !used.has(r.p.pid) && (fb || exempt.has(r.p.big) || (nBig[r.p.big] || 0) < CAP);
    const take = (r, slot, fb) => { used.add(r.p.pid); nBig[r.p.big] = (nBig[r.p.big] || 0) + 1;
      cards.push(Object.assign({}, r, {slot:slot.n, slotBig:slot.big.join('|'), fb:fb || '', k:cards.length})); };
    for (const slot of slots){
      const bigs = new Set(slot.big), subs = new Set(); let n = 0;
      for (const r of c){
        if (!bigs.has(r.p.big)) continue;
        if (n === slot.count) break;
        if (!ok(r, false) || (slot.distinct === 1 && subs.has(r.p.sub))) continue;
        take(r, slot); subs.add(r.p.sub); n++;
      }
      for (let i = n; i < slot.count; i++) missing.push(slot);
    }
    for (const slot of missing){
      let got = null;
      for (const opt of slot.fb){
        for (const r of c) if (opt.includes(r.p.big) && ok(r, true)){ got = [r, opt.join('+')]; break; }
        if (got) break;
      }
      if (got){ take(got[0], slot, got[1]); events.push([slot.big.join('|'), got[1]]); }
      else events.push([slot.big.join('|'), null]);
    }
    cards.sort((a, b) => a.slot - b.slot || a.k - b.k);
    return {cards, events};
  };
  /* 화면 동작: 키워드(필터)가 켜지면 v3e(가게·화장실만), 아니면 슬롯 틀(가게·화장실 + 쓰레기통·공원) */
  R.recommend = (T, places, extra, o) => {
    if (o.keyword && T.kw[o.keyword]){
      if (T.kw[o.keyword].big.includes('공원')) places = places.concat((extra || []).filter(p => p.big === '공원'));     // v5c: 공원 키워드
      const res = R.score(T, places, o);
      return {mode:'keyword', res, cards:R.display(T, res, o.persona, o.keyword), events:[]};
    }
    const c = R.slotCandidates(T, places.concat(extra || []), o), f = R.fillSlots(T, c, o.persona);
    return {mode:'slots', res:c, cards:f.cards, events:f.events};
  };
  g.RECO = R;
})(typeof window !== 'undefined' ? window : globalThis);
