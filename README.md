# 차트 읽는 법 — 주식 기술적 분석 학습 앱

기술적 분석(차트 읽는 법)을 배우는 **교육용** 웹앱입니다.
실시간 시세 연동·매매 기능·종목 추천은 없습니다.

> 개념을 배우고 → 가상 차트로 감을 익히고 → 실제 과거 데이터로 눈을 훈련하고 → 퀴즈로 검증한다.

## 화면 구성

| 탭 | 하는 일 |
|---|---|
| **개념 학습** | 지표·패턴 6종의 개념 설명 + **판정 기준 공개** + 탐지 엔진이 실제 과거 데이터에서 자동으로 찾아낸 사례 차트 + 근거 수치 + 그 이후 실제 결과 |
| **가상 차트** | 기하 브라운 운동(GBM) 기반 랜덤 캔들 생성. 변동성·추세·기간을 직접 조절 |
| **데이터 뷰어** | 종목·기간 선택 후 지표를 켜고 끄며 비교 |
| **퀴즈** | 실제 과거 구간의 앞부분만 보고 다음 20거래일 방향 맞히기. 오답노트 포함 |

다루는 지표·패턴: 이동평균선, 골든/데드크로스, 볼린저밴드, 거래량, 일목균형표(구름대), 헤드앤숄더

## 실행 방법

이 앱은 ES 모듈과 `fetch`를 사용하므로 **`file://` 로 열면 동작하지 않습니다.** 로컬 서버가 필요합니다.

```bash
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

띄운 뒤 <http://localhost:8123> 으로 접속하세요. (Node.js·Python 없이 PowerShell만으로 동작합니다)

## 기술 스택

- **빌드 도구 없음** — 순수 ES 모듈 + `lightweight-charts`(TradingView 오픈소스, `vendor/`에 직접 포함)
- 지표는 저장하지 않고 원시 OHLCV에서 **프론트엔드가 즉석 계산**
- 데이터는 정적 JSON. 종목 파일은 선택할 때 그때그때 fetch

CDN을 쓰지 않으므로 오프라인·차단 환경에서도 그대로 동작합니다.

## 폴더 구조

```
index.html            앱 셸
styles.css
src/
  main.js             해시 라우터 (#/learn/{id} · #/sandbox · #/viewer · #/quiz)
  lib/                ── 순수 로직 (DOM 의존 없음, 나중에 React로 옮겨도 그대로 재사용)
    indicators.js       이동평균·볼린저·일목균형표 등 지표 계산
    patterns.js         패턴 자동 탐지 규칙 ★핵심
    gbm.js              가상 차트 생성기
    data.js             정적 JSON 로더 + 캐시
    chart.js            lightweight-charts 래퍼
    ui.js               작은 DOM 헬퍼
  views/              ── 화면 (React 전환 시 이 폴더만 다시 씀)
  content/lessons.js  개념 설명 텍스트
data/
  stocks/{ticker}.json    원시 일봉 (2015~현재, 11종목)
  patterns/{pattern}.json 미리 계산된 탐지 결과
tools/
  serve.ps1           로컬 정적 서버
  fetch-data.ps1      주가 데이터 수집
  build-patterns.html 패턴 탐지 배치 실행
```

## 패턴 판정은 어떻게 이루어지나

**AI의 느낌이 아니라 코드에 적힌 정량 조건만으로 판정합니다.** 규칙은 전부
[`src/lib/patterns.js`](src/lib/patterns.js) 의 `PATTERNS` 에 있고, 앱 화면의 "판정 기준" 박스에
그대로 노출됩니다. 각 사례는 조건을 만족한 근거 수치를 함께 보여주므로 언제든 역추적할 수 있습니다.

경계가 애매한 후보는 조건을 엄격하게 잡아 아예 제외합니다 (정확한 소수 사례 > 애매한 다수 사례).
그래서 헤드앤숄더처럼 까다로운 패턴은 11종목 11년치에서 20건만 검출됩니다.

## 데이터 갱신 절차

1. `powershell -ExecutionPolicy Bypass -File tools\fetch-data.ps1` — Yahoo Finance에서 일봉 수집
2. 로컬 서버를 띄우고 <http://localhost:8123/tools/build-patterns.html> 접속 → "탐지 실행 후 저장"
3. 변경된 `data/` 를 커밋

탐지 규칙(`src/lib/patterns.js`)을 고쳤을 때도 2번을 다시 실행해야 학습 탭에 반영됩니다.

## 면책

학습용 도구입니다. 종목 추천이나 매매 신호를 제공하지 않으며, 과거 데이터가 미래를 보장하지 않습니다.
