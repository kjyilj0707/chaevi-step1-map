# 채비 서울 충전소 지도 (STEP 1 예비 대시보드)

- 범위: 주소가 서울특별시인 충전소만, 아파트(is_apt) 제외

- 지도 바탕: OpenStreetMap (Leaflet)
- 자료: 환경공단 충전기 상태 기록 (팀 드라이브 `01_충전소_지도/raw`의 `stations.csv`, `chargers.csv`, `status_daily/`)
- `build_data.py`: 원본 → `data/stations.json`(페이지용), `data/usage_by_hour.csv`(충전소 × 시각 이용률)
- 이용률 = 충전중 대수 ÷ (충전대기 + 충전중) 대수, 같은 시(0~23시)의 수집 시각 평균
- 다시 만들기: 원본을 `raw/`에 넣고 `python build_data.py` 실행 (`raw/`는 저장소에 올리지 않음)
- 주의: 수집 기간이 짧고(2026-11-08 ~ 11-11) 끊긴 구간이 있어 예비 확인용임
