/* '지금 충전소' 탭의 충전 시작·타이머 (2026-11-22, 준엽 요청)
   - 충전기 자료 = data/chargers_seoul.json (build_chargers.py, 환경공단 충전기 정보. chgerType 이름은 코드표)
   - 예상 시간(가정): 충전량 kWh = (목표 − 현재)% × 배터리 용량, 시간 = 충전량 ÷ (출력 kW × 효율 0.9)
     급속은 80%를 넘는 구간을 출력 절반으로 계산(가정). 배터리 용량 = MY 값, 없으면 70kWh 가정
   - [충전 시작] → 타이머(남은 시간 큰 글씨, 일시정지·종료). localStorage 'chaeviCharge'에 시작 시각·예상 종료를 저장 → 새로고침해도 이어짐
   - 남은 시간은 index.html이 '주변' 탭 추천의 남은 시간(15/30/45/60 중 남은 시간 이하인 가장 큰 값, 15분 미만이면 15분 표)과 지도 위 작은 배지에 씀
   - 서버로 보내는 것 없음. 저장소가 막히면 이 화면을 연 동안만 돎 */
(function (g) {
  const KEY = (typeof window !== 'undefined' && window.CHAEVI_MODE === 'demo') ? 'chaeviChargeDemo' : 'chaeviCharge',      /* 시연판 타이머는 따로 저장(11/23) */
    EFF = 0.9, TAPER_AT = 80, TAPER = 0.5, BAT_DEF = 70;
  let J = null, P = null, st = null, mem = null, setup = null, subs = [], doneSeen = false;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && v.end ? v : null; } catch (e) { return mem; } };
  const write = v => { mem = v; try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} };
  st = read();

  function load(url, after){
    if (P) return P;
    P = fetch(url || 'data/chargers_seoul.json').then(r => r.ok ? r.json() : null).then(j => { J = j && j.s ? j : null; if (after) after(J); return J; }).catch(() => null);
    return P;
  }
  const typeName = code => (J && J.meta.types[code]) || `코드 ${code}`;
  /* 충전소 → {chargers:[{id, type, typeName, kw, fast, use, pf, lim}], nFast, nSlow, maxKw, uses:[운영시간], pf:'Y'|'N'|'일부', lim:'Y'|'N'|'일부'} */
  function info(sid){
    if (!J || !J.s[sid]) return null;
    const cs = J.s[sid].map(c => ({id:c[0], type:c[1], typeName:typeName(c[1]), kw:+c[2], fast:!!c[3], use:J.meta.use[c[4]] || '', pf:c[5], lim:c[6]}));
    const all = (k, v) => cs.every(c => c[k] === v), any = (k, v) => cs.some(c => c[k] === v);
    return {chargers:cs, nFast:cs.filter(c => c.fast).length, nSlow:cs.filter(c => !c.fast).length, maxKw:Math.max(...cs.map(c => c.kw)),
      uses:[...new Set(cs.map(c => c.use).filter(Boolean))], pf:all('pf', 'Y') ? 'Y' : any('pf', 'Y') ? '일부' : 'N', lim:all('lim', 'Y') ? 'Y' : any('lim', 'Y') ? '일부' : 'N'};
  }
  /* 예상 분: 급속이면 80% 넘는 구간 출력 절반(가정) */
  function estimate(kw, fast, from, to, cap){
    if (!(kw > 0) || !(to > from)) return 0;
    const lo = fast ? Math.max(0, Math.min(to, TAPER_AT) - from) : to - from, hi = fast ? Math.max(0, to - Math.max(from, TAPER_AT)) : 0;
    const h = lo / 100 * cap / (kw * EFF) + hi / 100 * cap / (kw * TAPER * EFF);
    return h * 60;
  }
  const left = () => !st ? null : st.paused != null ? st.paused : st.end - Date.now();
  const active = () => !!st && left() > 0;
  const leftMin = () => active() ? left() / 60000 : null;
  const clock = ms => { const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0'); };
  const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  /* 분을 먼저 반올림한 뒤 시간·분으로 나눔(119.7분 → 2시간, 예전에는 '1시간 60분'), 11/22 점검 7 */
  const minTxt = m => { const r = Math.max(1, Math.round(m)); return r >= 60 ? `${Math.floor(r / 60)}시간` + (r % 60 ? ` ${r % 60}분` : '') : `${r}분`; };
  const emit = why => subs.forEach(f => { try { f(why, st); } catch (e) {} });

  function start(o){
    const ms = Math.max(60e3, Math.round(o.min * 60e3));
    st = {sid:o.sid, name:o.name, cid:o.cid, type:o.type, kw:o.kw, fast:o.fast, from:o.from, to:o.to, cap:o.cap, capAssumed:!!o.capAssumed,
      min:o.min, start:Date.now(), end:Date.now() + ms, total:ms, paused:null};
    doneSeen = false; write(st); emit('start');
  }
  function pause(){ if (!st || st.paused != null) return; st.paused = Math.max(0, st.end - Date.now()); write(st); emit('pause'); }
  function resume(){ if (!st || st.paused == null) return; st.end = Date.now() + st.paused; st.paused = null; write(st); emit('resume'); }
  function stop(){ st = null; write(null); emit('stop'); }
  setInterval(() => {
    if (!st) return;
    const l = left();
    paintTimer();
    if (l <= 0 && !doneSeen){ doneSeen = true; emit('done'); }
    else emit('tick');
  }, 1000);
  if (st && left() <= 0) doneSeen = true;      // 이미 끝난 타이머를 다시 열었을 때는 완료 알림을 또 띄우지 않음

  /* ---------- 화면 ---------- */
  function paintTimer(){
    const b = document.getElementById('tmrBig'); if (!b || !st) return;
    const l = left(); b.textContent = clock(l);
    const f = document.getElementById('tmrFill'); if (f) f.style.width = Math.max(0, Math.min(100, (1 - l / st.total) * 100)) + '%';
    if (l <= 0 && !document.getElementById('tmrDone')){ const box = document.getElementById('chgBox'); if (box && box._redraw) box._redraw(); }
  }
  function timerHTML(here){
    const l = left(), done = l <= 0, paused = st.paused != null;
    const what = `#${esc(st.cid)} ${esc(typeName(st.type))} ${st.kw}kW · ${st.from}→${st.to}% · ${st.cap}kWh${st.capAssumed ? '(가정)' : ''}`;
    if (!here) return `<div class="tmr other"><p class="tmr-l">다른 충전소에서 충전 중: <b>${esc(st.name)}</b></p>
      <p class="tmr-s">${done ? '예상 시간이 끝났어요' : `남은 ${minTxt(l / 60000)} · 예상 종료 ${hm(st.end)}`}</p>
      <div class="tmr-acts"><button type="button" class="act ghost" data-c="goto">그 충전소 보기</button>${done ? '<button type="button" class="act ghost" data-c="stop">타이머 닫기</button>' : ''}</div></div>`;
    if (done) return `<div class="tmr" id="tmrDone"><p class="tmr-l">${what}</p><b class="tmr-big">충전 완료 예상</b>
      <p class="tmr-s">예상 시간(${minTxt(st.min)})이 지났어요 · 실제 충전량은 차에서 확인</p>
      <div class="tmr-acts"><button type="button" class="act" data-c="stop">타이머 닫기</button></div></div>`;
    return `<div class="tmr"><p class="tmr-l">${paused ? '일시정지 · ' : '충전 중 · '}${what}</p>
      <b class="tmr-big" id="tmrBig" aria-live="off">${clock(l)}</b>
      <div class="tmr-bar"><i id="tmrFill" style="width:${Math.max(0, Math.min(100, (1 - l / st.total) * 100))}%"></i></div>
      <p class="tmr-s">${paused ? '다시 누르면 남은 시간부터 이어서 셈' : `예상 종료 ${hm(st.end)}`} · 예상 ${minTxt(st.min)}(예상·가정)</p>
      <div class="tmr-acts"><button type="button" class="act" data-c="${paused ? 'resume' : 'pause'}">${paused ? '계속' : '일시정지'}</button><button type="button" class="act ghost" data-c="stop">종료</button></div>
      <p class="tmr-n">남은 시간은 '주변' 탭 추천의 남은 시간에 자동으로 들어가요(15·30·45·60분 중 남은 시간 이하인 가장 큰 값, 15분 미만이면 15분 표).</p></div>`;
  }
  function setupHTML(s, I, battery){
    if (!setup || setup.sid !== s.id){
      const first = I.chargers.find(c => c.lim !== 'Y') || I.chargers[0];
      setup = {sid:s.id, cid:first ? first.id : null, from:20, to:80, cap:battery || BAT_DEF, capAssumed:!battery, capSrc:battery ? 'my' : 'def'};
    } else if (setup.capSrc !== 'typed'){      // 직접 넣지 않았으면 그릴 때마다 MY 값을 다시 읽음(MY 배터리를 바꾼 뒤 같은 충전소, 11/22 점검 8)
      setup.cap = battery || BAT_DEF; setup.capAssumed = !battery; setup.capSrc = battery ? 'my' : 'def';
    }
    const c = I.chargers.find(x => x.id === setup.cid) || I.chargers[0];
    const btns = I.chargers.map(x => `<button type="button" class="cbtn" data-cid="${esc(x.id)}" aria-pressed="${c && x.id === c.id}">
      <b>${x.kw}kW</b><span>${x.fast ? '급속' : '완속'} · ${esc(x.typeName)}</span><small>#${esc(x.id)}${x.lim === 'Y' ? ' · 이용 제한' : ''}</small></button>`).join('');
    return `<h4>충전 시작</h4>
      <p class="clab">충전기 선택 <small>${I.chargers.length}기</small></p>
      <div class="cgrid" role="group" aria-label="충전기">${btns}</div>
      <div class="crow"><label for="cFrom">현재</label><input id="cFrom" type="range" min="0" max="95" step="5" value="${setup.from}"><b id="cFromV">${setup.from}%</b></div>
      <div class="crow"><label for="cTo">목표</label><input id="cTo" type="range" min="10" max="100" step="5" value="${setup.to}"><b id="cToV">${setup.to}%</b></div>
      <div class="crow"><label for="cCap">배터리</label><input id="cCap" type="number" inputmode="decimal" min="10" max="200" step="0.1" value="${setup.cap}"><span class="cu">kWh <em id="cCapSrc"${setup.capSrc === 'my' ? ' class="my"' : ''}>${capLab()}</em></span></div>
      <div class="cest"><span>예상 시간</span><b id="cEst"></b></div>
      <p class="cnote" id="cNote"></p>
      <button type="button" class="act cgo" data-c="start">충전 시작</button>`;
  }
  const capLab = () => setup.capSrc === 'typed' ? '직접' : setup.capAssumed ? '가정' : 'MY';
  function estText(c){
    const m = estimate(c.kw, c.fast, setup.from, setup.to, setup.cap);
    return [m, setup.to <= setup.from ? '목표가 현재보다 높아야 해요' : minTxt(m)];
  }
  function paintEst(I){
    const c = I.chargers.find(x => x.id === setup.cid) || I.chargers[0], e = document.getElementById('cEst'), n = document.getElementById('cNote'); if (!e || !c) return;
    const [m, t] = estText(c); e.textContent = t;
    n.textContent = `예상·가정: (목표−현재)% × ${setup.cap}kWh${setup.capSrc === 'typed' ? '(직접 입력)' : setup.capAssumed ? '(MY 값 없어 가정)' : ''} ÷ (${c.kw}kW × 효율 ${EFF})` + (c.fast && setup.to > TAPER_AT ? ` · 급속은 ${TAPER_AT}% 넘는 구간 출력 절반` : '') + ' · 차·온도·충전기 상태에 따라 다름';
    const go = document.querySelector('#chgBox [data-c=start]'); if (go) go.disabled = !(m > 0);
  }
  /* box(#chgBox)에 그림. s = {id, name}, ctx = {battery, onGoto(sid)} */
  function render(box, s, ctx){
    if (!box) return;
    box._redraw = () => render(box, s, ctx);
    const I = info(s.id);
    if (!J) { box.innerHTML = '<p class="hint">충전기 정보를 불러오는 중…</p>'; load().then(() => render(box, s, ctx)); return; }
    const here = st && st.sid === s.id;
    let html = '';
    if (st) html += timerHTML(here);
    if (!I) html += '<p class="hint">이 충전소의 충전기 정보가 없어요(서울 충전소만 있음)</p>';
    else if (!here) html += (st && !here ? '<p class="cnote">새로 시작하면 지금 타이머를 바꿔요.</p>' : '') + setupHTML(s, I, ctx.battery);
    box.innerHTML = html;
    if (I && !here) paintEst(I);
    box.querySelectorAll('.cbtn').forEach(b => b.onclick = () => { setup.cid = b.dataset.cid; box.querySelectorAll('.cbtn').forEach(x => x.setAttribute('aria-pressed', x === b)); paintEst(I); });
    const rng = (id, k, v) => { const el = box.querySelector('#' + id); if (el) el.oninput = () => { setup[k] = +el.value;
      if (k === 'from' && setup.to <= setup.from){ setup.to = Math.min(100, setup.from + 5); const t = box.querySelector('#cTo'); if (t){ t.value = setup.to; box.querySelector('#cToV').textContent = setup.to + '%'; } }
      box.querySelector('#' + v).textContent = setup[k] + '%'; paintEst(I); }; };
    rng('cFrom', 'from', 'cFromV'); rng('cTo', 'to', 'cToV');
    const cap = box.querySelector('#cCap'); if (cap) cap.oninput = () => { const n = parseFloat(cap.value); if (n >= 10 && n <= 200){ setup.cap = Math.round(n * 10) / 10; setup.capAssumed = false; setup.capSrc = 'typed';
      const lb = box.querySelector('#cCapSrc'); if (lb){ lb.textContent = capLab(); lb.className = ''; } paintEst(I); } };
    box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
      const c = b.dataset.c;
      if (c === 'start'){ const x = I.chargers.find(y => y.id === setup.cid) || I.chargers[0], [m] = estText(x); if (!(m > 0)) return;
        start({sid:s.id, name:s.name, cid:x.id, type:x.type, kw:x.kw, fast:x.fast, from:setup.from, to:setup.to, cap:setup.cap, capAssumed:setup.capAssumed, min:m}); }
      else if (c === 'pause') pause(); else if (c === 'resume') resume(); else if (c === 'stop') stop();
      else if (c === 'goto'){ if (ctx.onGoto && st) ctx.onGoto(st.sid); return; }
      render(box, s, ctx);
    });
  }
  const api = {load, info, typeName, estimate, start, pause, resume, stop, render, left, leftMin, active, state:() => st, clock, minTxt,
    on:f => subs.push(f), EFF, TAPER_AT, TAPER, BAT_DEF};
  g.CHG = api;
})(window);
