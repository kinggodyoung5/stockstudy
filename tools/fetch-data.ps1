<#
  주식 기술적 분석 학습 앱 - 과거 OHLCV 데이터 수집 스크립트
  (설명서 7번 "오프라인 데이터 수집" 단계. Python/yfinance 대신 PowerShell + Yahoo Finance chart API 사용)

  사용법
    전체 재수집:  powershell -ExecutionPolicy Bypass -File tools\fetch-data.ps1
    증분 갱신:    powershell -ExecutionPolicy Bypass -File tools\fetch-data.ps1 -Append
    일부만:       powershell -ExecutionPolicy Bypass -File tools\fetch-data.ps1 -Only '005930.KS,AAPL'

  결과: data/stocks/{ticker}.json  +  data/stocks/index.json

  ── 저장 형식 (format 2) ─────────────────────────────────────────────
  캔들을 객체가 아니라 배열로 저장한다. 필드 순서는 fields 에 적혀 있다.

    {"ticker":"005930.KS", ..., "format":2,
     "fields":["date","open","high","low","close","volume"],
     "candles":[["2015-01-02",26800,26800,26540,26600,8774950], ...]}

  객체 형식은 캔들 하나당 92바이트인데 키 이름이 매번 반복된다. 배열로 바꾸면 47바이트로
  절반이 된다. 종목을 계속 늘릴 계획이라 이 차이가 그대로 저장소 용량이 된다.
  앱 쪽은 src/lib/data.js 가 불러오는 시점에 객체로 되돌려주므로, 나머지 코드는
  기존 {date, open, high, low, close, volume} 형태를 그대로 쓴다.
