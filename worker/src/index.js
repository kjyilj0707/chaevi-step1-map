// 길찾기 중계 서버: 카카오 키를 여기(비밀 값)에만 두고, 페이지는 이 서버로만 요청함.
// GET /route?origin=경도,위도&destination=경도,위도
const ALLOWED = ['https://kjyilj0707.github.io', 'http://localhost:8765'];
const inKorea = (lng, lat) => lng > 124 && lng < 132 && lat > 33 && lat < 39;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0], 'Vary': 'Origin' };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    const u = new URL(req.url);
    if (req.method !== 'GET' || u.pathname !== '/route') return json({ error: 'not_found' }, 404);
    if (!ALLOWED.includes(origin)) return json({ error: 'forbidden' }, 403);

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
