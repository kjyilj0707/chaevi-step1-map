# 채비 충전소 지도 (STEP 1 예비 대시보드)

- 범위: 전국, 아파트(is_apt) 제외

- 지도 바탕: OpenStreetMap (Leaflet)
- 자료: 환경공단 충전기 상태 기록 (팀 드라이브 `01_충전소_지도/raw`의 `stations.csv`, `chargers.csv`, `status_daily/`)
- `build_data.py`: 원본 → `data/stations.json`(페이지용), `data/usage_by_hour.csv`(충전소 × 시각 이용률)
- 이용률 = 충전중 대수 ÷ (충전대기 + 충전중) 대수, 같은 시(0~23시)의 수집 시각 평균
- 다시 만들기: 원본을 `raw/`에 넣고 `python build_data.py` 실행 (`raw/`는 저장소에 올리지 않음)
- 주의: 수집 기간이 짧고(2026-11-08 ~ 11-11) 끊긴 구간이 있어 예비 확인용임

## STEP 2 예비: 충전소 주변 상권

- 충전소를 누를 때만 그 충전소의 주변 상권(반경 300m)을 읽어 지도와 목록에 보여 줌
- 자료: 소상공인시장진흥공단 상가(상권)정보 2026-09 (팀 드라이브 `02_충전소_유형/raw`), 현재 7개 시·도(서울·부산·대구·대전·울산·경남·강원)
- `build_poi.py`: 원본(`raw/step2/`) → `data/poi/<충전소ID>.json`, `data/poi_counts.csv`(충전소 × 7개 카테고리 개수)
- 7개 카테고리(식사·카페·테이크아웃·쇼핑·편의·관광여가·업무) 대응표는 임시안임. `build_poi.py` 맨 위의 `MID`, `SUB`를 고치면 됨
- 실행 순서: `build_data.py` → `build_poi.py`