#>
param(
  [switch]$Append,          # 기존 파일 뒤에 새 봉만 이어붙인다 (git 이력이 덜 커진다)
  [string]$Only = '',       # 쉼표로 구분한 티커만 처리
  [string]$From = '2015-01-01'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'data\stocks'
New-Item -ItemType Directory -Force $outDir | Out-Null

# 수집 대상. market: KR = 원화 정수 가격, US = 달러 (아래 Get-Digits 가 자릿수를 정함)
#
# 종목 선정 원칙: **일부러 부진했던 종목을 많이 섞는다.**
# 지금 시점에서 유명한 회사만 고르면 "살아남아 크게 오른 회사들"만 남아(생존 편향)
# 모든 신호의 통계가 실제보다 좋게 나온다. 고점 대비 반토막 난 종목, 테마로 급등했다
# 급락한 종목, 장기 횡보한 종목을 함께 넣어야 기준선과 승률이 정직해진다.
$targets = @(
  # ── 국내 대형주 ────────────────────────────────
  @{ ticker = '005930.KS'; name = '삼성전자';          market = 'KR' },
  @{ ticker = '000660.KS'; name = 'SK하이닉스';        market = 'KR' },
  @{ ticker = '005380.KS'; name = '현대차';            market = 'KR' },
  @{ ticker = '000270.KS'; name = '기아';              market = 'KR' },
  @{ ticker = '207940.KS'; name = '삼성바이오로직스';  market = 'KR' },
  @{ ticker = '068270.KS'; name = '셀트리온';          market = 'KR' },
  @{ ticker = '012330.KS'; name = '현대모비스';        market = 'KR' },
  @{ ticker = '028260.KS'; name = '삼성물산';          market = 'KR' },
  @{ ticker = '066570.KS'; name = 'LG전자';            market = 'KR' },
  @{ ticker = '009150.KS'; name = '삼성전기';          market = 'KR' },
  @{ ticker = '105560.KS'; name = 'KB금융';            market = 'KR' },
  @{ ticker = '055550.KS'; name = '신한지주';          market = 'KR' },
  @{ ticker = '316140.KS'; name = '우리금융지주';      market = 'KR' },
  @{ ticker = '017670.KS'; name = 'SK텔레콤';          market = 'KR' },
  @{ ticker = '030200.KS'; name = 'KT';                market = 'KR' },
  @{ ticker = '010950.KS'; name = 'S-Oil';             market = 'KR' },
  @{ ticker = '010130.KS'; name = '고려아연';          market = 'KR' },
  @{ ticker = '034020.KS'; name = '두산에너빌리티';    market = 'KR' },
  @{ ticker = '042700.KS'; name = '한미반도체';        market = 'KR' },

  # ── 국내: 고점 대비 크게 밀렸거나 오래 부진한 종목 ──
  @{ ticker = '035420.KS'; name = 'NAVER';             market = 'KR' },
  @{ ticker = '035720.KS'; name = '카카오';            market = 'KR' },
  @{ ticker = '051910.KS'; name = 'LG화학';            market = 'KR' },
  @{ ticker = '006400.KS'; name = '삼성SDI';           market = 'KR' },
  @{ ticker = '373220.KS'; name = 'LG에너지솔루션';    market = 'KR' },
  @{ ticker = '096770.KS'; name = 'SK이노베이션';      market = 'KR' },
  @{ ticker = '015760.KS'; name = '한국전력';          market = 'KR' },
  @{ ticker = '011200.KS'; name = 'HMM';               market = 'KR' },
  @{ ticker = '003670.KS'; name = '포스코퓨처엠';      market = 'KR' },
  @{ ticker = '302440.KS'; name = 'SK바이오사이언스';  market = 'KR' },
  @{ ticker = '251270.KS'; name = '넷마블';            market = 'KR' },
  @{ ticker = '018260.KS'; name = '삼성에스디에스';    market = 'KR' },

  # ── 코스닥 (테마 급등락 포함) ────────────────────
  @{ ticker = '247540.KQ'; name = '에코프로비엠';      market = 'KR' },
  @{ ticker = '086520.KQ'; name = '에코프로';          market = 'KR' },
  @{ ticker = '263750.KQ'; name = '펄어비스';          market = 'KR' },
  @{ ticker = '293490.KQ'; name = '카카오게임즈';      market = 'KR' },
  @{ ticker = '112040.KQ'; name = '위메이드';          market = 'KR' },
  @{ ticker = '041510.KQ'; name = '에스엠';            market = 'KR' },
  @{ ticker = '058470.KQ'; name = '리노공업';          market = 'KR' },
  @{ ticker = '240810.KQ'; name = '원익IPS';           market = 'KR' },
  @{ ticker = '137310.KQ'; name = '에스디바이오센서';  market = 'KR' },

  # ── 해외 대형주 ────────────────────────────────
  @{ ticker = 'AAPL';      name = 'Apple';             market = 'US' },
  @{ ticker = 'MSFT';      name = 'Microsoft';         market = 'US' },
  @{ ticker = 'NVDA';      name = 'NVIDIA';            market = 'US' },
  @{ ticker = 'GOOGL';     name = 'Alphabet';          market = 'US' },
  @{ ticker = 'AMZN';      name = 'Amazon';            market = 'US' },
  @{ ticker = 'META';      name = 'Meta';              market = 'US' },
  @{ ticker = 'TSLA';      name = 'Tesla';             market = 'US' },
  @{ ticker = 'AMD';       name = 'AMD';               market = 'US' },
  @{ ticker = 'MU';        name = 'Micron';            market = 'US' },
  @{ ticker = 'QCOM';      name = 'Qualcomm';          market = 'US' },
  @{ ticker = 'NFLX';      name = 'Netflix';           market = 'US' },
  @{ ticker = 'JNJ';       name = 'Johnson & Johnson'; market = 'US' },
  @{ ticker = 'KO';        name = 'Coca-Cola';         market = 'US' },
  @{ ticker = 'XOM';       name = 'Exxon Mobil';       market = 'US' },

  # ── 해외: 고점 대비 크게 밀렸던 종목 ──────────────
  @{ ticker = 'INTC';      name = 'Intel';             market = 'US' },
  @{ ticker = 'BA';        name = 'Boeing';            market = 'US' },
  @{ ticker = 'DIS';       name = 'Disney';            market = 'US' },
  @{ ticker = 'PYPL';      name = 'PayPal';            market = 'US' },
  @{ ticker = 'NKE';       name = 'Nike';              market = 'US' },
  @{ ticker = 'PFE';       name = 'Pfizer';            market = 'US' },
  @{ ticker = 'SBUX';      name = 'Starbucks';         market = 'US' },
  @{ ticker = 'T';         name = 'AT&T';              market = 'US' },
  @{ ticker = 'F';         name = 'Ford';              market = 'US' },
  @{ ticker = 'ZM';        name = 'Zoom';              market = 'US' },
  @{ ticker = 'SNAP';      name = 'Snap';              market = 'US' },

  # ── 코스닥 중소형 (게임·엔터·바이오·반도체 소재장비) ──
  @{ ticker = '035900.KQ'; name = 'JYP Ent.';           market = 'KR' },
  @{ ticker = '122870.KQ'; name = '와이지엔터테인먼트';  market = 'KR' },
  @{ ticker = '067160.KQ'; name = 'SOOP';               market = 'KR' },
  @{ ticker = '095660.KQ'; name = '네오위즈';           market = 'KR' },
  @{ ticker = '194480.KQ'; name = '데브시스터즈';       market = 'KR' },
  @{ ticker = '078340.KQ'; name = '컴투스';             market = 'KR' },
  @{ ticker = '063080.KQ'; name = '컴투스홀딩스';       market = 'KR' },
  @{ ticker = '042000.KQ'; name = '카페24';             market = 'KR' },
  @{ ticker = '060250.KQ'; name = 'NHN KCP';            market = 'KR' },
  @{ ticker = '214150.KQ'; name = '클래시스';           market = 'KR' },
  @{ ticker = '214450.KQ'; name = '파마리서치';         market = 'KR' },
  @{ ticker = '145020.KQ'; name = '휴젤';               market = 'KR' },
  @{ ticker = '196170.KQ'; name = '알테오젠';           market = 'KR' },
  @{ ticker = '328130.KQ'; name = '루닛';               market = 'KR' },
  @{ ticker = '141080.KQ'; name = '리가켐바이오';       market = 'KR' },
  @{ ticker = '237690.KQ'; name = '에스티팜';           market = 'KR' },
  @{ ticker = '086900.KQ'; name = '메디톡스';           market = 'KR' },
  @{ ticker = '214370.KQ'; name = '케어젠';             market = 'KR' },
  @{ ticker = '039030.KQ'; name = '이오테크닉스';       market = 'KR' },
  @{ ticker = '036930.KQ'; name = '주성엔지니어링';     market = 'KR' },
  @{ ticker = '084370.KQ'; name = '유진테크';           market = 'KR' },
  @{ ticker = '095610.KQ'; name = '테스';               market = 'KR' },
  @{ ticker = '104830.KQ'; name = '원익머트리얼즈';     market = 'KR' },
  @{ ticker = '073640.KQ'; name = '테크윙';             market = 'KR' },
  @{ ticker = '131970.KQ'; name = '두산테스나';         market = 'KR' },
  @{ ticker = '178320.KQ'; name = '서진시스템';         market = 'KR' },
  @{ ticker = '032500.KQ'; name = '케이엠더블유';       market = 'KR' },
  @{ ticker = '046890.KQ'; name = '서울반도체';         market = 'KR' },
  @{ ticker = '277810.KQ'; name = '레인보우로보틱스';   market = 'KR' },
  @{ ticker = '348370.KQ'; name = '엔켐';               market = 'KR' },
  @{ ticker = '065350.KQ'; name = '신성델타테크';       market = 'KR' },
  @{ ticker = '200130.KQ'; name = '콜마비앤에이치';     market = 'KR' },
  @{ ticker = '018290.KQ'; name = '브이티';             market = 'KR' },

  # ── 코스피 중형 (조선·방산 급등 / 건설·유통·화학 부진) ──
  @{ ticker = '042660.KS'; name = '한화오션';           market = 'KR' },
  @{ ticker = '010140.KS'; name = '삼성중공업';         market = 'KR' },
  @{ ticker = '009540.KS'; name = 'HD한국조선해양';     market = 'KR' },
  @{ ticker = '012450.KS'; name = '한화에어로스페이스'; market = 'KR' },
  @{ ticker = '079550.KS'; name = 'LIG넥스원';          market = 'KR' },
  @{ ticker = '064350.KS'; name = '현대로템';           market = 'KR' },
  @{ ticker = '272210.KS'; name = '한화시스템';         market = 'KR' },
  @{ ticker = '000720.KS'; name = '현대건설';           market = 'KR' },
  @{ ticker = '047040.KS'; name = '대우건설';           market = 'KR' },
  @{ ticker = '139480.KS'; name = '이마트';             market = 'KR' },
  @{ ticker = '069960.KS'; name = '현대백화점';         market = 'KR' },
  @{ ticker = '008770.KS'; name = '호텔신라';           market = 'KR' },
  @{ ticker = '021240.KS'; name = '코웨이';             market = 'KR' },
  @{ ticker = '271560.KS'; name = '오리온';             market = 'KR' },
  @{ ticker = '097950.KS'; name = 'CJ제일제당';         market = 'KR' },
  @{ ticker = '011170.KS'; name = '롯데케미칼';         market = 'KR' },
  @{ ticker = '034220.KS'; name = 'LG디스플레이';       market = 'KR' },
  @{ ticker = '036570.KS'; name = '엔씨소프트';         market = 'KR' },
  @{ ticker = '161390.KS'; name = '한국타이어';         market = 'KR' },
  # ── 지수 — 상대강도(종목 ÷ 지수) 계산용. 종목 선택 목록에는 나오지 않는다.
  @{ ticker = '^KS11';     name = '코스피';            market = 'KR'; type = 'index' },
  @{ ticker = '^KQ11';     name = '코스닥';            market = 'KR'; type = 'index' },
  @{ ticker = '^GSPC';     name = 'S&P 500';           market = 'US'; type = 'index' },
  @{ ticker = '^IXIC';     name = '나스닥 종합';       market = 'US'; type = 'index' }
)

$allOrder = @($targets | ForEach-Object { $_.ticker })

if ($Only) {
  $wanted = $Only -split ',' | ForEach-Object { $_.Trim() }
  $targets = @($targets | Where-Object { $wanted -contains $_.ticker })
  Write-Host "대상 $($targets.Count)개만 처리합니다."
}

$epoch = [datetime]'1970-01-01Z'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# '^KS11' 같은 지수 심볼은 URL 에서 다루기 번거로워 파일명에서 ^ 를 _ 로 바꾼다
function Get-DataPath([string]$ticker) {
  Join-Path $outDir (($ticker -replace '\^', '_') + '.json')
}

# 소수 자릿수: 액면분할 소급 조정 탓에 과거 주가가 $1 미만인 종목(NVDA 등)이 있어
# 일률적으로 2자리로 줄이면 정밀도가 무너진다. 반대로 $200짜리 종목에 4자리는 낭비다.
# 그래서 그 종목의 최저가를 보고 한 번만 정한다 (한 파일 안에서는 자릿수가 일정하다).
function Get-Digits([string]$market, [double]$minPrice) {
  if ($market -eq 'KR') { return 0 }
  if ($minPrice -lt 10) { return 4 }
  if ($minPrice -lt 100) { return 3 }
  return 2
}

function Get-Chart([string]$ticker, [int]$p1, [int]$p2) {
  $url = "https://query1.finance.yahoo.com/v8/finance/chart/$([uri]::EscapeDataString($ticker))?period1=$p1&period2=$p2&interval=1d"
  Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'Mozilla/5.0' }
}

