/* MY(내 정보 입력·수정 폼) + 이 기기 안 페르소나 갱신 (2026-11-22 v2, 준엽 요청: 질문 진행형 → 항목별 폼)
   - 오른쪽 버튼 줄 'MY'를 누르면 폼이 열림. 첫 실행에도 같은 폼을 보여 주고 '나중에 입력'으로 닫을 수 있음
   - 저장: localStorage 'chaeviProfile' 하나 = {persona_scores:{P1..P4b}, answers:{q1,q2,q3,skipped}, basic:{...}, updated_at}. 서버로 보내지 않음
   - 충전 습관(페르소나 분류에 씀, 예전 질문 규칙 그대로)
     Q1 주로 충전하는 곳, Q2 충전하는 동안 하는 일 → 페르소나, Q3 보통 머무는 시간 → 남은 시간 기본값(15/30/45/60)
     페르소나 = Q2 답. 없으면 Q1으로 대신(휴게소→P1, 마트→P3, 집·회사→P4b, 번화가→P2), 둘 다 없으면 P2. 시작 점수 = 그 페르소나 3점
   - 페르소나 직접 바꾸기: 고른 페르소나 점수를 나머지 최고점 + 3으로 올림(카드 클릭 학습은 계속 쌓임)
   - 카드 클릭 학습: 추천 카드 대분류가 슬롯 틀(T.slots)에 든 페르소나 n개에 +1/n. 가장 높은 페르소나가 추천 기준
   - 기본 정보(나이대·성별·거주 구·차종·배터리 용량·충전 시간대·빈도)는 표시·저장만 함. 추천·페르소나 분류에 쓰지 않음.
     배터리 용량만 '지금 충전소' 탭 예상 시간 계산의 기본값으로 씀(비우거나 모름이면 70kWh 가정)
   - 동승자 기능은 뺌(팀 결정): ONB.conds() 빈 값, 예전 저장값 answers.q4 무시
   - index.html 쪽 연결: ONB.after · ONB.init(RS, REMAINS, 다시 그리기, {about}) · ONB.conds() · ONB.chips() · ONB.bind() · ONB.card() · ONB.battery() · ONB.open()
   - 저장소가 막혀 있으면(사생활 보호 창 등) 첫 화면만 매번 뜨고 지도는 그대로 씀 */
