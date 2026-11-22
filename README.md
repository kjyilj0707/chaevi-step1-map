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
- 붐빔 v2(2026-11-22, 우리 쪽 재계산): `build_poi.py` 다음에 `~/.venvs/work/bin/python -I apply_busy_v2.py` → `data/stations.json`의 `occ24`를 `data/usage_by_hour_v2.csv`(= `../analysis/station_reco/usage_by_hour_v2.csv`, 같은 충전기·같은 수집 시각 기록이 둘이면 statUpdDt 최신 하나만)로 바꾸고 `meta.busy` 표시. `build_data.py`·`data/usage_by_hour.csv`(STEP 1)는 그대로 둠. 지도 목록·충전소 상세·충전소 추천 패널이 같은 값(목록 안내에 "11/08~11/11 수집, 최신 기록 기준")

## 시연 충전소 9곳: 도보 5분·10분 범위

- 9곳(`build_walk9.py`의 `STATIONS`)은 직선 반경 대신 도보 5분(390m)·10분(780m) 안 가게를 보여 줌. 지도에서 초록 걷는 사람 배지로 표시, 위쪽 "시연 9곳" 칩으로 9곳만 볼 수 있음
- 자료: `../analysis/walk_9/walk_routes_9_v2.csv`(팀 확정 규칙 2026-11-20, OSM 보행망 multi × 보정, 카카오 도보 경로값 표본, 보행 1.3 m/s). 지도 칩 = 새 대분류 13개(v3e, 11/22: 식사·간편식·카페·음료·디저트·간식·패션·잡화·식품·편의·뷰티·건강·생활·리빙·취미·문화·기타 소매·유원지·오락·스포츠 서비스 + 공중화장실). `../analysis/reco_tables/reco_tables.json`의 category_map(세원 77 소분류 → 대분류)을 소분류로 붙임. 담배 소매는 뺌. 가게 하나 = 대분류 하나. 직선 반경 화면(도보 자료 없는 충전소)은 위 7개 카테고리 그대로
- `build_walk9.py`: → `data/walk9/<충전소ID>.json`(10분 안 가게, 도보 거리 순), `data/walk9/index.json`(9곳 요약). 경로 미확인(route_status≠ok)은 빼고 개수만 적음, 가게 이름의 전화번호는 가림
- 실행: `~/.venvs/work/bin/python -I build_walk9.py` (`raw/step2/sbiz_서울.csv` 필요)

## 서울 전체 도보 범위 (준비, 자료 받으면 실행)

- `build_walk_seoul.py`: 분석 담당의 서울 전체 도보 경로 CSV → `data/walk_seoul/<충전소ID>.json`, `data/walk_seoul/index.json`(label "서울 도보 n곳", demo = 시연 9곳, 충전소별 kind·stay·low·lowWhy). 가게 처리 방식은 `build_walk9.py`의 `load_routes`·`write_station`을 그대로 씀
- 입력은 `SRC_CANDIDATES`(analysis/walk_seoul_all, walk_seoul_fast) 중 처음 있는 파일, 또는 `--src`
- 화면은 `data/walk_seoul/index.json`이 있으면 그것을, 없으면 `data/walk9`를 씀. 첫 화면 필터 칩 이름도 따라 바뀜("서울 도보 n곳" / "시연 9곳")
- low(도보 시간 추정 정확도 낮음) 판정은 임시안: osm_flag 값이 있거나 10분 안 가게의 30% 넘게 대체·추정 보정인 충전소. 화면 단서 맨 앞에 굵게 표시

## 주변 인프라 추천 (2026-11-22)
- 도보 충전소를 누르면 상세 안에 "지금 다녀올 곳 추천"(페르소나·남은 시간·날씨·시각·키워드 → 카드) + 그 밖의 곳 목록. 공중화장실은 칩·지도·목록에 함께(심야 22~06시는 '상시'만), 쓰레기통은 점수 밖 한 줄 + 지도 켜기.
- 자료: `~/.venvs/work/bin/python -I build_reco.py` → `data/reco/`(tables.json, toilet/, trash/). 점수 = `reco.js`(기준 `analysis/reco_tables/score_reference.py`와 같은 결과)
- v3e(11/22): 가중치 = 대분류, 시간·상황 = 가게 동권 활동(소분류로 정함), 키워드 = 재이가 붙인 소분류 필터. 보여 주기: P1·P2 대분류별 대표 1곳(5), P3 점수순(5), P4a 편의점·카페 테이크아웃·화장실(3), P4b 카드 단위 4개(편의점·카페(테이크아웃·착석 합침)·화장실·빠른 식사 포장, 점수순). 표나 대분류가 바뀌면 `build_walk9.py` → `build_walk_seoul.py` → `build_reco.py` 순서로 다시 만듦
- 도보 파일 `pid`·`wm` 칸은 `build_walk9.py`가 넣음(`build_walk_seoul.py` 다시 실행)
- v5d(11/22): 공원 슬롯 활성. `build_reco.py`가 `../analysis/walk_seoul_all/walk_routes_seoul_park_v2.csv`(10분 안 893행)를 `data/reco/park/<id>.json` [공원ID, 이름, 위도, 경도, 도보 m, 공원유형, 어린이공원 1/0]으로 씀(표 `params.park_status`가 ready·active일 때만). 도보 칩 끝에 '공원'(나무 핀), 목록에도 들어감. 공원 카드 = 이름 + 공원유형(어린이공원이면 배지). 키워드 '산책하고 싶어요' = 공원 필터(가중치 `params.keyword_park_weight`), 비·심야(산책 ×0)면 "비·심야에는 산책을 추천하지 않아요". `build_reco.py`는 `data/reco/station_reco.json`을 지우지 않음

