# 채비 충전소 지도 (STEP 1 예비 대시보드)

- 범위: 전국, 아파트(is_apt) 제외

- 지도 바탕: OpenStreetMap (Leaflet)
- 자료: 환경공단 충전기 상태 기록 (팀 드라이브 `01_충전소_지도/raw`의 `stations.csv`, `chargers.csv`, `status_daily/`)
- `build_data.py`: 원본 → `data/stations.json`(페이지용), `data/usage_by_hour.csv`(충전소 × 시각 이용률)
- 이용률 = 충전중 대수 ÷ (충전대기 + 충전중) 대수, 같은 시(0~23시)의 수집 시각 평균
- 다시 만들기: 원본을 `raw/`에 넣고 `python build_data.py` 실행 (`raw/`는 저장소에 올리지 않음)
- 주의: 수집 기간이 짧고(2026-11-08 ~ 11-11) 끊긴 구간이 있어 예비 확인용임

## STEP 2 예비: 충전소 주변 상권

- 충전소를 누를 때만 그 충전소의 주변 상권 파일(반경 300m)을 읽고, 화면에서는 고른 반경(50m·100m, 기본 100m) 안만 걸러 지도와 목록에 보여 줌. `poi_counts.csv`는 300m 기준이며 화면에서는 쓰지 않음
- 자료: 소상공인시장진흥공단 상가(상권)정보 2026-09 (팀 드라이브 `02_충전소_유형/raw`), 현재 7개 시·도(서울·부산·대구·대전·울산·경남·강원)
- `build_poi.py`: 원본(`raw/step2/`) → `data/poi/<충전소ID>.json`, `data/poi_counts.csv`(충전소 × 7개 카테고리 개수)
- 7개 카테고리(식사·카페·테이크아웃·쇼핑·편의·관광여가·업무) 대응표는 임시안임. `build_poi.py` 맨 위의 `MID`, `SUB`를 고치면 됨
- 실행 순서: `build_data.py` → `build_poi.py`

## 시연 충전소 9곳: 도보 5분·10분 범위

- 9곳(`build_walk9.py`의 `STATIONS`)은 직선 반경 대신 도보 5분(390m)·10분(780m) 안 가게를 보여 줌. 지도에서 초록 걷는 사람 배지로 표시, 위쪽 "시연 9곳" 칩으로 9곳만 볼 수 있음
- 자료: `../analysis/walk_9/walk_routes_9_v2.csv`(팀 확정 규칙 2026-11-20, OSM 보행망 multi × 보정, 카카오 도보 경로값 표본, 보행 1.3 m/s). 지도 칩 = 동권 활동 7개(편의점·약국·카페 테이크아웃·쇼핑·빠른 식사·카페 착석·일반 식당). `../analysis/activity_map/category_map_sewon.csv`(세원 77 소분류 → 활동, 분석 기준선 비교와 같은 표)의 activity를 소분류로 붙임. `대응 없음`(담배·PC방 등)은 뺌, 카페·아이스크림은 카페 테이크아웃·카페 착석 두 칩에 모두 셈. 직선 반경 화면(도보 자료 없는 충전소)은 위 7개 카테고리 그대로
- `build_walk9.py`: → `data/walk9/<충전소ID>.json`(10분 안 가게, 도보 거리 순), `data/walk9/index.json`(9곳 요약). 경로 미확인(route_status≠ok)은 빼고 개수만 적음, 가게 이름의 전화번호는 가림
- 실행: `~/.venvs/work/bin/python -I build_walk9.py` (`raw/step2/sbiz_서울.csv` 필요)

## 서울 전체 도보 범위 (준비, 자료 받으면 실행)

- `build_walk_seoul.py`: 분석 담당의 서울 전체 도보 경로 CSV → `data/walk_seoul/<충전소ID>.json`, `data/walk_seoul/index.json`(label "서울 도보 n곳", demo = 시연 9곳, 충전소별 kind·stay·low·lowWhy). 가게 처리 방식은 `build_walk9.py`의 `load_routes`·`write_station`을 그대로 씀
- 입력은 `SRC_CANDIDATES`(analysis/walk_seoul_all, walk_seoul_fast) 중 처음 있는 파일, 또는 `--src`
- 화면은 `data/walk_seoul/index.json`이 있으면 그것을, 없으면 `data/walk9`를 씀. 첫 화면 필터 칩 이름도 따라 바뀜("서울 도보 n곳" / "시연 9곳")
- low(도보 시간 추정 정확도 낮음) 판정은 임시안: osm_flag 값이 있거나 10분 안 가게의 30% 넘게 대체·추정 보정인 충전소. 화면 단서 맨 앞에 굵게 표시
