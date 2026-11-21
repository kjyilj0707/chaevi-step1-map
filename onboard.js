/* 정보 입력(첫 실행) 화면 + 이 기기 안 페르소나 갱신 (2026-11-22, 준엽 승인 질문 초안)
   - 처음 열 때 지도 위에 전체 화면으로 4문항을 물음. 이후엔 오른쪽 버튼 메뉴의 '내 충전 습관 다시 입력'으로 다시 엶
   - 저장: localStorage 'chaeviProfile' = {persona_scores:{P1..P4b}, answers:{q1,q2,q3,q4,skipped}, updated_at}. 서버로 보내지 않음
   - 페르소나: Q2 답이 정함. Q2 답이 없으면 Q1으로 대신(휴게소→P1, 마트→P3, 집·회사→P4b, 번화가→P2), 둘 다 없거나 건너뛰면 P2
     시작 점수 = 정해진 페르소나 3점. 추천 카드를 누를 때마다 그 카드 대분류가 슬롯 틀(T.slots, build_reco.py가 reco_tables.json
     persona_slots에서 만듦)에 들어 있는 페르소나 n개에 +1/n. 다음 실행 때 가장 높은 페르소나가 기본 선택(점수는 화면에 안 보임)
   - Q3 → 추천 '남은 시간' 기본값(15/30/45/60), Q4 → 동승 조건(kid / pet / group, 혼자는 조건 없음). 추천 화면 조건 줄의 동승 칩으로 바꿈
   - index.html 쪽 연결: ONB.after(위치 요청) · ONB.init(RS, REMAINS, 다시 그리기) · ONB.conds() · ONB.chips() · ONB.bind() · ONB.card()
   - 저장소가 막혀 있으면(사생활 보호 창 등) 첫 화면만 매번 뜨고 지도는 그대로 씀 */
