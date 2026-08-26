# DEVELOPMENT.md — 진행 상황

> 집/학교 PC 사이 작업 동기화용 기록 파일입니다.
> **작업을 끝낼 때마다 이 파일을 업데이트**하고 커밋하세요.

## 현재 상태 (2026-08-26)

Phase 1(MVP) 5개 항목 전부 구현 완료. 로컬에서 4개 탭 모두 동작 확인함.

- 저장소: <https://github.com/kinggodyoung5/stockstudy> (branch: main)
- 로컬 경로: `C:\Users\user\projects\stockstudy`
- 배포: 아직 안 함 (다음 단계)

## 완료 항목

- [x] 프로젝트 구조 + 해시 라우터 (`src/main.js`)
- [x] 지표 계산 모듈 (`src/lib/indicators.js`) — SMA/EMA/표준편차/볼린저/일목균형표/교차 판정
- [x] **패턴 자동 탐지 엔진** (`src/lib/patterns.js`) — 7개 규칙, 총 1,624건 검출
      골든크로스 205 · 데드크로스 205 · 정배열 377 · 볼린저 상단이탈 300 · 거래량급증 231 · 구름대돌파 286 · 헤드앤숄더 20
- [x] 개념 학습 탭 6개 (이동평균선 / 골든·데드크로스 / 볼린저밴드 / 거래량 / 일목균형표 / 헤드앤숄더)
- [x] 가상 차트 생성기 (GBM, 변동성·추세·기간 슬라이더, seed 재현)
- [x] 실제 과거 데이터 뷰어 (종목·기간 선택, 지표 토글)
- [x] 구간 맞히기 퀴즈 (정답 공개 + 신호 체크리스트 피드백 + 세션 오답노트)
- [x] 데이터 수집 스크립트 (`tools/fetch-data.ps1`) — 11종목 × 2015~현재
- [x] 패턴 탐지 배치 도구 (`tools/build-patterns.html`)
- [x] 로컬 서버 (`tools/serve.ps1`) — Node/Python 없이 동작

## 다음 할 일

- [ ] 배포 (GitHub Pages 또는 Vercel). 정적 사이트라 빌드 설정 불필요 — Framework Preset: Other
- [ ] 종목 추가 (현재 11개). `tools/fetch-data.ps1` 의 `$targets` 배열에 추가 후 재실행
- [ ] Phase 2 지표: RSI, MACD, 스토캐스틱 (`indicators.js` 에 함수 추가 → `patterns.js` 에 규칙 추가 → 배치 재실행 → `lessons.js` 에 탭 추가, 이 4단계면 끝)
- [ ] 오답노트 영구 저장 (localStorage)

## 주의사항

- **`file://` 로 열면 동작하지 않습니다.** ES 모듈 + fetch를 쓰므로 반드시 로컬 서버로 띄우세요.
  ```
  powershell -ExecutionPolicy Bypass -File tools\serve.ps1
  ```
- `tools/serve.ps1` 에는 개발용 POST `/_write` 엔드포인트가 있습니다. `data/patterns/*.json` 에만
  쓸 수 있고 localhost 전용입니다. 배포본에는 이 스크립트가 실행되지 않으므로 영향 없습니다.
- **PowerShell 스크립트(.ps1)는 UTF-8 BOM 으로 저장해야 합니다.** Windows PowerShell 5.1은 BOM이
  없으면 한글을 CP949로 잘못 읽어 파싱 에러가 납니다. JSON 파일은 반대로 BOM 없이 저장합니다.
- 해외 종목 주가는 액면분할 소급 조정 탓에 과거 값이 $1 미만까지 내려갑니다(NVDA 등).
  그래서 `fetch-data.ps1` 은 해외 종목을 소수 **4자리**로 저장합니다. 2자리로 줄이면 정밀도가 무너집니다.
- 차트 생성은 컨테이너가 DOM에 붙은 뒤 **동기적으로** 호출합니다. `requestAnimationFrame` 은
  탭이 화면에 보이지 않으면 실행되지 않아 차트가 빈 채로 남습니다.

## 나중에 React + Vite 로 옮길 때

지금 구조는 그 전환을 염두에 두고 나눠져 있습니다.

- `src/lib/*` — 순수 함수 ES 모듈. DOM 의존 없음. **그대로 복사해서 재사용**
- `src/content/lessons.js` — 데이터. 그대로 재사용
- `src/views/*` — 이 폴더만 JSX로 다시 작성
- `src/lib/chart.js` — `useEffect` 안으로 옮기면 됨

전환 시 필요한 것: Node.js 설치 → `npm create vite` → `npm i lightweight-charts` →
`vendor/` 스크립트 태그 대신 import 로 교체.

## 다른 PC에서 처음 이어받을 때

```
git clone https://github.com/kinggodyoung5/stockstudy.git
cd stockstudy
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

데이터(`data/`)도 저장소에 함께 들어 있으므로 별도 수집 없이 바로 실행됩니다.
