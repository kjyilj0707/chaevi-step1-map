/* MY(내 정보 입력·수정 폼) + 이 기기 안 페르소나 갱신 (2026-11-22 v2, 준엽 요청: 질문 진행형 → 항목별 폼 / v3: 기본 정보 → 페르소나 시작 점수)
   - 오른쪽 버튼 줄 'MY'를 누르면 폼이 열림. 첫 실행에도 같은 폼을 보여 주고 '나중에 입력'으로 닫을 수 있음
   - 저장: localStorage 'chaeviProfile' 하나 = {start:{P1..P4b}, learn:{P1..P4b}, persona_scores(= start + learn), start_v, answers:{q1,q2,q3,skipped}, basic:{...}, updated_at}. 서버로 보내지 않음
   - 시작 점수(11/22 준엽 결정 '기본 정보는 페르소나 시작 점수로만, Q2 유지', 기준 analysis/demo_persona_link build_prior.py score(), 표 data/reco/prior_v1.json)
     π = normalize(base × 근거 factor(시간대·충전 방식·차종 군) × clip(나이 factor × 성별 factor, 0.8~1.3))
     start_p = 3·[p = Q2 답] + 1.5·[Q2 없음 이고 p = Q1으로 정한 페르소나] + 1.0·π_p   (Q1 1.5점 = 총괄 결정, JSON의 q1_fallback_points 0은 안 씀)
     Q1 대응: 휴게소→P1, 마트→P3, 집·회사→P4b, 번화가→P2. 표에 없는 선택지(10대·밝히지 않음·그 외·모름 등)는 1.0(중립). 표를 못 읽으면 π 없이(예전 규칙: 3점·대체 3점)
   - learn: 카드 클릭 +1/n(슬롯 틀 T.slots에 그 대분류가 든 페르소나 n개), 직접 바꾸기 = 고른 페르소나 합계를 나머지 최고 + 3으로. Q1·Q2 답이 바뀌면 learn을 비움
   - Q3 보통 머무는 시간 → 남은 시간 기본값(15/30/45/60). 배터리 용량 → '지금 충전소' 예상 시간 기본값(비우거나 모름이면 70kWh 가정)
   - 거주 구·충전 빈도는 저장만(추천·점수에 안 씀)
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
  /* 기본 정보 선택지 값 = prior_v1.json factors 키(시간대 time, 충전 방식 speed, 차종 군 car, 나이 age, 성별 gender). 표에 없는 값은 중립 */
  const B = [
    {k:'age', t:'나이대', o:[['u20', '20대 미만'], ['20s', '20대'], ['30s', '30대'], ['40s', '40대'], ['50s', '50대'], ['60p', '60대 이상']]},
    {k:'gender', t:'성별', o:[['female', '여성'], ['male', '남성'], ['na', '밝히지 않음']]},
    {k:'car', t:'차종', o:[['egmp', '현대·기아 E-GMP'], ['tesla', '테슬라'], ['small_old', '소형·구형'], ['other', '그 외·모름']]},
    {k:'speed', t:'주로 쓰는 충전기', o:[['fast', '급속'], ['slow', '완속'], ['unknown', '모름']]},
    {k:'time', t:'주로 충전하는 시간대', o:[['morning', '아침'], ['lunch', '점심'], ['afternoon', '오후'], ['evening', '저녁'], ['night', '밤·새벽']]},
    {k:'freq', t:'주 충전 빈도', o:[['lt1', '주 1회 미만'], ['1', '주 1회'], ['2_3', '주 2~3회'], ['4_6', '주 4~6회'], ['daily', '매일']]}];
  const LAB = {}; B.forEach(q => q.o.forEach(([v, t]) => LAB[q.k + ':' + v] = t));
  const Q1_PTS = 1.5;

  const load = () => { try { const p = JSON.parse(localStorage.getItem(KEY)); return p && p.persona_scores ? upgrade(p) : null; } catch (e) { return null; } };
  const save = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} };
  let PJ = null;      // prior_v1.json
  /* 파이썬 round(x, 3)과 같은 반올림(정확히 가운데면 짝수 쪽, station_reco.js와 같은 방식) */
  const rd = x => { const t = Math.abs(x).toFixed(60), rest = t.slice(t.indexOf('.') + 4);
    if (/^50*$/.test(rest)){ const lo = Math.floor(Math.abs(x) * 1000), v = (lo % 2 ? lo + 1 : lo) / 1000; return x < 0 ? -v : v; }
    return Number(x.toFixed(3)); };
  /* build_prior.py score()와 같은 식. b = {time, speed, car, age, gender}. 돌려줌 {pi:{P:값}, why:[[입력 이름, {P:배수}, 약한 가정?]]} */
  function prior(J, b){
    b = b || {}; const fx = J.factors, v = Object.assign({}, J.base), why = [], d = {};
    IDS.forEach(p => d[p] = 1.0);
    [['time', b.time], ['speed', b.speed], ['car', b.car]].forEach(([grp, key]) => { const e = key && fx[grp][key]; if (!e) return;
      IDS.forEach(p => v[p] *= e.factor[p]); why.push([LAB[grp + ':' + key] || key, e.factor, false]); });
    [['age', b.age], ['gender', b.gender]].forEach(([grp, key]) => { const e = key && fx[grp][key]; if (!e) return;
      IDS.forEach(p => d[p] *= e.factor[p]); why.push([LAB[grp + ':' + key] || key, e.factor, true]); });
    const [lo, hi] = J.rules.demo_clip || [0.8, 1.3];
    IDS.forEach(p => v[p] *= Math.min(hi, Math.max(lo, d[p])));
    const sum = IDS.reduce((a, p) => a + v[p], 0), pi = {};
    IDS.forEach(p => pi[p] = v[p] / sum);
    return {pi, why};
  }
  /* 시작 점수. J 없으면 예전 규칙(Q2 3점, 없으면 Q1 대신 3점, 둘 다 없으면 P2 3점) */
  function startScores(a, b, J){
    a = a || {}; const sc = {}, q2 = IDS.includes(a.q2) ? a.q2 : null, q1p = !q2 ? Q1P[a.q1] || null : null;
    if (!J){ IDS.forEach(p => sc[p] = 0); sc[q2 || q1p || 'P2'] = 3; return sc; }
    const w2 = +J.rules.w_q2 || 3, lam = J.rules.lambda != null ? +J.rules.lambda : 1, pi = prior(J, b).pi;
    IDS.forEach(p => sc[p] = rd(lam * pi[p] + (p === q2 ? w2 : 0) + (p === q1p ? Q1_PTS : 0)));
    return sc;
  }
  const argmax = s => IDS.reduce((best, p) => (+s[p] || 0) > (+s[best] || 0) + 1e-9 ? p : best, IDS[0]);      // 같으면 IDS 앞쪽(파이썬 max와 같음)
  const startOf = p => argmax(p.start || p.persona_scores);
  function sumUp(p){ IDS.forEach(id => p.persona_scores[id] = rd((+p.start[id] || 0) + (+p.learn[id] || 0))); return p; }
  function top(p){              // 합계 최고. 같으면 시작 점수 1위 → P2 → P1·P3·P4a·P4b 순
    const s = p.persona_scores, st = startOf(p), order = [st].concat(['P2', 'P1', 'P3', 'P4a', 'P4b'].filter(x => x !== st));
    let best = order[0];
    order.forEach(id => { if ((+s[id] || 0) > (+s[best] || 0) + 1e-9) best = id; });
    return best;
  }
  const zeros = () => { const o = {}; IDS.forEach(id => o[id] = 0); return o; };
  function makeProfile(a, b, learn){
    const p = {start:startScores(a, b, PJ), learn:learn || zeros(), persona_scores:{}, start_v:PJ ? PJ.version : 'none', answers:a, basic:b || {}, updated_at:new Date().toISOString()};
    return sumUp(p);
  }
  function upgrade(p){          // 예전 저장값(start 없음) → 그 점수를 start로 / prior 표가 늦게 오면 start만 다시 계산(learn 유지)
    if (!p) return p;
    if (!p.start){ p.start = Object.assign(zeros(), p.persona_scores); p.learn = zeros(); p.start_v = 'old'; }
    if (!p.learn) p.learn = zeros();
    if (PJ && p.start_v !== PJ.version){ p.start = startScores(p.answers, p.basic, PJ); p.start_v = PJ.version; }
    return sumUp(p);
  }
  function boost(p, id){        // 직접 고른 페르소나를 맨 위로(합계가 나머지 최고 + 3)
    sumUp(p); const s = p.persona_scores, mx = Math.max(0, ...IDS.filter(x => x !== id).map(x => +s[x] || 0));
    p.learn[id] = rd((+p.learn[id] || 0) + (mx + 3 - (+s[id] || 0))); sumUp(p);
  }

  let prof = load(), RS = null, REM = [15, 30, 45, 60], redraw = () => {}, open = false, queue = [], about = () => '';
  const need = () => !prof;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));

  /* ---------- 폼 ---------- */
  let el = null, f = null, first = false, resetArm = false;      // f = 폼에서 고치는 중인 값(저장 전)
  function draft(){
    const a = (prof && prof.answers) || {}, b = (prof && prof.basic) || {};
    return {q1:a.q1 || null, q2:a.q2 || null, q3:a.q3 || null, pick:null,
      age:b.age || null, gender:b.gender || null, car:B[2].o.some(o => o[0] === b.car) ? b.car : null, speed:b.speed || null, time:b.time || null, freq:b.freq || null,
      gu:b.gu || '', bat:b.bat || '', batUnknown:!!b.batUnknown};
  }
  /* 저장하면 될 프로필(폼 값으로 미리 계산): 시작 점수 + (Q1·Q2가 그대로면 지금까지의 learn) + 직접 고름 */
  function trial(){
    const a = {q1:f.q1, q2:f.q2, q3:f.q3, skipped:false}, keep = prof && prof.answers && !prof.answers.skipped && prof.answers.q1 === a.q1 && prof.answers.q2 === a.q2;
    const p = makeProfile(a, basicOf(), keep ? Object.assign(zeros(), prof.learn) : null);
    if (f.pick) boost(p, f.pick);
    return p;
  }
  function preview(){           // 저장하면 될 페르소나와 그 까닭
    const p = trial(), t = top(p);
    if (f.pick) return [t, '직접 고름', p];
    if (IDS.some(id => (+p.learn[id] || 0) > 0) && t !== startOf(p)) return [t, '추천 카드 선택으로 바뀜', p];
    return [t, f.q2 ? '충전하는 동안 하는 일 기준' : f.q1 ? '주로 충전하는 곳 기준' : PJ && hasBasic() ? '기본 정보 시작값 기준' : '기본값', p];
  }
  const hasBasic = () => ['time', 'speed', 'car', 'age', 'gender'].some(k => f[k]);
  /* '시작값 근거' 한 줄: 지금 페르소나를 올리고 내린 기본 정보 입력(배수) + 시작 점수 */
  function whyHTML(pp, p){
    if (!PJ) return '<p class="my-note">시작값 표를 불러오지 못해 기본 정보는 쓰지 않음</p>';
    const pr = prior(PJ, basicOf()), up = [], dn = [];
    pr.why.forEach(([lab, fac, weak]) => { const x = fac[pp]; if (x > 1.0005) up.push(`${esc(lab)} ×${x}${weak ? '*' : ''}`); else if (x < 0.9995) dn.push(`${esc(lab)} ×${x}${weak ? '*' : ''}`); });
    const pts = IDS.map(id => `${NAME[id]} ${(+p.start[id]).toFixed(2)}`).join(' · ');
    const q = f.q2 ? `충전하는 동안 하는 일 +${PJ.rules.w_q2}점` : f.q1 && Q1P[f.q1] ? `주로 충전하는 곳 → ${NAME[Q1P[f.q1]]} +${Q1_PTS}점` : '';
    return `<details class="my-why"><summary>시작값 근거</summary>
      <p>${NAME[pp]}을 올린 입력: ${up.length ? up.join(', ') : '없음'}${dn.length ? ` · 내린 입력: ${dn.join(', ')}` : ''}${q ? ` · ${q}` : ''}</p>
      <p>시작 점수: ${pts}${IDS.some(id => +p.learn[id] > 0) ? ` · 카드 선택 더한 값: ${IDS.map(id => `${NAME[id]} ${(+p.persona_scores[id]).toFixed(2)}`).join(' · ')}` : ''}</p>
      <p class="my-note">시작값 = VOC 페르소나 비율 × 시간대·충전 방식·차종 배수 × 나이·성별 배수(*약한 가정, 전체 인구 자료), 합 1로 맞춤. 표에 없는 선택은 중립</p></details>`;
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
      if (t.id === 'myGu') f.gu = t.value;
      else if (t.id === 'myBat'){ f.bat = t.value; }
      else if (t.id === 'myBatU'){ f.batUnknown = t.checked; const i = el.querySelector('#myBat'); if (i) i.disabled = t.checked; }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && !first) close(); });
    return el;
  }
  function draw(){
    const keepY = el && el.querySelector('.onb-in') ? el.querySelector('.onb-in').scrollTop : 0;
    const [pp, why, tp] = preview();
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
        ${whyHTML(pp, tp)}
      </section>
      <section class="my-card">
        <h4>충전 습관 <small>추천에 씀</small></h4>
        ${Q.map(q => `<p class="my-lab">${esc(q.t)}</p>${chipRow(q.k, q.o, false, f[q.k])}`).join('')}
        <p class="my-note">보통 머무는 시간은 충전 타이머를 켜지 않았을 때 추천의 '남은 시간' 기본값이 돼요.</p>
      </section>
      <section class="my-card">
        <h4>기본 정보</h4>
        <p class="my-note warn">기본 정보는 맞춤 시작값으로만 쓰여요(약한 가정 포함)</p>
        ${B.slice(0, 2).map(q => `<p class="my-lab">${esc(q.t)}</p>${chipRow(q.k, q.o, false, f[q.k])}`).join('')}
        <p class="my-lab"><label for="myGu">거주 지역(구)</label></p>
        <select id="myGu" class="my-in"><option value="">선택 안 함</option>${GU.concat(['서울 밖']).map(x => `<option${f.gu === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
        ${B.slice(2, 4).map(q => `<p class="my-lab">${esc(q.t)}</p>${chipRow(q.k, q.o, false, f[q.k])}`).join('')}
        <p class="my-lab"><label for="myBat">배터리 용량(kWh)</label></p>
        <div class="my-bat"><input id="myBat" class="my-in" type="number" inputmode="decimal" min="10" max="200" step="0.1" placeholder="${BAT_DEF}" value="${esc(bat)}"${f.batUnknown ? ' disabled' : ''}>
          <label class="my-chk"><input id="myBatU" type="checkbox"${f.batUnknown ? ' checked' : ''}> 모름</label></div>
        <p class="my-note">비우거나 모름이면 ${BAT_DEF}kWh로 가정해 충전 예상 시간을 계산해요.</p>
        ${B.slice(4).map(q => `<p class="my-lab">${esc(q.t)}${q.multi ? ' <small>여러 개 고를 수 있음</small>' : ''}</p>${chipRow(q.k, q.o, !!q.multi, f[q.k])}`).join('')}
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
    return {age:f.age, gender:f.gender, gu:f.gu || '', car:f.car, speed:f.speed, time:f.time, bat, batUnknown:!!f.batUnknown, freq:f.freq};
  }
  function finish(saveIt){
    if (saveIt){
      prof = trial(); prof.updated_at = new Date().toISOString(); save(prof); apply();
      if (typeof g.toast === 'function') g.toast(`저장함 · 현재 페르소나 ${NAME[top(prof)]}`);
    } else if (!prof){      // 첫 실행 '나중에 입력' = P2 기본값으로 저장(다음부터 폼이 자동으로 뜨지 않음, MY에서 언제든 입력)
      prof = makeProfile({q1:null, q2:null, q3:null, skipped:true}, {}); save(prof); apply();
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
    /* 시작값 표(prior_v1.json): 오면 저장된 프로필의 시작 점수를 다시 계산(learn 유지)하고, 폼이 열려 있으면 다시 그림. 못 읽으면 예전 규칙 */
    fetch(opt && opt.prior || 'data/reco/prior_v1.json').then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !j.base || !j.factors) return; PJ = j;
      if (prof){ const before = top(prof); upgrade(prof); save(prof); apply(); if (top(prof) !== before) redraw(); }
      if (open && el && !el.hidden) draw();
    }).catch(() => {});
  };
  ONB.prior = (J, b) => prior(J, b);                    // 시험용(node 대조)
  ONB.start = (a, b, J) => startScores(a, b, J);
  ONB.conds = () => [];          // 동승 조건 없음(팀 결정)
  ONB.chips = () => '';
  ONB.bind = () => {};
  ONB.card = (big, T) => {      // 추천 카드·목록을 누름 → 그 대분류가 슬롯 틀에 든 페르소나들에 +1/n
    if (!prof || !big || !T || !T.slots) return;
    const hit = IDS.filter(id => (T.slots[id] || []).includes(big)); if (!hit.length) return;
    hit.forEach(id => prof.learn[id] = (+prof.learn[id] || 0) + 1 / hit.length); sumUp(prof);
    prof.updated_at = new Date().toISOString(); save(prof);
  };
  ONB.battery = () => { const b = prof && prof.basic; return b && !b.batUnknown && +b.bat > 0 ? +b.bat : null; };
  ONB.name = id => NAME[id] || id;
  ONB.open = () => show(false);
  ONB.persona = () => prof ? top(prof) : null;      // 시험용
  g.ONB = ONB;
})(window);