## 충전소 추천 (기본 지도 화면, MVP 3단계 v1, 2026-11-22)
- 표 v1.2(붐빔 v2 + fit을 추천 표 v5d(공원 슬롯)로 다시 계산). 카드는 가로로 넘기는 한 줄(서랍 기본 높이 190px에서 첫 카드의 이름·이유가 보임), 점수 설명은 카드 아래. 정보 입력·다시 입력이 끝나면 패널이 바로 새 페르소나·남은 시간으로 바뀜
- '주변 충전소' 탭 맨 위 "지금 충전하기 좋은 곳" 상위 3곳 카드(이름·채비스테이/급속/완속·이유 한 줄(주변 · 붐빔(참고) · 거리)). 카드를 누르면 그 충전소 상세(주변 인프라 추천)로 감
- 기준 위치 = 내 위치(권한 있을 때) 또는 지도 가운데, 반경 3km 직선. 페르소나·남은 시간 = 추천 설정(정보 입력 화면 기본값), 시각 = 지금
- 자료: `data/reco/station_reco.json`(분석 담당 `analysis/station_reco/score_reference_station.py` 출력을 그대로 복사). 코드: `station_reco.js`(`STRECO`)
- 가중치·반경·상위 몇 곳·붐빔 문구 경계·중립값·도보 자료 없는 충전소 처리(`no_walk_policy`)는 모두 JSON `score`·`reason`에서 읽음 → 규칙이 바뀌면 JSON만 바꾸면 됨
- 남은 시간은 표에 있는 값(지금 30·45분) 중 가장 가까운 값으로 계산(15분 → 30분 표, 60분 → 45분 표, 화면 제목에 표시)
- 붐빔은 4일치(11/8~11) 시간대 평균(v2, 최신 기록 기준)이라 문구에 항상 "(참고)", 관측 3회 미만은 "붐빔 자료 부족"(점수에는 0.5 중립). 하루치(`one_day`)는 "보통"을 빼고 "이 시간대 한산했음(하루 관측·참고)"처럼(JSON `reason.busy_text_one_day`), 2일 이상(`ok`)만 "보통 한산(참고)" 등
- 위쪽 칩(급속·완속만·채비스테이·한가한 곳·붐비는 곳)이 켜져 있으면 지도 목록과 같은 기준으로 후보를 거른 뒤 상위 3곳(점수·순서는 그대로). 3곳 미만이면 "조건에 맞는 충전소가 적어요". 시연·서울 도보 칩과 검색어는 쓰지 않음

## 화면 단계 추가 규칙 (2026-11-22 최종 점검)
- 화장실 '지금 열림' 필터: 개방시간 문자열(상시, HH:MM~HH:MM, 익일, 평일·주말·토요일 등)을 읽어 지금 요일·시각에 닫힌 화장실은 추천 카드 후보에서 뺌(`reco.js` `R.parseOpen`·`R.openState`, 목록·지도에는 그대로 보임). 못 읽는 표기(정시(영업시작~종료)·기타·'9시간'·빈칸 등)는 카드에 "개방시간 확인". 심야 '상시만' 규칙은 그대로. 공원 파일에는 출입 허용시간 칸이 없어 적용 안 함
- 이 필터는 기준 코드 `score_reference.py`에 없는 화면 단계 규칙임. `RECO.recommend`에 `now`를 넘기지 않으면 꺼지고, 꺼진 상태에서 기준 코드와 같은 결과(대조 시 now 없이 비교)
- 동승자 기능 제외(팀 결정 "동승자 추천 및 고려는 제외"): 정보 입력 3문항(Q4 없음), 추천 화면 동승 칩·결과 태그 없음, `tables.json`의 kid·pet·group 상황 규칙은 화면이 켜지 않음(예전 저장값 q4도 무시)
- 정보 입력 '다시 입력'에서 건너뛰기 = 기존 프로필 유지. 첫 실행의 건너뛰기만 P2 기본값