(function (g) {
  const KEY = 'chaeviProfile', IDS = ['P1', 'P2', 'P3', 'P4a', 'P4b'];
  const NAME = {P1:'휴게소형', P2:'외출·산책형', P3:'마트형', P4a:'차 안형', P4b:'대기형'};
  const DESC = {      // 결과 화면 한 줄(페르소나 카드 설명)
    P1:'충전하는 동안 근처 식당·간편식·화장실 등',
    P2:'충전하는 동안 근처 카페·산책 등',
    P3:'충전하는 동안 마트·편의점 장보기 등',
    P4a:'충전하는 동안 차 안에서 쉬기·영상 보기, 가까운 화장실·편의점 등',
    P4b:'충전이 끝날 때까지 잠깐 기다리기, 금방 다녀올 편의점·화장실 등'};
  const COMP = [['alone', '혼자'], ['kid', '가족·아이'], ['pet', '반려동물'], ['group', '친구·동료']];
  const Q = [
    {k:'q1', t:'주로 어디서 충전하세요?', o:[['hwy', '고속도로 휴게소'], ['home', '집·회사 근처'], ['mart', '마트·쇼핑몰'], ['town', '번화가·상가']]},
    {k:'q2', t:'충전하는 동안 보통 뭐 하세요?', o:[['P1', '밥·화장실 해결'], ['P2', '밖에 나가 카페·산책'], ['P3', '장보기'], ['P4a', '차 안에서 쉬거나 영상'], ['P4b', '잠깐 기다리기만']]},
    {k:'q3', t:'보통 얼마나 머무세요?', o:[[15, '15분 이하'], [30, '15~30분'], [45, '30~60분'], [60, '1시간 이상']]},
    {k:'q4', t:'주로 누구와 다니세요?', o:COMP.map(([v, n]) => [v, n === '가족·아이' ? '가족·아이와' : n === '반려동물' ? '반려동물과' : n === '친구·동료' ? '친구·동료와' : n])}];
  const Q1P = {hwy:'P1', mart:'P3', home:'P4b', town:'P2'};

  const load = () => { try { const p = JSON.parse(localStorage.getItem(KEY)); return p && p.persona_scores ? p : null; } catch (e) { return null; } };
  const save = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} };
  const startOf = a => (a && IDS.includes(a.q2) ? a.q2 : a && Q1P[a.q1]) || 'P2';
  function top(p){              // 가장 높은 점수. 같으면 처음 답한 페르소나 → P2 → P1·P3·P4a·P4b 순
    const s = p.persona_scores, st = startOf(p.answers), order = [st].concat(['P2', 'P1', 'P3', 'P4a', 'P4b'].filter(x => x !== st));
    let best = order[0];
    order.forEach(id => { if ((+s[id] || 0) > (+s[best] || 0) + 1e-9) best = id; });
    return best;
  }
  function makeProfile(a){
    const sc = {}; IDS.forEach(id => sc[id] = 0); sc[startOf(a)] = 3;
    return {persona_scores:sc, answers:a, updated_at:new Date().toISOString()};
  }

  let prof = load(), RS = null, REM = [15, 30, 45, 60], redraw = () => {}, comp = 'alone', open = false, queue = [];
  const need = () => !prof;

  /* ---------- 첫 실행 화면 ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  let el = null, step = 0, ans = {};
  function build(){
    if (el) return el;
    el = document.createElement('div'); el.id = 'onb'; el.className = 'onb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'onbT');
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'start'){ step = 1; draw(); }
      else if (act === 'skip') finish(true);
      else if (act === 'back'){ step = Math.max(0, step - 1); draw(); }
      else if (act === 'pass'){ ans[Q[step - 1].k] = null; step++; draw(); }
      else if (act === 'ans'){ const q = Q[step - 1], v = q.o[+b.dataset.i][0]; ans[q.k] = v; step++; draw(); }
      else if (act === 'done') finish(false);
      else if (act === 'redo'){ ans = {}; step = 1; draw(); }
    });
    return el;
  }
  function draw(){
    const n = Q.length, bar = step === 0 ? 0 : Math.min(step, n) / n * 100;
    let body = '';
    if (step === 0){
      body = `<div class="onb-hero"><img src="icon-192.png" alt="" width="56" height="56"><h2 id="onbT">충전 습관 4가지만 물어볼게요</h2>
        <p>답에 맞춰 충전하는 동안 다녀올 곳을 먼저 보여 드려요.</p>
        <ul class="onb-note"><li>이름·연락처는 받지 않아요</li><li>답은 이 기기에만 저장되고 서버로 보내지 않아요</li><li>나중에 오른쪽 <b>내 습관</b> 버튼에서 다시 고칠 수 있어요</li></ul></div>
        <div class="onb-foot"><button class="onb-go" type="button" data-act="start">시작하기</button><button class="onb-link" type="button" data-act="skip">건너뛰기</button></div>`;
    } else if (step <= n){
      const q = Q[step - 1], cur = ans[q.k];
      body = `<p class="onb-step">${step} / ${n}</p><h2 id="onbT">${esc(q.t)}</h2>
        <div class="onb-opts">${q.o.map(([v, t], i) => `<button type="button" class="onb-opt" data-act="ans" data-i="${i}" aria-pressed="${cur === v}">${esc(t)}</button>`).join('')}</div>
        <div class="onb-foot"><button class="onb-link" type="button" data-act="pass">잘 모르겠어요</button></div>`;
    } else {
      const a = Object.assign({}, ans), p = startOf(a), rm = REM.includes(a.q3) ? a.q3 : null, c = COMP.find(x => x[0] === a.q4);
      const tags = [rm ? `남은 시간 ${rm}분` : '', c ? `동승 ${c[1]}` : ''].filter(Boolean);
      body = `<div class="onb-hero"><p class="onb-step">결과</p><h2 id="onbT">당신은 <em>${NAME[p]}</em>에 가까워요</h2>
        <p class="onb-desc">${esc(DESC[p])}</p>
        ${tags.length ? `<p class="onb-tags">${tags.map(t => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
        <p class="onb-small">추천 화면의 첫 선택값으로 쓰이고, 그때그때 바꿀 수 있어요.</p></div>
        <div class="onb-foot"><button class="onb-go" type="button" data-act="done">지도로</button><button class="onb-link" type="button" data-act="redo">다시 답하기</button></div>`;
    }
    const head = `<div class="onb-top">${step > 0 ? '<button type="button" class="onb-back" data-act="back" aria-label="이전">‹</button>' : '<span></span>'}
      <div class="onb-bar"><i style="width:${bar}%"></i></div>
      ${step <= n ? '<button type="button" class="onb-skip" data-act="skip">건너뛰기</button>' : '<span></span>'}</div>`;
    build().innerHTML = `<div class="onb-in">${head}<div class="onb-body">${body}</div></div>`;
    const f = el.querySelector('.onb-go, .onb-opt'); if (f) try { f.focus({preventScroll:true}); } catch (e) {}
  }
  function show(){ ans = {}; step = 0; open = true; draw(); el.hidden = false; document.body.classList.add('onb-on'); }
  function finish(skipped){
    const a = skipped ? {q1:null, q2:null, q3:null, q4:null, skipped:true} : Object.assign({q1:null, q2:null, q3:null, q4:null, skipped:false}, ans);
    prof = makeProfile(a); save(prof); apply(true);
    if (el) el.hidden = true; open = false; document.body.classList.remove('onb-on');
    const q = queue; queue = []; q.forEach(f => { try { f(); } catch (e) {} });
    redraw();
  }

  /* 프로필 → 추천 화면 기본값. fresh = 방금 답함(남은 시간·동승도 답으로 맞춤) */
  function apply(fresh){
    if (!RS) return;
    if (!prof){ return; }
    RS.persona = top(prof); try { localStorage.setItem('recoP', RS.persona); } catch (e) {}
    const a = prof.answers || {};
    if (REM.includes(a.q3)){ RS.remain = a.q3; try { localStorage.setItem('recoR', RS.remain); } catch (e) {} }
    else if (fresh && a.skipped) RS.remain = 30;
    comp = COMP.some(x => x[0] === a.q4) ? a.q4 : 'alone';
  }

  /* ---------- 메뉴(오른쪽 버튼 줄 아래) ---------- */
  function menu(){
    const fabs = document.querySelector('.fabs'); if (!fabs || document.getElementById('onbFab')) return;
    const b = document.createElement('button'); b.className = 'fab'; b.id = 'onbFab'; b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', '내 충전 습관');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/></svg><span>내 습관</span>';
    fabs.appendChild(b);
    const m = document.createElement('div'); m.id = 'onbMenu'; m.className = 'onb-menu'; m.hidden = true;
    document.body.appendChild(m);
    const close = () => { m.hidden = true; b.setAttribute('aria-pressed', 'false'); };
    b.onclick = e => { e.stopPropagation();
      if (!m.hidden){ close(); return; }
      const lb = document.getElementById('legendbox'), lbb = document.getElementById('legendBtn');
      if (lb) lb.classList.remove('on'); if (lbb) lbb.setAttribute('aria-pressed', 'false');
      m.innerHTML = `<b>내 충전 습관</b><p>${prof ? `지금 기본 선택: ${NAME[top(prof)]}` : '아직 입력하지 않음'}<br><span>이 기기에만 저장됨</span></p>
        <button type="button" data-m="redo">내 충전 습관 다시 입력</button><button type="button" data-m="reset" class="ghost">내 페르소나 초기화</button>`;
      m.hidden = false; b.setAttribute('aria-pressed', 'true'); };
    m.onclick = e => { const x = e.target.closest('button'); if (!x) return; close();
      if (x.dataset.m === 'redo') show();
      else if (x.dataset.m === 'reset') reset(); };
    document.addEventListener('click', e => { if (!m.hidden && !m.contains(e.target) && e.target !== b) close(); });
  }
  function reset(){
    prof = null; try { localStorage.removeItem(KEY); localStorage.removeItem('recoP'); localStorage.removeItem('recoR'); } catch (e) {}
    if (RS){ RS.persona = 'P2'; RS.remain = 30; } comp = 'alone';
    redraw();
    if (typeof g.toast === 'function') g.toast('페르소나를 초기화함. 다음에 열 때 질문 화면이 다시 나옴');
  }

  /* ---------- index.html 에서 부르는 것 ---------- */
  const ONB = {};
  ONB.after = f => { if (need() || open) queue.push(f); else f(); };          // 첫 화면이 떠 있으면 닫힌 뒤에 실행(위치 권한 요청을 질문 화면 위에 띄우지 않음)
  ONB.init = (rs, remains, re) => {
    RS = rs; if (Array.isArray(remains)) REM = remains; if (typeof re === 'function') redraw = () => { try { re(); } catch (e) {} };
    apply(false); menu();
    if (need()) show();
  };
  ONB.conds = () => comp && comp !== 'alone' ? [comp] : [];
  ONB.chips = () => `<div class="rrow onb-comp" role="group" aria-label="동승"><span class="rlab">동승</span>${COMP.map(([v, n]) =>
    `<button class="rchip" type="button" data-onb-c="${v}" aria-pressed="${comp === v}">${n}</button>`).join('')}</div>`;
  ONB.bind = (root, again) => { root.querySelectorAll('[data-onb-c]').forEach(b => b.onclick = () => { comp = b.dataset.onbC; again(); }); };
  ONB.card = (big, T) => {      // 카드를 누름 → 그 대분류가 슬롯 틀에 든 페르소나들에 +1/n
    if (!prof || !big || !T || !T.slots) return;
    const hit = IDS.filter(id => (T.slots[id] || []).includes(big)); if (!hit.length) return;
    hit.forEach(id => prof.persona_scores[id] = (+prof.persona_scores[id] || 0) + 1 / hit.length);
    prof.updated_at = new Date().toISOString(); save(prof);
  };
  ONB.persona = () => prof ? top(prof) : null;      // 시험용
  g.ONB = ONB;
})(window);