$defaultP1 = [int][double]::Parse((Get-Date ($From + 'Z') -UFormat %s))
$period2 = [int][double]::Parse((Get-Date -UFormat %s))

$index = @()
$processed = 0
$totalBytes = 0
$totalCandles = 0

foreach ($t in $targets) {
  $ticker = $t.ticker
  $path = Get-DataPath $ticker
  Write-Host ("{0,-12}" -f $ticker) -NoNewline

  # ── 증분 갱신: 기존 파일의 마지막 날짜 다음부터만 받는다 ──
  $existingRows = @()
  $period1 = $defaultP1
  if ($Append -and (Test-Path $path)) {
    try {
      $old = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($old.format -eq 2 -and $old.candles.Count -gt 0) {
        $existingRows = @($old.candles)
        $lastDate = [datetime]::ParseExact($existingRows[-1][0], 'yyyy-MM-dd', $null)
        $period1 = [int]($lastDate.AddDays(1) - $epoch).TotalSeconds
      }
    } catch {
      Write-Host " (기존 파일을 읽지 못해 전체 재수집)" -NoNewline -ForegroundColor DarkYellow
      $existingRows = @()
      $period1 = $defaultP1
    }
  }

  $rows = @()
  if ($period1 -ge $period2) {
    Write-Host " 이미 최신 " -NoNewline -ForegroundColor DarkGray
    $rows = $existingRows
  } else {
    $resp = $null
    try {
      $resp = Get-Chart $ticker $period1 $period2
    } catch {
      # -Append 로 꼬리만 받는 중이라면, 새 봉 요청이 실패해도 기존 데이터는 멀쩡하다.
      # 여기서 continue 해버리면 그 종목이 index.json 에서 통째로 빠진다.
      if ($existingRows.Count -gt 0) {
        Write-Host " 새 봉 요청 실패 — 기존 데이터 유지 " -NoNewline -ForegroundColor DarkYellow
        $resp = $null
      } else {
        Write-Host " 실패 ($($_.Exception.Message))" -ForegroundColor Red
        continue
      }
    }

    $res = if ($resp) { $resp.chart.result[0] } else { $null }
    if ($null -eq $res -or $null -eq $res.timestamp) {
      if ($existingRows.Count -gt 0) {
        Write-Host " 새 봉 없음 " -NoNewline -ForegroundColor DarkGray
        $rows = $existingRows
      } else {
        Write-Host " 응답에 데이터 없음" -ForegroundColor Yellow
        continue
      }
    } else {
      $ts = $res.timestamp
      $q = $res.indicators.quote[0]

      # 자릿수를 정하려면 최저가를 먼저 알아야 한다
      $minPrice = [double]::MaxValue
      for ($i = 0; $i -lt $ts.Count; $i++) {
        if ($null -ne $q.low[$i] -and [double]$q.low[$i] -lt $minPrice) { $minPrice = [double]$q.low[$i] }
      }
      # 이어붙이는 경우 기존 값까지 봐야 한 파일 안에서 정밀도가 일정하다
      foreach ($r in $existingRows) { if ([double]$r[3] -lt $minPrice) { $minPrice = [double]$r[3] } }
      $digits = Get-Digits $t.market $minPrice

      $newRows = New-Object System.Collections.ArrayList
      for ($i = 0; $i -lt $ts.Count; $i++) {
        # 휴장/결측 봉은 제외 (한 값이라도 null 이면 버림)
        if ($null -eq $q.open[$i] -or $null -eq $q.high[$i] -or $null -eq $q.low[$i] -or $null -eq $q.close[$i]) { continue }
        $date = $epoch.AddSeconds($ts[$i]).ToString('yyyy-MM-dd')
        $vol = if ($null -eq $q.volume[$i]) { 0 } else { [long]$q.volume[$i] }
        [void]$newRows.Add(@(
          $date,
          [math]::Round([double]$q.open[$i],  $digits),
          [math]::Round([double]$q.high[$i],  $digits),
          [math]::Round([double]$q.low[$i],   $digits),
          [math]::Round([double]$q.close[$i], $digits),
          $vol
        ))
      }

      if ($existingRows.Count -gt 0) {
        $lastKept = $existingRows[-1][0]
        $appendOnly = @($newRows | Where-Object { $_[0] -gt $lastKept })
        $rows = @($existingRows) + $appendOnly
        Write-Host (" +{0}봉 " -f $appendOnly.Count) -NoNewline -ForegroundColor DarkGreen
      } else {
        $rows = @($newRows)
      }
    }
  }

  if ($rows.Count -eq 0) { Write-Host " 봉 없음" -ForegroundColor Yellow; continue }

  $obj = [ordered]@{
    ticker   = $ticker
    name     = $t.name
    market   = $t.market
    currency = $(if ($t.market -eq 'KR') { 'KRW' } else { 'USD' })
    type     = $(if ($t.type) { $t.type } else { 'stock' })
    format   = 2
    fields   = @('date', 'open', 'high', 'low', 'close', 'volume')
    candles  = $rows
  }

  $json = $obj | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText($path, $json, $utf8NoBom)

  $processed++
  $totalBytes += $json.Length
  $totalCandles += $rows.Count
  Write-Host (" {0,5}봉  {1,6:N0} KB" -f $rows.Count, ($json.Length / 1KB)) -NoNewline
  # 데이터가 거의 없는 티커는 잘못된 종목코드일 가능성이 높다
  if ($rows.Count -lt 300) { Write-Host "  ← 봉이 너무 적습니다. 종목코드를 확인하세요" -ForegroundColor Yellow } else { Write-Host "" }

  $index += [ordered]@{
    ticker = $ticker
    name   = $t.name
    market = $t.market
    type   = $(if ($t.type) { $t.type } else { 'stock' })
    from   = $rows[0][0]
    to     = $rows[-1][0]
    count  = $rows.Count
  }

  Start-Sleep -Milliseconds 250
}

