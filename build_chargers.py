"""지도용 충전기 파일: raw/chargers.csv(환경공단 충전기 정보) -> data/chargers_seoul.json

- 범위: data/stations.json 에서 시·도가 '서울'로 시작하는 충전소(아파트 제외는 build_data.py 그대로)
- 충전소 단위: 운영시간(useTime)·주차 무료(parkingFree)·이용 제한(limitYn)은 충전기마다 다를 수 있어 충전기 줄에 둠
- 충전기 한 줄: [chgerId, chgerType, 출력 kW, 급속 1/0(is_fast), 운영시간 번호, 주차 무료 Y/N, 이용 제한 Y/N]
  운영시간 문자열은 같은 값이 많아 meta.use 목록에 한 번만 두고 번호로 가리킴
- chgerType 이름은 환경공단 전기차 충전소 정보 API 코드표 기준(meta.types)
- 주소는 공공 충전소 주소라 stations.json 에 이미 있음(여기엔 넣지 않음). 개인 정보 칸 없음
실행: ~/.venvs/work/bin/python -I build_chargers.py  (raw/ 는 저장소에 올리지 않음)
"""
import csv, json, os, re, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = {  # 환경공단 chgerType 코드표
    '01': 'DC차데모', '02': 'AC완속', '03': 'DC차데모+AC3상', '04': 'DC콤보', '05': 'DC차데모+DC콤보',
    '06': 'DC차데모+AC3상+DC콤보', '07': 'AC3상', '08': 'DC콤보(완속)', '09': 'NACS', '10': 'DC콤보+NACS'}
PHONE = re.compile(r'\d{2,4}-\d{3,4}-\d{4}')


def main():
    st = json.load(open(os.path.join(HERE, 'data/stations.json'), encoding='utf-8'))
    ids = {s[0] for s in st['stations'] if str(s[5]).startswith('서울')}
    use, uidx, out = [], {}, {}
    with open(os.path.join(HERE, 'raw/chargers.csv'), encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            if r['statId'] not in ids or r.get('delYn') == 'Y':
                continue
            u = PHONE.sub('***-****-****', (r['useTime'] or '').strip())
            if u not in uidx:
                uidx[u] = len(use); use.append(u)
            kw = float(r['output']) if r['output'] else 0
            out.setdefault(r['statId'], []).append([r['chgerId'], r['chgerType'], int(kw) if kw == int(kw) else kw,
                                                    1 if r['is_fast'] == 'True' else 0, uidx[u], r['parkingFree'] or '', r['limitYn'] or ''])
    for v in out.values():
        v.sort(key=lambda c: (-c[3], -float(c[2]), c[0]))
    unknown = sorted({c[1] for v in out.values() for c in v} - set(TYPES))
    res = {'meta': {'src': 'raw/chargers.csv (환경공단 충전기 정보, 팀 드라이브 01_충전소_지도/raw)', 'built': datetime.date.today().isoformat(),
                    'n_stations': len(out), 'n_chargers': sum(len(v) for v in out.values()), 'types': TYPES, 'use': use,
                    'cols': ['chgerId', 'chgerType', 'kw', 'fast', 'use', 'parkingFree', 'limitYn']},
           's': out}
    json.dump(res, open(os.path.join(HERE, 'data/chargers_seoul.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('stations', len(out), '/', len(ids), 'chargers', res['meta']['n_chargers'], 'use strings', len(use), 'unknown types', unknown)


if __name__ == '__main__':
    main()
