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
  /* 충전하는 동안 하고 싶은 것(여러 개, 11/23 준엽): 예전 Q2(단일, +3점) 자리. 타일 → 대분류(big) 또는 페르소나 직접 대응(to)
     점수: 타일마다 페르소나 벡터 v(대분류면 tables.json pw[페르소나][대분류]를 페르소나 합 1로 나눔, 직접 대응이면 표 값) → 고른 타일 평균 m
           → Q2 점수 = 3 × m_p / max(m) (가장 맞는 페르소나 3점, 나머지는 비율. 예전 Q2처럼 기본 정보 π(<1)보다 항상 큼)
     ic = 업종 그림 번호(index.html PICON) 또는 svg(그림 없는 타일) */
  const SVG_CAR = '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11a2 2 0 0 1 1.5 1.9V17a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0h-5a2 2 0 0 1-4 0h-1a1 1 0 0 1-1-1v-4.1A2 2 0 0 1 5 11zm2.2 0h9.6l-1.2-3.2a.6.6 0 0 0-.6-.4H9a.6.6 0 0 0-.6.4z"/></svg>';
  const SVG_CLOCK = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  const SVG_SHOP = '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M3.2 3.5h17.6l1.7 5.2a3 3 0 0 1-5.5 1.6 3.1 3.1 0 0 1-5 0 3.1 3.1 0 0 1-5 0A3 3 0 0 1 1.5 8.7z"/><path d="M4 12.4V21h6v-5.2h4V21h6v-8.6a4.4 4.4 0 0 1-3.4-.9 4.6 4.6 0 0 1-4.6 1 4.6 4.6 0 0 1-4.6-1 4.4 4.4 0 0 1-3.4.9z"/></svg>';      // 편의점(차양 있는 가게, 11/24: 마트 장바구니와 구분)
  const ACTS = [
    {id:'cafe', t:'커피·카페', big:'카페·음료', ic:12},
    {id:'dessert', t:'디저트·간식', big:'디저트·간식', ic:16},
    {id:'meal', t:'밥 먹기', big:'식사', ic:13},
    {id:'snack', t:'분식·포장', big:'간편식', ic:11},
    {id:'cvs', t:'편의점', big:'식품·편의', svg:SVG_SHOP, col:'#2a78d6'},
    {id:'mart', t:'마트 장보기', to:{P3:1}, ic:7, col:'#3d7fd1'},
    {id:'walk', t:'산책·공원', to:{P2:1}, ic:22},
    {id:'shop', t:'옷·잡화 구경', to:{P2:0.6, P3:0.4}, ic:10},
    {id:'fun', t:'취미·오락·운동', to:{P2:1}, ic:20},
    {id:'toilet', t:'화장실만', big:'화장실', ic:14},
    {id:'car', t:'차 안에서 쉬기', to:{P4a:1}, svg:SVG_CAR, col:'#8a63d2'},
    {id:'wait', t:'그냥 기다리기', to:{P4b:1}, svg:SVG_CLOCK, col:'#5f7484'}];
  let PW = null;      // tables.json pw (페르소나 × 대분류 가중치 weight_mapped)
  function actVec(t){
    const v = {}; IDS.forEach(p => v[p] = 0);
    if (t.to){ IDS.forEach(p => v[p] = t.to[p] || 0); return v; }
    if (!PW) return null;
    const sum = IDS.reduce((x, p) => x + ((PW[p] || {})[t.big] || 0), 0) || 1;
    IDS.forEach(p => v[p] = ((PW[p] || {})[t.big] || 0) / sum); return v;
  }
  /* 고른 타일 → 페르소나별 Q2 점수(최고 3). 표가 없어 계산 못 하면 null */
  function actScores(ids){
    const ts = (ids || []).map(id => ACTS.find(x => x.id === id)).filter(Boolean); if (!ts.length) return null;
    const vs = ts.map(actVec); if (vs.some(v => !v)) return null;
    const m = {}; IDS.forEach(p => m[p] = vs.reduce((x, v) => x + v[p], 0) / vs.length);
    const mx = Math.max(...IDS.map(p => m[p])) || 1, out = {}; IDS.forEach(p => out[p] = 3 * m[p] / mx); return out;
  }
  const actTop = ids => { const s = actScores(ids); return s ? IDS.reduce((b, p) => s[p] > s[b] + 1e-12 ? p : b, IDS[0]) : null; };
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

  /* ---------- 시연 로그인(11/23 준엽): 진짜 로그인이 아님. 가상 인물 5명(A~E, 11/23 준엽: 이름 대신 알파벳) 중 하나를 고르면 그 사람 값으로 들어감. 비밀번호·서버 없음 ----------
     세션은 시연판에서만 'chaeviDemoSession'(아래 MODE 참고, 11/23 낮 판 'chaeviSession'은 지움). 시연 프로필은 'chaeviDemo:<id>'에 따로 저장(내 MY 'chaeviProfile'과 섞이지 않음).
     인물 값 = MY 폼의 Q1~Q3·기본 정보 칸 그대로. Q2(충전 중 하는 일, +3점)가 그 페르소나라 시작 점수 1위가 그 페르소나(prior_v1 규칙, π < 1) */
  /* 두 버전(11/23): 실사용판(real) = 로그인 없음, MY 'chaeviProfile' / 시연판(demo, ?mode=demo) = 인물 로그인, 세션 'chaeviDemoSession'·프로필 'chaeviDemo:<id>'·타이머 'chaeviChargeDemo'(charge.js).
     같은 브라우저에서 두 주소를 오가도 서로의 저장값을 읽거나 지우지 않음 */
  const MODE = g.CHAEVI_MODE === 'demo' || new URLSearchParams(location.search).get('mode') === 'demo' ? 'demo' : 'real';
  const SKEY = 'chaeviDemoSession', DKEY = 'chaeviDemo:';
  const DEMO = [
    {id:'demo_p1', name:'A', ini:'A', p:'P1', intro:'주말 장거리, 휴게소에서 점심 겸 충전', a:{q1:'hwy', q2:'P1', q3:30}, b:{age:'40s', gender:'male', car:'egmp', speed:'fast', time:'lunch', freq:'1'}},
    {id:'demo_p2', name:'B', ini:'B', p:'P2', intro:'주말 낮 도심 외출 중 충전', a:{q1:'town', q2:'P2', q3:45}, b:{age:'30s', gender:'female', car:'tesla', speed:'fast', time:'afternoon', freq:'2_3'}},
    {id:'demo_p3', name:'C', ini:'C', p:'P3', intro:'퇴근길 마트 장보며 충전', a:{q1:'mart', q2:'P3', q3:45}, b:{age:'40s', gender:'female', car:'other', speed:'slow', time:'evening', freq:'2_3'}},
    {id:'demo_p4a', name:'D', ini:'D', p:'P4a', intro:'밤에 차 안에서 영상 보며 충전', a:{q1:'home', q2:'P4a', q3:30}, b:{age:'20s', gender:'male', car:'small_old', speed:'fast', time:'night', freq:'4_6'}},
    {id:'demo_p4b', name:'E', ini:'E', p:'P4b', intro:'출근 전 잠깐 급속 충전', a:{q1:'home', q2:'P4b', q3:15}, b:{age:'50s', gender:'male', car:'egmp', speed:'fast', time:'morning', freq:'daily'}}];
  const sess = () => { if (MODE !== 'demo') return null; try { const v = JSON.parse(localStorage.getItem(SKEY)); return v && v.mode === 'demo' && DEMO.some(d => d.id === v.id) ? v : null; } catch (e) { return null; } };
  const setSess = v => { if (MODE !== 'demo') return; try { if (v) localStorage.setItem(SKEY, JSON.stringify(v)); else localStorage.removeItem(SKEY); } catch (e) {} };
  const demoOf = () => { const v = sess(); return v && v.mode === 'demo' ? DEMO.find(d => d.id === v.id) : null; };
  const profKey = () => { if (MODE !== 'demo') return KEY; const d = demoOf(); return d ? DKEY + d.id : null; };      // 시연판에서 로그인 전에는 읽지도 쓰지도 않음
  const load = () => { const k = profKey(); if (!k) return null; try { const p = JSON.parse(localStorage.getItem(k)); return p && p.persona_scores ? upgrade(p) : null; } catch (e) { return null; } };
  const save = p => { const k = profKey(); if (!k) return; try { localStorage.setItem(k, JSON.stringify(p)); } catch (e) {} };
  /* 사람이 바뀔 때 남으면 안 되는 이 기기 값: 충전 타이머, 예전 추천 기억 */
  const clearTransient = () => { if (MODE !== 'demo') return; try { localStorage.removeItem('chaeviChargeDemo'); DEMO.forEach(d => localStorage.removeItem(DKEY + d.id)); } catch (e) {} };      // 시연판 값만
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
    a = a || {}; const sc = {}, as = a.acts && a.acts.length ? actScores(a.acts) : null;      // 여러 개 고른 '하고 싶은 것'이 있으면 그것이 Q2 자리
    const q2 = !as && IDS.includes(a.q2) ? a.q2 : null, q1p = !q2 && !as ? Q1P[a.q1] || null : null;
    if (!J){ IDS.forEach(p => sc[p] = as ? as[p] : 0); if (!as) sc[q2 || q1p || 'P2'] = 3; return sc; }
    const w2 = +J.rules.w_q2 || 3, lam = J.rules.lambda != null ? +J.rules.lambda : 1, pi = prior(J, b).pi;
    IDS.forEach(p => sc[p] = rd(lam * pi[p] + (as ? as[p] * w2 / 3 : p === q2 ? w2 : 0) + (p === q1p ? Q1_PTS : 0)));
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

  /* 예전 판 저장값 정리(11/24): 11/23 낮 판 시연 세션 'chaeviSession'은 이제 안 씀 → 지움(실사용판 MY 'chaeviProfile'은 지우지 않음) */
  try { localStorage.removeItem('chaeviSession'); } catch (e) {}
  let prof = load(), RS = null, REM = [15, 30, 45, 60], redraw = () => {}, open = false, queue = [], about = () => '';
  const need = () => (MODE === 'demo' && !sess()) || !prof;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));

  /* ---------- 폼 ---------- */
  let el = null, f = null, first = false, resetArm = false;      // f = 폼에서 고치는 중인 값(저장 전)
  function draft(){
    const a = (prof && prof.answers) || {}, b = (prof && prof.basic) || {};
    return {q1:a.q1 || null, q2:a.acts && a.acts.length ? null : a.q2 || null, q3:a.q3 || null, acts:(a.acts || []).slice(), pick:null,
      age:b.age || null, gender:b.gender || null, car:B[2].o.some(o => o[0] === b.car) ? b.car : null, speed:b.speed || null, time:b.time || null, freq:b.freq || null,
      gu:b.gu || '', bat:b.bat || '', batUnknown:!!b.batUnknown};
  }
  /* 저장하면 될 프로필(폼 값으로 미리 계산): 시작 점수 + (Q1·Q2가 그대로면 지금까지의 learn) + 직접 고름 */
  function trial(){
    const acts = f.acts && f.acts.length ? f.acts.slice() : null;
    const a = {q1:f.q1, q2:acts ? actTop(acts) || f.q2 : f.q2, q3:f.q3, acts, skipped:false};      // acts가 있으면 q2 = 그 1위(MY 단일 선택과 호환)
    const keep = prof && prof.answers && !prof.answers.skipped && prof.answers.q1 === a.q1 && prof.answers.q2 === a.q2 && String(prof.answers.acts || '') === String(a.acts || '');
    const p = makeProfile(a, basicOf(), keep ? Object.assign(zeros(), prof.learn) : null);
    if (f.pick) boost(p, f.pick);
    return p;
  }
  function preview(){           // 저장하면 될 페르소나와 그 까닭
    const p = trial(), t = top(p);
    if (f.pick) return [t, '직접 고름', p];
    if (IDS.some(id => (+p.learn[id] || 0) > 0) && t !== startOf(p)) return [t, '추천 카드 선택으로 바뀜', p];
    return [t, f.acts && f.acts.length ? '하고 싶은 것 기준' : f.q2 ? '충전하는 동안 하는 일 기준' : f.q1 ? '주로 충전하는 곳 기준' : PJ && hasBasic() ? '기본 정보 시작값 기준' : '기본값', p];
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
        if (k === 'q1' || k === 'q2' || k === 'acts') f.pick = null;      // 습관 답을 바꾸면 직접 고른 페르소나는 풂
        if (k === 'q2' && f.q2) f.acts = []; if (k === 'acts' && f.acts.length) f.q2 = null;      // 하고 싶은 것(여러 개)과 하는 일(하나) 중 하나만 씀
        draw(); return;
      }
      const act = b.dataset.act;
      if (act === 'save') finish(true);
      else if (act === 'later') finish(false);
      else if (act === 'close') close();
      else if (act === 'logout') logout();
      else if (act === 'requiz') showQuiz();
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
      <div class="my-top"><h2 id="myT">MY${demoOf() ? ` <small class="my-who">${esc(demoOf().name)} · ${demoOf().id}</small>` : ''}</h2>${first ? '<span></span>' : '<button type="button" class="my-x" data-act="close" aria-label="닫기">×</button>'}</div>
      ${first ? '' : MODE === 'demo' ? '<button type="button" class="my-switch" data-act="logout">다른 사람으로 보기</button>' : '<button type="button" class="my-switch" data-act="requiz">질문 다시 하기</button>'}
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
        <p class="my-lab">충전하는 동안 하고 싶은 것 <small>여러 개 · 고르면 아래 '하는 일' 대신 씀</small></p>${chipRow('acts', ACTS.map(t => [t.id, t.t]), true, f.acts)}
        ${Q.map(q => `<p class="my-lab">${esc(q.t)}${q.k === 'q2' ? ' <small>하나 · 고르면 위 선택은 풂</small>' : ''}</p>${chipRow(q.k, q.o, false, f[q.k])}`).join('')}
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
    if (el) el.onclick = null;      // 로그인·질문 화면의 클릭 처리 해제(MY 폼은 addEventListener 쪽)
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
  function fabLabel(){ const b = document.getElementById('onbFab'), d = demoOf(); if (!b || !d) return;
    b.classList.add('demo'); b.setAttribute('data-p', d.p); b.querySelector('span').textContent = d.name; b.setAttribute('aria-label', `MY · 시연 ${d.name}`); }
  function reset(){
    prof = null; try { localStorage.removeItem(profKey()); localStorage.removeItem('recoP'); localStorage.removeItem('recoR'); } catch (e) {}
    apply(); close(); redraw();
    if (typeof g.toast === 'function') g.toast('내 정보·페르소나를 초기화함. 다음에 열 때 MY 입력 화면이 다시 나옴');
  }
  // pick 줄 처리: 공통 click 처리기가 f.pick 에 값/해제를 넣음(k='pick')

  /* ---------- 시연 로그인 화면 + 새 사용자 질문 ---------- */
  /* '채소' 로고·슬로건(11/23 준엽): 채소 = 채비 + 소중한 시간. 시연판 로그인 화면·실사용판 질문 첫 화면에만(지도 화면에는 넣지 않음) */
  /* '채소' 브랜드(11/23 준엽 시안): 로고 = 민트 열린 원 + 남색 V + 플러그(번개). 채소 = 채비와의 소중한 시간 */
  const LOGO_SVG = (px, ring) => `<svg viewBox="0 0 100 100" width="${px}" height="${px}" aria-hidden="true"><path class="lg-ring" d="M75.6 40.5 A32 32 0 1 1 54.3 23.1" fill="none" stroke="${ring || '#58DDD0'}" stroke-width="9" stroke-linecap="round"/>
    <polyline points="33,45 46,60 59,45" fill="none" stroke="#1B4965" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/>
    <g transform="rotate(28 77 21)"><rect x="69" y="7" width="16" height="22" rx="4.5" fill="#1B4965"/><rect x="75" y="28" width="4" height="9" rx="2" fill="#1B4965"/><path d="M78.6 11 72.8 19.4h4.2l-1.6 6.4 6-8.6h-4.2z" fill="#fff"/></g></svg>`;
  const LOGO = `<div class="chs" aria-label="채소 — 채비와의 소중한 시간"><span class="chs-mark">${LOGO_SVG(40)}</span><span class="chs-word">채소</span><span class="chs-line">채비와의 소중한 시간</span></div>`;
  /* 스플래시·웰컴(11/23 시안). 스플래시 = 탭 한 번 열 때 한 번(이 탭에서 처음, 1.3초 또는 누르면 넘어감), 웰컴 = 같은 탭에서 한 번(실사용판 질문 앞·시연판 인물 고르기 앞) */
  const ssGet = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const ssSet = k => { try { sessionStorage.setItem(k, '1'); } catch (e) {} };
  /* 웰컴 그림(직접 그린 SVG, 11/24 시안에 가깝게): 민트 시계 호·눈금, 지붕(캐노피)·기둥, 민트 화면 + V 충전기, SUV 실루엣, 바닥 민트 선 */
  const WELCOME_ART = `<svg class="wl-art" viewBox="0 0 340 260" aria-hidden="true">
    <path d="M14 214H330" stroke="#58DDD0" stroke-width="3" stroke-linecap="round" opacity=".7"/>
    <path d="M30 222c60 14 220 14 290 0" fill="none" stroke="#c9eee9" stroke-width="10" stroke-linecap="round"/>
    <path d="M48 176A118 118 0 0 1 250 70" fill="none" stroke="#58DDD0" stroke-width="6" stroke-linecap="round" opacity=".5"/>
    <g stroke="#58DDD0" stroke-width="3.5" stroke-linecap="round" opacity=".65"><path d="M58 128l11 5"/><path d="M84 88l9 8"/><path d="M124 62l5 11"/><path d="M168 54v12"/><path d="M212 60l-5 11"/></g>
    <path d="M222 24h118v14H222z" fill="#e6ece9"/><path d="M222 38h118" stroke="#d3ddd9" stroke-width="2"/><rect x="306" y="38" width="12" height="176" fill="#eef2f0"/>
    <g><rect x="252" y="92" width="46" height="122" rx="10" fill="#fff" stroke="#c8d3cf" stroke-width="2.5"/>
      <rect x="252" y="92" width="46" height="26" rx="10" fill="#58DDD0"/><rect x="252" y="106" width="46" height="12" fill="#58DDD0"/>
      <polyline points="267,101 275,109 283,101" fill="none" stroke="#1B4965" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="262" y="128" width="26" height="20" rx="4" fill="#1B4965"/><rect x="267" y="133" width="10" height="3.5" rx="1.75" fill="#58DDD0"/><rect x="267" y="139" width="16" height="3" rx="1.5" fill="#58DDD0" opacity=".6"/>
      <circle cx="275" cy="164" r="6" fill="#e6ece9" stroke="#c8d3cf" stroke-width="2"/></g>
    <path d="M269 164c-12 0-20 6-26 16-6 10-14 14-26 14" fill="none" stroke="#1B4965" stroke-width="4.5" stroke-linecap="round"/>
    <g><path d="M20 192v-20c0-10 6-17 16-19l30-6 22-30c6-8 14-12 24-12h76c10 0 18 4 24 11l25 30 15 4c10 3 16 11 16 21v21c0 4-3 7-7 7H27c-4 0-7-3-7-7z" fill="#fff" stroke="#c8d3cf" stroke-width="3"/>
      <path d="M108 102h92" stroke="#c8d3cf" stroke-width="4" stroke-linecap="round"/>
      <path d="M92 146l17-24c4-6 10-8 17-8h24v32z" fill="#d7ecf0"/><path d="M158 114h30c7 0 12 2 16 7l21 25h-67z" fill="#d7ecf0"/>
      <path d="M28 170h22" stroke="#58DDD0" stroke-width="5" stroke-linecap="round"/><path d="M226 166h22" stroke="#c8d3cf" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M56 158h186" stroke="#e1e8e5" stroke-width="2"/><path d="M20 188h28M234 188h30" stroke="#1B4965" stroke-width="3" stroke-linecap="round" opacity=".35"/>
      <circle cx="76" cy="198" r="21" fill="#1B4965"/><circle cx="76" cy="198" r="9" fill="#c8d3cf"/><circle cx="212" cy="198" r="21" fill="#1B4965"/><circle cx="212" cy="198" r="9" fill="#c8d3cf"/></g>
    <g fill="#9fd8b8"><circle cx="16" cy="200" r="11"/><circle cx="6" cy="208" r="8"/><circle cx="330" cy="204" r="9"/></g></svg>`;
  function showSplash(next){
    lockOpen(); ssSet('chaeviSplash');
    el.innerHTML = `<div class="sp" role="img" aria-label="채소, 채비와의 소중한 시간">
      <div class="sp-mid">${LOGO_SVG(132)}<b class="sp-word">채소</b><span class="sp-line">채비와의 소중한 시간</span></div>
      <svg class="sp-wave" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 110 C120 70 220 90 400 10" fill="none" stroke="#58DDD0" stroke-width="2" opacity=".55"/><path d="M196 72 189 84h6l-2 8 9-12h-6l2-8z" fill="#58DDD0"/></svg>
      <p class="sp-foot">소중한 시간을 충전해요</p></div>`;
    let done = false; const go = () => { if (done) return; done = true; el.onclick = null; next(); };
    el.onclick = go; setTimeout(go, 1300);
  }
  function showWelcome(next){
    lockOpen(); ssSet('chaeviWelcome');
    el.innerHTML = `<div class="onb-in wl">
      <div class="wl-top"><b>채소</b><button type="button" class="wl-skip" data-act="wgo">건너뛰기</button></div>
      <h1 class="wl-t">충전하는 동안,<br>나를 위한 시간.</h1>
      <p class="wl-d">채비와 함께하는 소중한 순간을<br>채소에서 시작해보세요.</p>
      <div class="wl-artbox">${WELCOME_ART}</div>
      <button type="button" class="onb-go wl-go" data-act="wgo">채소 시작하기 <span aria-hidden="true">→</span></button>
      <p class="wl-foot">채비와의 소중한 시간</p></div>`;
    el.onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.act === 'wgo'){ el.onclick = null; next(); } };
  }
  /* 첫 흐름: (이 탭에서 처음이면) 스플래시 → (이 탭에서 처음이면) 웰컴 → next(질문 또는 인물 고르기) */
  function startFlow(next){
    const afterSplash = () => ssGet('chaeviWelcome') ? next() : showWelcome(next);
    if (!ssGet('chaeviSplash')) showSplash(afterSplash); else { lockOpen(); setTimeout(afterSplash, 0); }
  }
  function lockOpen(){ build(); first = true; el.hidden = false; open = true; document.body.classList.add('onb-on'); }      // first = Esc로 닫히지 않게
  function loginDemo(id){
    const d = DEMO.find(x => x.id === id); if (!d) return;
    clearTransient(); setSess({mode:'demo', id});
    prof = makeProfile(Object.assign({skipped:false}, d.a), Object.assign({}, d.b)); save(prof);
    location.reload();      // 지도·추천·키워드·슬라이더 상태를 깨끗하게(이전 사람 상태가 남지 않게)
  }
  function logout(){ clearTransient(); setSess(null); location.reload(); }
  function showLogin(){
    lockOpen();
    el.innerHTML = `<div class="onb-in lgn">
      ${LOGO}
      <h2 class="lg-t">누구로 둘러볼까요?</h2>
      <p class="lg-lead">시연용 가상 인물이에요. 실제 로그인이 아니고, 고른 값은 이 기기에만 저장돼요.</p>
      <div class="lg-list">${DEMO.map(d => `<button type="button" class="lg-card" data-demo="${d.id}" data-p="${d.p}">
        <span class="lg-av" aria-hidden="true">${esc(d.ini)}</span>
        <span class="lg-body"><b>${esc(d.name)}</b><span class="lg-id">${d.id} · ${NAME[d.p]}</span><span class="lg-in">${esc(d.intro)}</span>
          <span class="lg-meta">${esc(LAB['car:' + d.b.car] || '')} · ${esc(LAB['time:' + d.b.time] || '')} 충전 · 보통 ${d.a.q3}분</span></span></button>`).join('')}</div>
      <a class="onb-link lg-real" href="./">실사용판 열기 (내 정보로 시작)</a>
    </div>`;
    el.onclick = e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.demo) return loginDemo(b.dataset.demo); };
  }
  /* 새 사용자 질문(11/23 준엽 참고 이미지: 타일 격자 + 아래 고정 띠). 1 하고 싶은 것(여러 개, 2개 이상) · 2 주로 충전하는 곳 · 3 보통 머무는 시간 · 4 시간대 · 5 차종(4·5 건너뛰기 가능) */
  const QZ = [{k:'acts', grp:'a', multi:2, t:'충전하는 동안 무엇을 하고 싶으세요?', d:'2개 이상 골라 주세요. 고른 것으로 맞춤 추천을 정해요.'},
    Object.assign({grp:'a', d:'하나만 골라 주세요.'}, Q[0], {t:'주로 어디서 충전하세요?'}), Object.assign({grp:'a', d:'충전 타이머를 켜지 않았을 때 추천 기준이 돼요.'}, Q[2], {t:'보통 얼마나 머무세요?'}),
    Object.assign({grp:'b', skip:true, d:'시작값에 조금 반영돼요(건너뛰어도 돼요).'}, B[4], {t:'주로 언제 충전하세요?'}), Object.assign({grp:'b', skip:true, d:'시작값에 조금 반영돼요(건너뛰어도 돼요).'}, B[2], {t:'어떤 차를 타세요?'})];
  let qz = null;
  function showQuiz(){ lockOpen(); qz = {i:0, a:{q1:null, q2:null, q3:null, acts:[], skipped:false}, b:{}}; drawQuiz(); }
  const tileArt = t => { const c = t.col || (typeof POI_COL !== 'undefined' && t.ic != null ? POI_COL[t.ic] : '#3d9a7f');
    return t.svg ? `<span class="illo" style="--c:${c};--s:64px" aria-hidden="true">${t.svg}</span>` : typeof illo === 'function' ? illo(t.ic, 64).replace(/--c:[^;]+;/, `--c:${c};`) : ''; };
  function drawQuiz(){
    if (qz.i >= QZ.length) return drawResult();
    const q = QZ[qz.i], multi = !!q.multi, cur = q.grp === 'a' ? qz.a[q.k] : qz.b[q.k];
    const n = multi ? cur.length : cur != null ? 1 : 0, ok = multi ? n >= q.multi : n === 1 || q.skip;
    const body = multi ? `<div class="qz-grid">${ACTS.map(t => `<button type="button" class="qz-tile" data-v="${t.id}" aria-pressed="${cur.includes(t.id)}">${tileArt(t)}<i class="qz-chk" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i><span>${esc(t.t)}</span></button>`).join('')}</div>`
      : `<div class="qz-grid2">${q.o.map(([v, t]) => `<button type="button" class="qz-opt" data-v="${esc(v)}" aria-pressed="${cur === v}">${esc(t)}</button>`).join('')}</div>`;
    el.innerHTML = `<div class="onb-in qz">
      <div class="qz-top">${qz.i ? '<button type="button" class="qz-back" data-act="back" aria-label="이전">←</button>' : ''}
        <div class="qz-bar" role="progressbar" aria-valuemin="1" aria-valuemax="${QZ.length}" aria-valuenow="${qz.i + 1}"><i style="width:${(qz.i + 1) / QZ.length * 100}%"></i></div><span class="qz-n">${qz.i + 1}/${QZ.length}</span></div>
      ${qz.i === 0 ? LOGO : ''}<h2 class="qz-t">${esc(q.t)}</h2><p class="qz-d">${esc(q.d || '')}${qz.i === 0 && prof ? ` <button type="button" class="qz-keep" data-act="cancel">이전 답으로 계속 (${NAME[top(prof)]})</button>` : ''}</p>
      ${body}
      <div class="qz-foot"><span>${multi ? `<b>${n}</b>개 선택 <small>(${q.multi}개 이상)</small>` : q.skip && !n ? '건너뛸 수 있어요' : n ? '골랐어요' : '하나 골라 주세요'}</span>
        <button type="button" class="qz-next" data-act="next"${ok ? '' : ' disabled'}>${q.skip && !n ? '건너뛰기' : '다음'}</button></div></div>`;
    el.onclick = e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'back'){ qz.i--; return drawQuiz(); }
      if (b.dataset.act === 'cancel'){ el.onclick = null; qz = null; return close(); }      // '이전 답으로 계속' = 저장된 MY 그대로 지도로
      if (b.dataset.act === 'next'){ if (!b.disabled){ qz.i++; drawQuiz(); } return; }
      const v = q.k === 'q3' ? +b.dataset.v : b.dataset.v;
      if (b.classList.contains('qz-tile')){ const k = qz.a.acts.indexOf(v); if (k >= 0) qz.a.acts.splice(k, 1); else qz.a.acts.push(v); return keepScroll(drawQuiz); }
      if (b.classList.contains('qz-opt')){ const o = q.grp === 'a' ? qz.a : qz.b; o[q.k] = o[q.k] === v ? null : v; keepScroll(drawQuiz); } };
  }
  const keepScroll = fn => { const y = el.querySelector('.onb-in') ? el.querySelector('.onb-in').scrollTop : 0; fn(); const n = el.querySelector('.onb-in'); if (n) n.scrollTop = y; };
  function drawResult(){
    const a = Object.assign({}, qz.a, {acts:qz.a.acts.slice()}); a.q2 = actTop(a.acts) || null;      // MY 단일 선택과 호환: q2 = 하고 싶은 것 1위
    const p = makeProfile(a, qz.b), t = top(p), st = p.start, sum = IDS.reduce((x, id) => x + (+st[id] || 0), 0) || 1;
    const rank = IDS.slice().sort((x, y) => (+st[y] || 0) - (+st[x] || 0)).slice(0, 3);
    const q2t = (Q[1].o.find(o => o[0] === qz.a.q2) || [])[1], q1t = (Q[0].o.find(o => o[0] === qz.a.q1) || [])[1];
    const at = a.acts.map(id => (ACTS.find(x => x.id === id) || {}).t).filter(Boolean);
    const why = at.length ? `충전하는 동안 ${at.slice(0, 3).join('·')}${at.length > 3 ? ` 외 ${at.length - 3}개` : ''}을(를) 고르셨어요.` : qz.a.q2 ? `충전하는 동안 '${q2t}'을(를) 고르셨어요.` : qz.a.q1 && Q1P[qz.a.q1] ? `주로 '${q1t}'에서 충전한다고 하셨어요.` : '답이 적어 시간대·차종과 충전 후기 비율로 정했어요.';
    el.innerHTML = `<div class="onb-in qz">
      <p class="lg-brand">결과</p>
      <h2 class="qz-res">당신은 <em>${NAME[t]}</em></h2>
      <p class="lg-lead">${esc(why)} ${esc(DESC[t])}</p>
      <div class="qz-bars">${rank.map(id => { const v = (+st[id] || 0) / sum; return `<div class="qz-row${id === t ? ' on' : ''}"><span>${NAME[id]}</span><i><b style="width:${(v * 100).toFixed(1)}%"></b></i><em>${Math.round(v * 100)}%</em></div>`; }).join('')}</div>
      <p class="my-note">막대 = 시작 점수 비율(질문 답 + 충전 후기 비율·시간대·차종 배수). 결과는 MY에서 언제든 바꿀 수 있어요.</p>
      <button type="button" class="onb-go" data-act="go">시작하기</button>
      <button type="button" class="onb-link" data-act="back">답 다시 고르기</button></div>`;
    el.onclick = e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'back'){ qz.i = QZ.length - 1; return drawQuiz(); }
      if (b.dataset.act === 'go'){ prof = p; save(prof); apply(); el.onclick = null; qz = null; close(); redraw();      // answers.acts(여러 개)와 q2(1위) 함께 저장
        if (typeof g.toast === 'function') g.toast(`${NAME[t]}(으)로 시작해요 · MY에서 바꿀 수 있어요`); } };
  }

  /* ---------- index.html 에서 부르는 것 ---------- */
  const ONB = {};
  ONB.after = fn => { if (need() || open) queue.push(fn); else fn(); };          // 첫 화면이 떠 있으면 닫힌 뒤에 실행(위치 권한 요청을 폼 위에 띄우지 않음)
  ONB.init = (rs, remains, re, opt) => {
    RS = rs; if (Array.isArray(remains)) REM = remains; if (typeof re === 'function') redraw = () => { try { re(); } catch (e) {} };
    if (opt && typeof opt.about === 'function') about = opt.about;
    apply(); fabBtn(); fabLabel();
    if (MODE === 'demo'){ if (!sess()) startFlow(showLogin); }      // 시연판: (스플래시·웰컴) → 인물 고르기(질문 흐름 없음). 이미 인물로 들어와 있으면 바로 지도
    /* 실사용판(11/23 준엽): 페이지를 열 때마다(새로고침 포함) 질문부터, 빈 상태로 시작. MY가 있으면 첫 화면에 '이전 답으로 계속' 작은 링크.
       질문은 이 init에서만 띄움 → 경로 안내·타이머 등 같은 로드 안의 다시 그리기로는 다시 안 뜸. 충전 타이머는 그대로 돎(질문 뒤에서) */
    else startFlow(showQuiz);      // (스플래시·웰컴) → 질문. 질문 그림(index.html의 illo)은 최소 한 박자 뒤에 그려짐
    /* 하고 싶은 것 점수표(tables.json pw): 오면 acts가 있는 프로필의 시작 점수를 다시 계산(learn 유지) */
    fetch(opt && opt.tables || 'data/reco/tables.json').then(r => r.ok ? r.json() : null).then(t => {
      if (!t || !t.pw) return; PW = t.pw;
      if (prof && prof.answers && prof.answers.acts && prof.answers.acts.length && PJ){ const before = top(prof); prof.start = startScores(prof.answers, prof.basic, PJ); sumUp(prof); save(prof); apply(); if (top(prof) !== before) redraw(); }
      if (open && el && !el.hidden && qz) drawQuiz();
    }).catch(() => {});
    /* 시작값 표(prior_v1.json): 오면 저장된 프로필의 시작 점수를 다시 계산(learn 유지)하고, 폼이 열려 있으면 다시 그림. 못 읽으면 예전 규칙 */
    fetch(opt && opt.prior || 'data/reco/prior_v1.json').then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !j.base || !j.factors) return; PJ = j;
      if (prof){ const before = top(prof); upgrade(prof); save(prof); apply(); if (top(prof) !== before) redraw(); }
      if (open && el && !el.hidden) draw();
    }).catch(() => {});
  };
  ONB.prior = (J, b) => prior(J, b);                    // 시험용(node 대조)
  ONB.start = (a, b, J) => startScores(a, b, J);
  ONB.acts = () => ACTS.map(t => ({id:t.id, t:t.t, big:t.big || null, to:t.to || null, v:actVec(t)}));      // 시험용
  ONB.actScores = ids => actScores(ids);
  ONB.conds = () => [];          // 동승 조건 없음(팀 결정)
  ONB.chips = () => '';
  ONB.bind = () => {};
  ONB.card = (big, T) => {      // 추천 카드·목록을 누름 → 그 대분류가 슬롯 틀에 든 페르소나들에 +1/n
    if (!prof || !big || !T || !T.slots) return;
    const hit = IDS.filter(id => (T.slots[id] || []).includes(big)); if (!hit.length) return;
    const before = top(prof);
    hit.forEach(id => prof.learn[id] = (+prof.learn[id] || 0) + 1 / hit.length); sumUp(prof);
    prof.updated_at = new Date().toISOString(); save(prof);
    /* 11/22 점검 5: 합계 1위가 바뀌면 그 자리에서 RS.persona를 다시 정함(부른 쪽이 바로 다시 그림). 바뀌었으면 true */
    apply(); const now = top(prof);
    if (now !== before && typeof g.toast === 'function') g.toast(`카드 선택이 쌓여 현재 페르소나가 ${NAME[now]}(으)로 바뀜`);
    return now !== before;
  };
  ONB.battery = () => { const b = prof && prof.basic; return b && !b.batUnknown && +b.bat > 0 ? +b.bat : null; };
  ONB.name = id => NAME[id] || id;
  ONB.open = () => show(false);
  ONB.persona = () => prof ? top(prof) : null;      // 시험용
  ONB.isDemo = () => !!demoOf();
  ONB.mode = () => MODE;
  ONB.build = '20261124f';      // index.html CHAEVI_BUILD와 같아야 함(다르면 index.html이 다시 불러옴)
  ONB.who = () => { const d = demoOf(); return d ? {id:d.id, name:d.name, p:d.p} : null; };      // 시연판 지도 위 '다른 사람으로 보기' 버튼용
  ONB.userName = () => { const d = demoOf(); return d ? d.name : ''; };
  ONB.demos = () => DEMO.map(d => Object.assign({}, d));      // 시험용
  ONB.login = id => loginDemo(id);
  ONB.logout = () => logout();
  g.ONB = ONB;
})(window);
