/* 충전소 추천(기본 지도 화면, MVP 3단계 v1, 2026-11-22. 표 v1.3(11/23) = 붐빔 v2 + 맞춤 fit2(칸 채움 0.5 + 풍부도 0.5) + 저이용 30곳 중립, 카드 가로 넘김)
   - 표 = data/reco/station_reco.json (분석 담당 score_reference_station.py 출력, 기준 README §2). 가중치·반경·문구 경계는 모두 이 JSON에서 읽음
     → 규칙을 바꿀 때는 JSON만 다시 만들면 됨(이 파일은 그대로)
   - 점수 = w.fit x fit + w.busy x (1 - 이용률[지금 시]) + w.dist x (1 - 직선거리 / 반경)
     붐빔 표시가 no_data·insufficient 이면 이용률 대신 busy_neutral(0.5), 문구 "붐빔 자료 부족"
   - 후보 = 반경 안 + walk_ok(도보 자료 있음). no_walk_policy = 'exclude'면 도보 자료 없는 충전소는 뺌, 'neutral'이면 fit 0.5
   - 순서 = 점수(소수 4자리) 큰 순 → 거리(km, 소수 2자리) 짧은 순 → id. 화면 = 상위 top_n곳
   - 남은 시간: 표에 있는 값(remains, 지금 30·45분) 중 남은 시간 이하인 가장 큰 값으로 계산(내림, 11/22 점검 1·D37: 44분 → 30분, 60분 → 45분).
     남은 시간이 표의 가장 작은 값보다 적으면 가장 작은 값(15분 → 30분 표) + 제목에 '(30분 표 기준)' 표시
   - 브라우저에서는 window.STRECO, node에서는 module.exports (확인용) */
