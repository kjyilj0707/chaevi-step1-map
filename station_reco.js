/* 충전소 추천(기본 지도 화면, MVP 3단계 v1, 2026-11-22)
   - 표 = data/reco/station_reco.json (분석 담당 score_reference_station.py 출력, 기준 README §2). 가중치·반경·문구 경계는 모두 이 JSON에서 읽음
     → 규칙을 바꿀 때는 JSON만 다시 만들면 됨(이 파일은 그대로)
   - 점수 = w.fit x fit + w.busy x (1 - 이용률[지금 시]) + w.dist x (1 - 직선거리 / 반경)
     붐빔 표시가 no_data·insufficient 이면 이용률 대신 busy_neutral(0.5), 문구 "붐빔 자료 부족"
   - 후보 = 반경 안 + walk_ok(도보 자료 있음). no_walk_policy = 'exclude'면 도보 자료 없는 충전소는 뺌, 'neutral'이면 fit 0.5
   - 순서 = 점수(소수 4자리) 큰 순 → 거리(km, 소수 2자리) 짧은 순 → id. 화면 = 상위 top_n곳
   - 남은 시간: 표에 있는 값(remains, 지금 30·45분) 중 가장 가까운 값으로 계산(15분 → 30분, 60분 → 45분)
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
  function busyText(o, flag){
    const R = T.reason;
    if (neutralFlag(flag) || o == null) return R.busy_none;
    for (const [lim, t] of R.busy_text) if (o < lim) return `이 시간대 ${t}(참고)`;
    return R.busy_none;
  }
  function reasonOf(filled, fit, o, flag, d){
    const R = T.reason, so = R.show_order;
    const names = filled.map(b => R.short_names[b] || b)
      .map((x, i) => [so.includes(x) ? so.indexOf(x) : 99, i, x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
    let amen;
    if (names.length){ const lst = names.slice(0, 3).join('·') + (names.length > 3 ? ' 등' : '');
      amen = `도보 10분 안에 ${lst}${josa(lst)} ` + (fit >= 1 ? '다 있어요' : '있어요'); }
    else amen = R.amen_none;
    return R.template.replace('{amen}', amen).replace('{busy}', busyText(o, flag)).replace('{dist}', d.toFixed(1) + 'km');
  }
  const remainKey = rm => { const rs = T.remains; let best = rs[0];
    rs.forEach(v => { if (Math.abs(v - rm) < Math.abs(best - rm)) best = v; }); return best; };
  /* lat·lng 기준 반경 안 후보 전체를 점수 순으로. 각 항목: id, name, kind, stay, dist_km, fit, occupancy, busy_flag, n_obs, score, reason */
  function rank(lat, lng, persona, remain, hour){
    if (!T) return [];
    const S = T.score, w = S.weights, R = S.radius_km, rk = String(remainKey(remain)), out = [];
    for (const s of T.stations){
      const d = havKm(lat, lng, s.lat, s.lng);
      if (d > R) continue;
      let f = s.walk_ok && s.fit && s.fit[persona] ? s.fit[persona][rk] : null;
      if (!f){ if (S.no_walk_policy === 'exclude') continue; f = {fit:0.5, filled:[]}; }
      const flag = s.busy_flag24[hour], o = s.occ24[hour], n = s.nobs24[hour];
      const useO = neutralFlag(flag) || o == null ? S.busy_neutral : o;
      const sc = w.fit * f.fit + w.busy * (1 - useO) + w.dist * (1 - d / R);
      out.push({id:s.id, name:s.name, kind:s.kind, stay:s.stay, dist_km:round(d, 2), fit:f.fit, occupancy:o, busy_flag:flag, n_obs:n,
        score:round(sc, 4), reason:f.filled.length || s.walk_ok ? reasonOf(f.filled, f.fit, o, flag, d) : `주변 정보 없음 · ${busyText(o, flag)} · ${d.toFixed(1)}km`});
    }
    out.sort((a, b) => b.score - a.score || a.dist_km - b.dist_km || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'})[c]);
  const kmTxt = d => d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km';
  /* 지도 화면 패널 HTML. o = {lat, lng, from:'me'|'center', persona, personaName, remain, hour} */
  function panel(o){
    if (!T) return P ? '' : '';
    const S = T.score, all = rank(o.lat, o.lng, o.persona, o.remain, o.hour), top = all.slice(0, S.top_n), rk = remainKey(o.remain);
    const sub = `${esc(o.personaName || o.persona)} · 남은 ${o.remain}분${rk !== o.remain ? `(${rk}분 표)` : ''} · ${o.hour}시 · ${o.from === 'me' ? '내 위치' : '지도 가운데'}에서 ${S.radius_km}km`;
    const cards = top.map((r, i) => `<div class="srcard" data-id="${esc(r.id)}" role="button" tabindex="0">
      <span class="srno">${i + 1}</span>
      <div class="srnm"><b>${esc(r.name)}</b><span class="srk">${r.stay ? '<span class="badge">채비스테이</span> ' : ''}${esc(r.kind)}${T.reason.template.includes('{dist}') ? '' : ' · ' + kmTxt(r.dist_km)}</span>
      <span class="srwhy">${esc(r.reason)}</span></div></div>`).join('');
    return `<div class="sreco" id="sreco"><h4>지금 충전하기 좋은 곳 <small>${sub}</small></h4>` +
      (cards || `<p class="srnote">반경 ${S.radius_km}km 안에 도보 자료가 있는 충전소 없음 (서울 충전소만 계산됨)</p>`) +
      `<p class="srnote">점수 = 주변 맞춤 ${S.weights.fit} + 덜 붐빔 ${S.weights.busy} + 가까움 ${S.weights.dist} (가정값) · 붐빔은 ${T.busy_meta.first.slice(5, 10).replace('-', '/')}~${T.busy_meta.last.slice(5, 10).replace('-', '/')} 수집 평균이라 참고용 · 반경 안 후보 ${all.length}곳</p></div>`;
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
  const api = {load, rank, panel, bind, havKm, reasonOf, setTable:t => { T = t; }, ready:() => !!T};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.STRECO = api;
})(typeof window !== 'undefined' ? window : this);
