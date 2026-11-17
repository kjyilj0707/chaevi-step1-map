// 중계 서버: 외부 API 키를 여기(비밀 값)에만 두고, 페이지는 이 서버로만 요청함.
// GET /route?origin=경도,위도&destination=경도,위도   카카오 길찾기 (env.KAKAO_REST_API_KEY)
// GET /weather?lat=위도&lng=경도                      기상청 초단기실황·초단기예보 (env.DATA_GO_KR_SERVICE_KEY)
const ALLOWED = ['https://kjyilj0707.github.io', 'http://localhost:8765'];
const inKorea = (lng, lat) => lng > 124 && lng < 132 && lat > 33 && lat < 39;

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0], 'Vary': 'Origin' };
    const json = (obj, status = 200, cache = 'no-store') => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    const u = new URL(req.url);
    if (req.method !== 'GET' || (u.pathname !== '/route' && u.pathname !== '/weather')) return json({ error: 'not_found' }, 404);
    if (!ALLOWED.includes(origin)) return json({ error: 'forbidden' }, 403);
    if (u.pathname === '/weather') return weather(u, env, ctx, json);

    const parse = v => (v || '').split(',').map(Number);
    const [olng, olat] = parse(u.searchParams.get('origin'));
    const [dlng, dlat] = parse(u.searchParams.get('destination'));
    if (![olng, olat, dlng, dlat].every(Number.isFinite) || !inKorea(olng, olat) || !inKorea(dlng, dlat))
      return json({ error: 'bad_coords' }, 400);

    const q = new URLSearchParams({ origin: `${olng},${olat}`, destination: `${dlng},${dlat}`, priority: 'RECOMMEND', summary: 'false' });
    let r;
    try {
      const res = await fetch('https://apis-navi.kakaomobility.com/v1/directions?' + q, { headers: { Authorization: 'KakaoAK ' + env.KAKAO_REST_API_KEY } });
      if (!res.ok) return json({ error: 'upstream', status: res.status }, 502);
      r = await res.json();
    } catch (e) { return json({ error: 'upstream' }, 502); }

    const rt = r.routes && r.routes[0];
    if (!rt || rt.result_code !== 0) return json({ error: 'no_route', message: rt ? rt.result_msg : '' }, 200);
    const path = [], guides = [];
    for (const sec of rt.sections || []) {
      for (const road of sec.roads || []) for (let i = 0; i < road.vertexes.length; i += 2) path.push([road.vertexes[i + 1], road.vertexes[i]]);   // [위도, 경도]
      for (const g of sec.guides || []) guides.push({ lat: g.y, lng: g.x, text: g.guidance, distance: g.distance, type: g.type });
    }
    return json({ distance: rt.summary.distance, duration: rt.summary.duration, path, guides });
  }
};

/* ---------- 날씨 (기상청 단기예보 조회서비스 2.0, 공공데이터포털 15084084) ---------- */
const KMA = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';
const CACHE_SEC = 1200;            // 같은 격자·같은 발표 시각 결과를 20분 보관
const PTY = { 0: '없음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울눈날림', 7: '눈날림' };
const SKY = { 1: '맑음', 3: '구름많음', 4: '흐림' };

// 위경도 → 기상청 격자(nx, ny). 기상청 동네예보 격자 변환(람베르트 정각원추도법, 5km 격자) 공식 상수
function toGrid(lat, lng) {
  const RE = 6371.00877 / 5.0, DEG = Math.PI / 180;
  const s1 = 30 * DEG, s2 = 60 * DEG, olon = 126 * DEG, olat = 38 * DEG;
  let sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(Math.tan(Math.PI / 4 + s2 / 2) / Math.tan(Math.PI / 4 + s1 / 2));
  const sf = Math.pow(Math.tan(Math.PI / 4 + s1 / 2), sn) * Math.cos(s1) / sn;
  const ro = RE * sf / Math.pow(Math.tan(Math.PI / 4 + olat / 2), sn);
  const ra = RE * sf / Math.pow(Math.tan(Math.PI / 4 + lat * DEG / 2), sn);
  let th = lng * DEG - olon;
  if (th > Math.PI) th -= 2 * Math.PI;
  if (th < -Math.PI) th += 2 * Math.PI;
  th *= sn;
  return { nx: Math.floor(ra * Math.sin(th) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(th) + 136 + 0.5) };
}

// 발표 시각(KST). 실황은 매시 정각 자료가 약 40분 뒤에, 초단기예보는 매시 30분 자료가 약 45분 뒤에 나옴.
// back = 몇 시간 더 앞 자료를 쓸지 (자료 없음일 때 한 번 더 앞으로). Date 계산이라 자정·월말을 넘겨도 맞음
function baseTimes(now = Date.now(), back = 0) {
  const kst = new Date(now + 9 * 3600e3);       // UTC 값으로 KST 시각을 읽음
  const at = (minReady, minute) => {
    const t = new Date(kst.getTime() - ((kst.getUTCMinutes() < minReady ? 1 : 0) + back) * 3600e3);
    const p = n => String(n).padStart(2, '0');
    return { date: `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}`, time: `${p(t.getUTCHours())}${minute}` };
  };
  return { ncst: at(40, '00'), fcst: at(45, '30') };
}