if ($index.Count -eq 0) {
  Write-Host "`n처리된 종목이 없어 index.json 을 갱신하지 않습니다." -ForegroundColor Yellow
  return
}

# -Only 로 일부만 돌린 경우, 기존 index 의 나머지 항목을 보존한다
$indexPath = Join-Path $outDir 'index.json'
if ($Only -and (Test-Path $indexPath)) {
  $prev = Get-Content $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $touched = $index | ForEach-Object { $_.ticker }
  $kept = @($prev | Where-Object { $touched -notcontains $_.ticker })
  $merged = @($kept) + @($index)
  # 목록 순서는 $targets 를 따른다 (종목 선택 드롭다운 순서가 흔들리지 않게)
  $index = @($merged | Sort-Object { $allOrder.IndexOf($_.ticker) })
}

[System.IO.File]::WriteAllText($indexPath, ($index | ConvertTo-Json -Depth 4 -Compress), $utf8NoBom)

$avg = if ($totalCandles) { $totalBytes / $totalCandles } else { 0 }
Write-Host ""
Write-Host ("이번 실행: {0}개 · {1:N0}봉 · {2:N1} MB (캔들당 {3:N0} 바이트)" -f `
  $processed, $totalCandles, ($totalBytes / 1MB), $avg)
Write-Host ("목록 전체: {0}개 (index.json)" -f $index.Count)

# 앞으로 종목을 늘릴 때를 대비해 예상 용량을 항상 알려준다
$perTicker = if ($processed) { $totalBytes / $processed / 1MB } else { 0 }
$allBytes = (Get-ChildItem (Join-Path $outDir "*.json") | Measure-Object Length -Sum).Sum
Write-Host ("현재 data/stocks 총 {0:N1} MB · 종목당 평균 {1:N2} MB" -f ($allBytes / 1MB), $perTicker)
Write-Host ("예상 용량 — 200개: 약 {0:N0} MB · 500개: 약 {1:N0} MB · 1000개: 약 {2:N0} MB" -f `
  ($perTicker * 200), ($perTicker * 500), ($perTicker * 1000))
if ($allBytes / 1MB -gt 200) {
  Write-Host "경고: data/stocks 가 200MB 를 넘었습니다. 저장소 분리나 기간 단축을 검토하세요." -ForegroundColor Yellow
}