(function (g) {
  let T = null, P = null;
  /* 파이썬 round(x, n)과 같은 반올림: 이진 값 그대로 반올림하고, 정확히 가운데(예: 0.78125)면 짝수 쪽.
     toFixed 만 쓰면 가운데에서 큰 쪽으로 가서 점수가 0.0001 달라짐(거리 0·이용률 1/16 배수일 때, 61,200 상황 중 91) */
  const round = (x, n) => {
    const t = Math.abs(x).toFixed(60), rest = t.slice(t.indexOf('.') + 1 + n);
    if (/^50*$/.test(rest)){ const lo = Math.floor(Math.abs(x) * 10 ** n), v = (lo % 2 ? lo + 1 : lo) / 10 ** n; return x < 0 ? -v : v; }
    return Number(x.toFixed(n));
  };
  function havKm(a1, o1, a2, o2){
    const r = 6371.0088, rad = Math.PI / 180, p1 = a1 * rad, p2 = a2 * rad, dp = p2 - p1, dl = (o2 - o1) * rad;
    const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(x));
  }
  function josa(word, a, b){ a = a || '이'; b = b || '가';
    const c = word.charCodeAt(word.length - 1);
    if (c >= 0xAC00 && c <= 0xD7A3) return (c - 0xAC00) % 28 ? a : b;
    return a; }
  const neutralFlag = f => f === 'no_data' || f === 'insufficient';
  /* low = 저이용 충전소(v1.3 stations[].lowuse): 문구 = reason.busy_lowuse(지도 복사본 '이용 기록 적음'), 점수 이용률은 busy_neutral */
  const lowTxt = () => T.reason.busy_lowuse || T.reason.busy_none;
  function busyText(o, flag, low){
    const R = T.reason;
    if (low) return lowTxt();
    if (neutralFlag(flag) || o == null) return R.busy_none;
    /* 하루치(one_day)는 '보통 ~'을 쓰지 않음: '이 시간대 한산했음(하루 관측·참고)'. 2일 이상(ok)만 '보통 한산(참고)' 등 */
    const day1 = flag === 'one_day' && R.busy_text_one_day;
    for (const [lim, t] of day1 ? R.busy_text_one_day : R.busy_text) if (o < lim) return `이 시간대 ${t}(${day1 ? R.busy_one_day_note || '하루 관측·참고' : '참고'})`;
    return R.busy_none;
  }
  /* 카드 화면용 붐빔 조각(문구 경계·하루치 구분은 busyText와 같음): lv 0 한산 / 1 보통 / 2 붐빔 / null 자료 부족 */
  function busyParts(o, flag, low){
    const R = T.reason;
    if (low) return {lv:null, txt:lowTxt(), note:'', low:true};
    if (neutralFlag(flag) || o == null) return {lv:null, txt:R.busy_none, note:''};
    const day1 = flag === 'one_day' && R.busy_text_one_day, L = day1 ? R.busy_text_one_day : R.busy_text;
    for (let i = 0; i < L.length; i++) if (o < L[i][0]) return {lv:Math.min(i, 2), txt:L[i][1], note:day1 ? '하루 관측' : '참고'};
    return {lv:null, txt:R.busy_none, note:''};
  }
  /* 채운 슬롯 대분류 → 짧은 이름, show_order 순 */
  function amenNames(filled){
    const R = T.reason, so = R.show_order;
    return filled.map(b => R.short_names[b] || b)
      .map((x, i) => [so.includes(x) ? so.indexOf(x) : 99, i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
  }
  function reasonOf(filled, fit, o, flag, d, low){
    const R = T.reason;
    const names = amenNames(filled);
    let amen;
    if (names.length){ const lst = names.slice(0, 3).join('·') + (names.length > 3 ? ' 등' : '');
      amen = `도보 10분 안에 ${lst}${josa(lst)} ` + (fit >= 1 ? '다 있어요' : '있어요'); }
    else amen = R.amen_none;
    return R.template.replace('{amen}', amen).replace('{busy}', busyText(o, flag, low)).replace('{dist}', d.toFixed(1) + 'km');
  }
  const remainKey = rm => { const ok = T.remains.filter(v => v <= rm + 1e-9); return ok.length ? Math.max(...ok) : Math.min(...T.remains); };
  /* lat·lng 기준 반경 안 후보 전체를 점수 순으로. 각 항목: id, name, kind, stay, dist_km, fit, occupancy, busy_flag, n_obs, score, reason */
  function rank(lat, lng, persona, remain, hour){
    if (!T) return [];
    const S = T.score, w = S.weights, R = S.radius_km, rk = String(remainKey(remain)), out = [];
    for (const s of T.stations){
      const d = havKm(lat, lng, s.lat, s.lng);
      if (d > R) continue;
      let f = s.walk_ok && s.fit && s.fit[persona] ? s.fit[persona][rk] : null;
      if (!f){ if (S.no_walk_policy === 'exclude') continue; f = {fit:0.5, filled:[]}; }
      const flag = s.busy_flag24[hour], o = s.occ24[hour], n = s.nobs24[hour], low = !!s.lowuse;
      /* v1.3(11/23 준엽 결정): 점수 맞춤 = fit[score.fit_field](fit2 = 0.5 칸 채움 + 0.5 주변 풍부도), 없으면 fit. 저이용(lowuse)은 이용률 대신 busy_neutral(= lowuse_occ 0.5) */
      const fs = f[S.fit_field] != null ? f[S.fit_field] : f.fit;
      const useO = neutralFlag(flag) || o == null || low ? S.busy_neutral : o;
      const sc = w.fit * fs + w.busy * (1 - useO) + w.dist * (1 - d / R);
      out.push({id:s.id, name:s.name, kind:s.kind, stay:s.stay, dist_km:round(d, 2), fit:f.fit, fit2:fs, rich_lv:f.rich_lv || null, n_ok_slot:f.n_ok_slot != null ? f.n_ok_slot : null, lowuse:low,
        occupancy:o, busy_flag:flag, n_obs:n, filled:f.filled, walk_ok:s.walk_ok,
        score:round(sc, 4), reason:f.filled.length || s.walk_ok ? reasonOf(f.filled, f.fit, o, flag, d, low) : `주변 정보 없음 · ${busyText(o, flag, low)} · ${d.toFixed(1)}km`});      // 이유 문구('다 있어요')는 원래 fit
    }
    out.sort((a, b) => b.score - a.score || a.dist_km - b.dist_km || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }
  /* 같은 건물 층별 충전소 묶기(11/23 준엽 결정). 이름에서 층 표기(지하N층·지상N층·BN·BNF)를 뺀 이름이 같고 직선 50m 안이면 한 묶음.
     점수·순서(rank)는 그대로, 패널에서 rank 순서대로 훑어 처음 나온 곳(= 묶음 안 최고 점수)을 대표로 두고 뒤의 같은 묶음은 대표에 붙임 → 상위 3곳은 묶은 뒤 다시 채움 */
  const FLOOR_RE = /\s*(?:(지하|지상)\s*(\d+)\s*층|\b(B)(\d+)F?\b)/;
  function floorSplit(name){
    const m = String(name).match(FLOOR_RE); if (!m) return null;
    const base = String(name).replace(FLOOR_RE, ' ').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').replace(/\s+\)/g, ')').trim();
    return {base, pre:m[1] || '지하', n:+(m[2] || m[4])};      // BN = 지하 N층
  }
  const GROUP_KM = 0.05;
  function groupFloors(list){
    const pos = {}; T.stations.forEach(x => { pos[x.id] = x; });
    const reps = [];
    for (const r of list){
      const f = floorSplit(r.name), me = pos[r.id];
      const g = f && reps.find(x => x.fl && x.fl.base === f.base && havKm(pos[x.id].lat, pos[x.id].lng, me.lat, me.lng) <= GROUP_KM);
      if (g){ g.members.push(Object.assign({}, r, {fl:f})); continue; }
      reps.push(Object.assign({}, r, {fl:f, members:[]}));
    }
    return reps;
  }
  /* 묶음 층 글자: '지하3·4·5층', '지하4층·지상1층'(지하 깊은 쪽부터가 아니라 숫자 작은 순) */
  function floorLabel(r){
    const fl = [r.fl].concat(r.members.map(m => m.fl)).filter(Boolean), by = {};
    fl.forEach(f => { (by[f.pre] = by[f.pre] || new Set()).add(f.n); });
    return ['지하', '지상'].filter(k => by[k]).map(k => k + [...by[k]].sort((a, b) => a - b).join('·') + '층').join('·');
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'})[c]);
  const kmTxt = d => d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km';
  /* 지도 화면 패널 HTML. o = {lat, lng, from:'me'|'center', persona, personaName, remain, hour, only, keep, keepLabel, meta}
     - o.only(id) = 화면 범위 거름(11/23 준엽: 급속 충전기가 1대 이상인 곳만, 완속만 있는 곳 제외). 칩이 아니라 늘 적용, 점수·순서는 그대로
     - o.keep(id) = 지도 위쪽 칩(채비스테이·한가한 곳·붐비는 곳) 거름. 점수·순서는 그대로, 거른 뒤 상위 top_n곳
     - o.thumb(id) = 카드 오른쪽 위 위성 사진 HTML(11/23, z19 확대·흰 원·축척 막대), 없으면 생략
     - o.meta(id) = 카드 둘째 줄 충전기 요약(예: '급속 2대 · 100kW'), 없으면 생략
     카드(11/23 가독성): 순위·이름 / 거리·충전기 / 붐빔 알약 / 왜 추천(페르소나 맞춤 n/5 + 주변 장소) 순.
     맞춤이 같은 카드끼리는 '맞춤 같음'을 적고, 위 3곳이 모두 같으면 '순서는 덜 붐빔·가까움으로 정함'을 한 줄로 알림(점수식 그대로, 사실만 표시) */
  function panel(o){
    if (!T) return '';
    const S = T.score, ranked = rank(o.lat, o.lng, o.persona, o.remain, o.hour);
    const pool = o.only ? ranked.filter(r => o.only(r.id)) : ranked, all = o.keep ? pool.filter(r => o.keep(r.id)) : pool;
    const grouped = groupFloors(all), top = grouped.slice(0, S.top_n), rk = remainKey(o.remain), pname = esc(o.personaName || o.persona);
    const sub = `남은 ${o.remain}분${rk !== o.remain ? `(${rk}분 표 기준)` : ''} · ${o.hour}시 · ${o.from === 'me' ? '내 위치' : '지도 가운데'}에서 ${S.radius_km}km${o.keepLabel ? ' · ' + esc(o.keepLabel) : ''}`;
    const nSlot = 5, slots = f => Math.round(f * nSlot);
    /* 동점 = 점수에 들어간 맞춤(fit2, 소수 넷째 자리) 기준(v1.3). fit(n/5)이 같아도 fit2가 다르면 동점 아님 */
    const f4 = r => Math.round(r.fit2 * 1e4), fits = top.map(f4), allSame = top.length > 1 && fits.every(f => f === fits[0]);
    const RICH_CLS = {'상':'r3', '중':'r2', '하':'r1'};
    const BUSY_CLS = ['lo', 'mid', 'hi'];
    const cards = top.map((r, i) => {
      const bp = busyParts(r.occupancy, r.busy_flag, r.lowuse), names = amenNames(r.filled), n = slots(r.fit);
      /* 맞춤이 같은 다른 카드 순위(예: '2·3위와 같음'). 근거 없는 차이를 만들지 않으려고 같으면 같다고만 적음 */
      const mates = top.map((x, j) => j !== i && f4(x) === f4(r) ? j + 1 : 0).filter(Boolean);
      const rich = r.rich_lv ? `<span class="srrich ${RICH_CLS[r.rich_lv] || ''}">주변 ${r.n_ok_slot != null ? r.n_ok_slot.toLocaleString('ko-KR') + '곳 · ' : ''}풍부 ${esc(r.rich_lv)}</span>` : '';
      const lst = names.length ? names.slice(0, 3).join('·') + (names.length > 3 ? ' 등' : '') : '';
      const why = r.walk_ok ? `<div class="srwhy">${pname} 맞춤 <b>${n}/${nSlot}</b>${rich}${allSame ? `<em>${top.length}곳 같음</em>` : mates.length ? `<em>${mates.join('·')}위와 같음</em>` : ''}</div>
      <div class="srplace">${lst ? `도보 10분 안 ${esc(lst)}` : '도보 10분 안 맞춤 장소 적음'}</div>`
        : `<div class="srplace">주변 정보 없음</div>`;
      const meta = o.meta ? o.meta(r.id) : '', sat = o.thumb ? o.thumb(r.id) : '';      // sat = 위성 작은 그림 HTML(index.html satThumb), 있으면 거리는 그림 아래 띠로
      const nm = r.members.length ? `${r.fl.base} ${floorLabel(r)}` : r.name;      // 묶음이면 '한국타이어 역삼사옥 지하2·3·4층'
      const grp = r.members.length ? `<span class="srgrp" title="같은 건물 층별 충전소를 묶음. 붐빔·충전기는 대표(${esc(r.name)}) 기준">같은 건물 ${r.members.length + 1}곳</span>` : '';
      return `<div class="srcard${sat ? ' sat' : ''}" data-id="${esc(r.id)}" role="button" tabindex="0" aria-label="${i + 1}순위 ${esc(nm)}, ${kmTxt(r.dist_km)}, ${esc(bp.txt)}, ${pname} 맞춤 ${n}/${nSlot}${r.rich_lv ? `, 주변 풍부 ${esc(r.rich_lv)}` : ''}">
      <div class="srtop"><span class="srno">${i + 1}</span><b title="${esc(nm)}">${esc(nm)}</b>${sat ? '' : `<span class="srkm">${kmTxt(r.dist_km)}</span>`}</div>${sat ? `<div class="srsat" aria-hidden="true">${sat}<span class="srkm">${kmTxt(r.dist_km)}</span></div>` : ''}
      <div class="srmeta">${grp}${r.stay ? '<span class="badge">채비스테이</span>' : ''}${meta ? `<span>${esc(meta)}</span>` : ''}<span class="srbusy ${bp.lv == null ? 'na' : BUSY_CLS[bp.lv]}"><i></i>${esc(bp.txt)}${bp.note ? `<small>${bp.note}</small>` : ''}</span></div>
      ${why}</div>`; }).join('');
    const tie = allSame ? `<p class="srtie">${top.length}곳 모두 ${pname} 맞춤 점수가 같음${top.every(x => x.fit === top[0].fit && x.rich_lv === top[0].rich_lv) ? `(${slots(top[0].fit)}/${nSlot}${top[0].rich_lv ? '·풍부 ' + esc(top[0].rich_lv) : ''})` : ''} → 순서는 덜 붐빔·가까움으로 정함</p>` : '';
    const bm = T.busy_meta, bd = `${bm.first.slice(5, 10).replace('-', '/')}~${bm.last.slice(5, 10).replace('-', '/')}`;
    return `<div class="sreco" id="sreco"><div class="srhead"><h4>지금 충전하기 좋은 곳</h4><span class="srper" title="현재 페르소나(MY)">${pname} 맞춤</span></div><p class="srsub">${sub}</p>` +
      (cards ? `<div class="srstrip" role="list">${cards}</div>${tie}`
        : `<p class="srnote">반경 ${S.radius_km}km 안에 도보 자료가 있는 급속 충전소 없음${o.keep && pool.length ? '(위쪽 칩 조건)' : ''} (서울 충전소만 계산됨)</p>`) +
      (o.keep && top.length && top.length < S.top_n ? `<p class="srnote">조건에 맞는 충전소가 적어요 (${esc(o.keepLabel || '위쪽 칩')})</p>` : '') +
      `<p class="srnote">점수 = ${pname} 맞춤 ${S.weights.fit} + 덜 붐빔 ${S.weights.busy} + 가까움 ${S.weights.dist} (가정값) · 맞춤 = 칸 채움 0.5 + 주변 풍부도 0.5 (가정값) · 칸 채움 n/5 = 이 페르소나 추천 카드 5칸 중 도보 10분 안에서 바로 채운 칸 수 · 주변 N곳 = 이 페르소나 카드 업종(화장실·쓰레기통·공원 포함)에서 ${rk}분 안에 다녀올 수 있는 곳 수, 맑음·도보 10분 기준 · 풍부 상·중·하 = 업종별 서울 내 순위를 카드 비중으로 평균한 3등분(곳 수와 순서가 다를 수 있음) · 이용 기록 적은 ${T.stations.filter(x => x.lowuse).length}곳은 붐빔 ${S.lowuse_occ != null ? S.lowuse_occ : S.busy_neutral}(가정)로 계산 · 붐빔은 ${bd} 수집, 최신 기록 기준 평균이라 참고용 · 급속 충전소만(완속만 있는 곳 제외) · 같은 건물 층별 충전소는 한 장으로 묶음(대표 = 점수 높은 층) · 반경 안 후보 ${all.length}곳${grouped.length < all.length ? `(묶은 뒤 ${grouped.length})` : ''}${o.keep ? ` (칩 거르기 전 ${pool.length}곳)` : ''}</p></div>`;
  }
  function bind(el, onPick){
    el.querySelectorAll('.srcard').forEach(c => { const go = () => onPick(c.dataset.id);
      c.onclick = go; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } }; });
  }
  function load(url, after){
    if (P) return P;
    P = fetch(url || 'data/reco/station_reco.json').then(r => r.ok ? r.json() : null)
      .then(t => { T = t && t.stations && t.score ? t : null; if (after) after(T); return T; }).catch(() => null);
    return P;
  }
  /* '지금 충전소' 탭용 붐빔 문구(패널과 같은 기준, 11/22 점검 2). 표에 없는 충전소면 null.
     돌려줌 {text:'보통 한산(참고)' 등, none:자료 부족 여부, occ, flag, n, basis:'관측 N회·2일 이상' 등} */
  function busyOf(id, hour){
    if (!T) return null; const s = T.stations.find(x => x.id === id); if (!s) return null;
    const flag = s.busy_flag24[hour], o = s.occ24[hour], n = s.nobs24[hour], low = !!s.lowuse, none = low || neutralFlag(flag) || o == null;
    const basis = low ? '관측 시간 모두 이용률 0·충전 기록 적음(점수는 중간값)' : flag === 'ok' ? `관측 ${n}회·2일 이상` : flag === 'one_day' ? `관측 ${n}회·하루치` : flag === 'insufficient' ? `관측 ${n}회(${T.score.n_obs_min || 3}회 미만)` : '관측 없음';
    return {text:busyText(o, flag, low).replace(/^이 시간대 /, ''), none, low, occ:o, flag, n, basis};
  }
  let LOWSET = null;
  const isLow = id => { if (!T) return false; if (!LOWSET || LOWSET.t !== T) LOWSET = {t:T, s:new Set(T.stations.filter(x => x.lowuse).map(x => x.id))}; return LOWSET.s.has(id); };
  const api = {load, rank, panel, isLow, bind, havKm, reasonOf, busyOf, busyParts, groupFloors, floorSplit, floorLabel, remainKey:rm => T ? remainKey(rm) : null, setTable:t => { T = t; }, ready:() => !!T};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.STRECO = api;
})(typeof window !== 'undefined' ? window : this);