// 공공데이터포털 키: 인코딩 키(%2B 등 포함)를 넣었으면 한 번 풀고, URLSearchParams가 한 번만 인코딩하게 함
const plainKey = k => { k = (k || '').trim(); if (/%[0-9A-Fa-f]{2}/.test(k)) { try { return decodeURIComponent(k); } catch (e) {} } return k; };

async function kma(op, key, b, g, rows) {
  const q = new URLSearchParams({ serviceKey: key, pageNo: '1', numOfRows: String(rows), dataType: 'JSON',
    base_date: b.date, base_time: b.time, nx: String(g.nx), ny: String(g.ny) });
  const res = await fetch(`${KMA}/${op}?${q}`);
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (e) {        // 게이트웨이 오류는 XML이나 일반 글로 오기도 함
    const m = text.match(/<errMsg>([^<]*)<|<resultMsg>([^<]*)</);
    throw new Error(m ? (m[1] || m[2]) : 'http_' + res.status);
  }
  // 키 오류(등록 안 된 키 등): {"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR",...}}}
  if (j.OpenAPI_ServiceResponse) throw new Error(((j.OpenAPI_ServiceResponse.cmmMsgHeader || {}).errMsg) || 'service_error');
  const h = (j.response || {}).header || {};
  if (h.resultCode === '03') return null;        // NO_DATA: 아직 발표 전
  if (h.resultCode !== '00') throw new Error(h.resultMsg || 'result_' + h.resultCode);
  return ((((j.response.body || {}).items) || {}).item) || [];
}

// 자료가 아직 없으면 한 시간 앞 발표분으로 한 번 더 시도
async function kmaWithFallback(op, which, key, g, rows) {
  for (const back of [0, 1]) {
    const b = baseTimes(Date.now(), back)[which];
    const items = await kma(op, key, b, g, rows);
    if (items && items.length) return { b, items };
  }
  return { b: null, items: [] };
}

const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const hhmm = t => t ? t.slice(0, 2) + ':' + t.slice(2) : null;

async function weather(u, env, ctx, json) {
  const lat = Number(u.searchParams.get('lat')), lng = Number(u.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lng, lat)) return json({ error: 'bad_coords' }, 400);
  if (!env.DATA_GO_KR_SERVICE_KEY) return json({ error: 'no_key' }, 500);
  const key = plainKey(env.DATA_GO_KR_SERVICE_KEY), g = toGrid(lat, lng), bt = baseTimes();

  // 캐시 열쇠: 격자 + 이번 발표 시각 (발표 시각이 바뀌면 열쇠도 바뀜)
  const cache = caches.default;
  const ck = new Request(`https://weather-cache.chaevi/v1/${g.nx}/${g.ny}/${bt.ncst.date}${bt.ncst.time}/${bt.fcst.date}${bt.fcst.time}`);
  const hit = await cache.match(ck);
  if (hit) { const o = await hit.json(); o.cached = true; return json(o, 200, 'public, max-age=300'); }

  let nc, fc;
  try {
    [nc, fc] = await Promise.all([
      kmaWithFallback('getUltraSrtNcst', 'ncst', key, g, 10),
      kmaWithFallback('getUltraSrtFcst', 'fcst', key, g, 60).catch(() => ({ b: null, items: [] }))]);   // 예보가 안 되면 실황만
  } catch (e) { return json({ error: 'upstream', message: String(e.message || e).slice(0, 80) }, 502); }
  if (!nc.items.length) return json({ error: 'no_data' }, 502);

  const o = {};
  for (const it of nc.items) o[it.category] = it.obsrValue;
  const pty = num(o.PTY) || 0;
  // 초단기예보: 시각별로 묶음 (앞에서부터 최대 6시간)
  const by = {};
  for (const it of fc.items) { const k = it.fcstDate + it.fcstTime; (by[k] = by[k] || { time: hhmm(it.fcstTime) })[it.category] = it.fcstValue; }
  const next = Object.keys(by).sort().slice(0, 6).map(k => { const f = by[k], p = num(f.PTY) || 0, s = num(f.SKY);
    return { time: f.time, temp: num(f.T1H), sky: s, skyText: SKY[s] || null, pty: p, ptyText: PTY[p] || null, rain: f.RN1 || null }; });
  const sky = next.length ? next[0].sky : null;

  const out = {
    grid: g,
    base: `${nc.b.date.slice(0, 4)}-${nc.b.date.slice(4, 6)}-${nc.b.date.slice(6)}T${hhmm(nc.b.time)}+09:00`,
    time: hhmm(nc.b.time),                        // 실황 기준 시각 (KST)
    temp: num(o.T1H), pty, ptyText: PTY[pty] || null, rain: pty > 0, rn1: num(o.RN1) || 0,
    reh: num(o.REH), wsd: num(o.WSD),
    sky, skyText: SKY[sky] || null,               // 하늘상태는 실황에 없어 초단기예보의 가장 이른 시각 값
    fcstBase: fc.b ? hhmm(fc.b.time) : null, next
  };
  // 캐시 보관: 보통 20분, 초단기예보가 빠진 결과는 5분
  ctx.waitUntil(cache.put(ck, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${fc.b ? CACHE_SEC : 300}` } })));
  return json(out, 200, 'public, max-age=300');
}