(function (g) {
  const KEY = 'chaeviProfile', IDS = ['P1', 'P2', 'P3', 'P4a', 'P4b'], BAT_DEF = 70;
  const NAME = {P1:'휴게소형', P2:'외출·산책형', P3:'마트형', P4a:'차 안형', P4b:'대기형'};
  const DESC = {
    P1:'충전하는 동안 근처 식당·간편식·화장실 등',
    P2:'충전하는 동안 근처 카페·산책 등',
    P3:'충전하는 동안 마트·편의점 장보기 등',
    P4a:'충전하는 동안 차 안에서 쉬기·영상 보기, 가까운 화장실·편의점 등',
    P4b:'충전이 끝날 때까지 잠깐 기다리기, 금방 다녀올 편의점·화장실 등'};
  const Q = [
    {k:'q1', t:'주로 충전하는 곳', o:[['hwy', '고속도로 휴게소'], ['home', '집·회사 근처'], ['mart', '마트·쇼핑몰'], ['town', '번화가·상가']]},
    {k:'q2', t:'충전하는 동안 보통 하는 일', o:[['P1', '밥·화장실 해결'], ['P2', '밖에 나가 카페·산책'], ['P3', '장보기'], ['P4a', '차 안에서 쉬거나 영상'], ['P4b', '잠깐 기다리기만']]},
    {k:'q3', t:'보통 머무는 시간', o:[[15, '15분 이하'], [30, '15~30분'], [45, '30~60분'], [60, '1시간 이상']]}];
  const Q1P = {hwy:'P1', mart:'P3', home:'P4b', town:'P2'};
  const GU = ['강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구', '도봉구', '동대문구', '동작구', '마포구',
    '서대문구', '서초구', '성동구', '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'];
  const B = [      // 기본 정보(추천에 안 씀)
    {k:'age', t:'나이대', o:[['u20', '20대 미만'], ['20', '20대'], ['30', '30대'], ['40', '40대'], ['50', '50대'], ['60', '60대 이상']]},
    {k:'gender', t:'성별', o:[['f', '여성'], ['m', '남성'], ['na', '밝히지 않음']]},
    {k:'band', t:'주로 충전하는 시간대', multi:true, o:[['am', '아침'], ['day', '낮'], ['pm', '저녁'], ['night', '심야']]},
    {k:'freq', t:'주 충전 빈도', o:[['lt1', '주 1회 미만'], ['1', '주 1회'], ['2_3', '주 2~3회'], ['4_6', '주 4~6회'], ['daily', '매일']]}];

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
    return {persona_scores:sc, answers:a, basic:{}, updated_at:new Date().toISOString()};
  }
  function boost(p, id){        // 직접 고른 페르소나를 맨 위로(나머지 최고점 + 3)
    const s = p.persona_scores, mx = Math.max(0, ...IDS.filter(x => x !== id).map(x => +s[x] || 0));
    s[id] = Math.round((mx + 3) * 1000) / 1000;
  }

  let prof = load(), RS = null, REM = [15, 30, 45, 60], redraw = () => {}, open = false, queue = [], about = () => '';
  const need = () => !prof;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));

  /* ---------- 폼 ---------- */
  let el = null, f = null, first = false, resetArm = false;      // f = 폼에서 고치는 중인 값(저장 전)
  function draft(){
    const a = (prof && prof.answers) || {}, b = (prof && prof.basic) || {};
    return {q1:a.q1 || null, q2:a.q2 || null, q3:a.q3 || null, pick:null,
      age:b.age || null, gender:b.gender || null, band:Array.isArray(b.band) ? b.band.slice() : [], freq:b.freq || null,
      gu:b.gu || '', car:b.car || '', bat:b.bat || '', batUnknown:!!b.batUnknown};
  }
  function preview(){           // 저장하면 될 페르소나와 그 까닭
    if (f.pick) return [f.pick, '직접 고름'];
    const a = prof && prof.answers;
    if (prof && a && a.q1 === f.q1 && a.q2 === f.q2) return [top(prof), prof.answers.skipped ? '기본값' : (top(prof) === startOf(a) ? '충전 습관 답 기준' : '추천 카드 선택으로 바뀜')];
    if (!f.q1 && !f.q2) return ['P2', '답이 없어 기본값'];
    return [startOf(f), f.q2 ? '충전하는 동안 하는 일 기준' : '주로 충전하는 곳 기준'];
  }
  const chipRow = (k, opts, multi, cur) => `<div class="my-opts" data-k="${k}"${multi ? ' data-multi="1"' : ''} role="group">${opts.map(([v, t]) =>
    `<button type="button" class="my-opt" data-v="${esc(v)}" aria-pressed="${multi ? cur.includes(v) : cur === v}">${esc(t)}</button>`).join('')}</div>`;
  function build(){
    if (el) return el;
    el = document.createElement('div'); el.id = 'onb'; el.className = 'onb'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'myT');
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const row = b.closest('.my-opts');
      if (row && b.classList.contains('my-opt')){
        const k = row.dataset.k, raw = b.dataset.v, v = k === 'q3' ? +raw : raw;
        if (row.dataset.multi){ const i = f[k].indexOf(v); if (i >= 0) f[k].splice(i, 1); else f[k].push(v); }
        else f[k] = f[k] === v ? null : v;
        if (k === 'q1' || k === 'q2') f.pick = null;      // 습관 답을 바꾸면 직접 고른 페르소나는 풂
        draw(); return;
      }
      const act = b.dataset.act;
      if (act === 'save') finish(true);
      else if (act === 'later') finish(false);
      else if (act === 'close') close();
      else if (act === 'reset'){ if (!resetArm){ resetArm = true; b.textContent = '한 번 더 누르면 초기화'; b.classList.add('arm'); } else reset(); }
    });
    el.addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'myGu') f.gu = t.value; else if (t.id === 'myCar') f.car = t.value.slice(0, 40);
      else if (t.id === 'myBat'){ f.bat = t.value; }
      else if (t.id === 'myBatU'){ f.batUnknown = t.checked; const i = el.querySelector('#myBat'); if (i) i.disabled = t.checked; }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && !first) close(); });
    return el;
  }
  function draw(){
    const keepY = el && el.querySelector('.onb-in') ? el.querySelector('.onb-in').scrollTop : 0;
    const [pp, why] = preview();
    const bat = f.bat === '' || f.bat == null ? '' : f.bat;
    const html = `<div class="onb-in my">
      <div class="my-top"><h2 id="myT">MY</h2>${first ? '<span></span>' : '<button type="button" class="my-x" data-act="close" aria-label="닫기">×</button>'}</div>
      <p class="my-lead">${first ? '충전 습관을 알려 주시면 충전하는 동안 다녀올 곳을 먼저 보여 드려요. ' : ''}이름·연락처는 받지 않고, 답은 이 기기에만 저장돼요(서버로 보내지 않음).</p>
      <section class="my-card my-persona">
        <p class="my-sub">현재 페르소나</p>
        <h3><em>${NAME[pp]}</em> <small>${esc(why)}</small></h3>
        <p class="my-desc">${esc(DESC[pp])}</p>
        <p class="my-lab">직접 바꾸기</p>
        <div class="my-opts" data-k="pick" role="group">${IDS.map(id => `<button type="button" class="my-opt" data-v="${id}" aria-pressed="${pp === id}">${NAME[id]}</button>`).join('')}</div>
        <p class="my-note">추천 카드를 누를 때마다 고른 곳 종류에 맞춰 조금씩 바뀌어요.</p>
      </section>
      <section class="my-card">
        <h4>충전 습관 <small>추천에 씀</small></h4>
        ${Q.map(q => `<p class="my-lab">${esc(q.t)}</p>${chipRow(q.k, q.o, false, f[q.k])}`).join('')}
        <p class="my-note">보통 머무는 시간은 충전 타이머를 켜지 않았을 때 추천의 '남은 시간' 기본값이 돼요.</p>
      </section>
      <section class="my-card">
        <h4>기본 정보</h4>
        <p class="my-note warn">기본 정보는 아직 추천에 쓰지 않아요(연결 방법 검토 중)</p>
        ${B.slice(0, 2).map(q => `<p class="my-lab">${esc(q.t)}</p>${chipRow(q.k, q.o, false, f[q.k])}`).join('')}
        <p class="my-lab"><label for="myGu">거주 지역(구)</label></p>
        <select id="myGu" class="my-in"><option value="">선택 안 함</option>${GU.concat(['서울 밖']).map(x => `<option${f.gu === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
        <p class="my-lab"><label for="myCar">차종</label></p>
        <input id="myCar" class="my-in" type="text" maxlength="40" placeholder="예: 아이오닉 5 (선택)" value="${esc(f.car)}" autocomplete="off">
        <p class="my-lab"><label for="myBat">배터리 용량(kWh)</label></p>
        <div class="my-bat"><input id="myBat" class="my-in" type="number" inputmode="decimal" min="10" max="200" step="0.1" placeholder="${BAT_DEF}" value="${esc(bat)}"${f.batUnknown ? ' disabled' : ''}>
          <label class="my-chk"><input id="myBatU" type="checkbox"${f.batUnknown ? ' checked' : ''}> 모름</label></div>
        <p class="my-note">비우거나 모름이면 ${BAT_DEF}kWh로 가정해 충전 예상 시간을 계산해요.</p>
        ${B.slice(2).map(q => `<p class="my-lab">${esc(q.t)}${q.multi ? ' <small>여러 개 고를 수 있음</small>' : ''}</p>${chipRow(q.k, q.o, !!q.multi, f[q.k])}`).join('')}
      </section>
      <div class="my-foot">
        <button class="onb-go" type="button" data-act="save">저장</button>
        ${first ? '<button class="onb-link" type="button" data-act="later">나중에 입력</button>'
          : `<button class="onb-link" type="button" data-act="reset">${prof ? '내 정보·페르소나 초기화' : '처음 상태로'}</button>`}
      </div>
      ${first ? '' : `<details class="my-about"><summary>이 지도에 대해</summary>${about()}</details>`}
    </div>`;
    build().innerHTML = html;
    const inn = el.querySelector('.onb-in'); if (inn) inn.scrollTop = keepY;
  }
  // 'pick' 줄은 위 click 처리에서 f.pick 으로 들어감(같은 걸 다시 누르면 풂)
  function show(isFirst){
    first = !!isFirst; f = draft(); resetArm = false; open = true; build(); draw(); el.hidden = false; document.body.classList.add('onb-on');
    const fab = document.getElementById('onbFab'); if (fab) fab.setAttribute('aria-pressed', 'true');
    const x = el.querySelector(first ? '.onb-go' : '.my-x'); if (x) try { x.focus({preventScroll:true}); } catch (e) {}
  }
  function close(){
    if (el) el.hidden = true; open = false; document.body.classList.remove('onb-on');
    const fab = document.getElementById('onbFab'); if (fab) fab.setAttribute('aria-pressed', 'false');
    const q = queue; queue = []; q.forEach(fn => { try { fn(); } catch (e) {} });
  }
  function basicOf(){
    const n = parseFloat(f.bat), bat = !f.batUnknown && n >= 10 && n <= 200 ? Math.round(n * 10) / 10 : '';
    return {age:f.age, gender:f.gender, gu:f.gu || '', car:(f.car || '').trim(), bat, batUnknown:!!f.batUnknown, band:f.band.slice(), freq:f.freq};
  }
  function finish(saveIt){
    if (saveIt){
      const a = {q1:f.q1, q2:f.q2, q3:f.q3, skipped:false};
      let p;
      if (!prof || !prof.answers || prof.answers.q1 !== a.q1 || prof.answers.q2 !== a.q2 || prof.answers.skipped) p = makeProfile(a);
      else p = Object.assign({}, prof, {answers:a, persona_scores:Object.assign({}, prof.persona_scores)});
      if (f.pick) boost(p, f.pick);
      p.basic = basicOf(); p.updated_at = new Date().toISOString();
      prof = p; save(prof); apply();
      if (typeof g.toast === 'function') g.toast(`저장함 · 현재 페르소나 ${NAME[top(prof)]}`);
    } else if (!prof){      // 첫 실행 '나중에 입력' = P2 기본값으로 저장(다음부터 폼이 자동으로 뜨지 않음, MY에서 언제든 입력)
      prof = makeProfile({q1:null, q2:null, q3:null, skipped:true}); save(prof); apply();
    }
    close(); redraw();
  }

  /* 프로필 → 추천 기준값: RS.persona(가장 높은 페르소나), RS.base(남은 시간 기본값, 타이머가 없을 때 씀) */
  function apply(){
    if (!RS) return;
    if (!prof){ RS.persona = 'P2'; RS.base = 30; return; }
    RS.persona = top(prof);
    const q3 = prof.answers && prof.answers.q3;
    RS.base = REM.includes(q3) ? q3 : 30;
  }

  /* ---------- 오른쪽 버튼 줄의 MY 버튼 ---------- */
  function fabBtn(){
    const fabs = document.querySelector('.fabs'); if (!fabs || document.getElementById('onbFab')) return;
    const b = document.createElement('button'); b.className = 'fab'; b.id = 'onbFab'; b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'MY 내 정보');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/></svg><span>MY</span>';
    fabs.appendChild(b);
    b.onclick = e => { e.stopPropagation();
      const lb = document.getElementById('legendbox'), lbb = document.getElementById('legendBtn');
      if (lb) lb.classList.remove('on'); if (lbb) lbb.setAttribute('aria-pressed', 'false');
      show(false); };
  }
  function reset(){
    prof = null; try { localStorage.removeItem(KEY); localStorage.removeItem('recoP'); localStorage.removeItem('recoR'); } catch (e) {}
    apply(); close(); redraw();
    if (typeof g.toast === 'function') g.toast('내 정보·페르소나를 초기화함. 다음에 열 때 MY 입력 화면이 다시 나옴');
  }
  // pick 줄 처리: 공통 click 처리기가 f.pick 에 값/해제를 넣음(k='pick')

  /* ---------- index.html 에서 부르는 것 ---------- */
  const ONB = {};
  ONB.after = fn => { if (need() || open) queue.push(fn); else fn(); };          // 첫 화면이 떠 있으면 닫힌 뒤에 실행(위치 권한 요청을 폼 위에 띄우지 않음)
  ONB.init = (rs, remains, re, opt) => {
    RS = rs; if (Array.isArray(remains)) REM = remains; if (typeof re === 'function') redraw = () => { try { re(); } catch (e) {} };
    if (opt && typeof opt.about === 'function') about = opt.about;
    apply(); fabBtn();
    if (need()) show(true);
  };
  ONB.conds = () => [];          // 동승 조건 없음(팀 결정)
  ONB.chips = () => '';
  ONB.bind = () => {};
  ONB.card = (big, T) => {      // 추천 카드·목록을 누름 → 그 대분류가 슬롯 틀에 든 페르소나들에 +1/n
    if (!prof || !big || !T || !T.slots) return;
    const hit = IDS.filter(id => (T.slots[id] || []).includes(big)); if (!hit.length) return;
    hit.forEach(id => prof.persona_scores[id] = (+prof.persona_scores[id] || 0) + 1 / hit.length);
    prof.updated_at = new Date().toISOString(); save(prof);
  };
  ONB.battery = () => { const b = prof && prof.basic; return b && !b.batUnknown && +b.bat > 0 ? +b.bat : null; };
  ONB.name = id => NAME[id] || id;
  ONB.open = () => show(false);
  ONB.persona = () => prof ? top(prof) : null;      // 시험용
  g.ONB = ONB;
})(window);
