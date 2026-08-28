<#
  주식 기술적 분석 학습 앱 - 과거 OHLCV 데이터 수집 스크립트
  (설명서 7번 "오프라인 데이터 수집" 단계. Python/yfinance 대신 PowerShell + Yahoo Finance chart API 사용)

  사용법:  powershell -ExecutionPolicy Bypass -File tools\fetch-data.ps1
  결과:    data/stocks/{ticker}.json  +  data/stocks/index.json
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'data\stocks'
New-Item -ItemType Directory -Force $outDir | Out-Null

# 수집 대상. market: KR = 원화 정수 가격, US = 달러 소수 2자리
# 수집 대상. market: KR = 원화 정수 가격, US = 달러 소수 4자리
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

  # ── 지수 — 상대강도(종목 ÷ 지수) 계산용. 종목 선택 목록에는 나오지 않는다.
  @{ ticker = '^KS11';     name = '코스피';            market = 'KR'; type = 'index' },
  @{ ticker = '^KQ11';     name = '코스닥';            market = 'KR'; type = 'index' },
  @{ ticker = '^GSPC';     name = 'S&P 500';           market = 'US'; type = 'index' },
  @{ ticker = '^IXIC';     name = '나스닥 종합';       market = 'US'; type = 'index' }
)

# 수집 기간: 2015-01-01 ~ 오늘
$period1 = [int][double]::Parse((Get-Date '2015-01-01Z' -UFormat %s))
$period2 = [int][double]::Parse((Get-Date -UFormat %s))

$epoch = [datetime]'1970-01-01Z'
$index = @()

foreach ($t in $targets) {
  $ticker = $t.ticker
  Write-Host "fetching $ticker ..." -NoNewline
  $url = "https://query1.finance.yahoo.com/v8/finance/chart/$([uri]::EscapeDataString($ticker))?period1=$period1&period2=$period2&interval=1d"

  try {
    $resp = Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'Mozilla/5.0' }
  } catch {
    Write-Host " FAILED ($($_.Exception.Message))" -ForegroundColor Red
    continue
  }

  $res = $resp.chart.result[0]
  $ts = $res.timestamp
  $q  = $res.indicators.quote[0]
  # 국내는 원 단위 정수. 해외는 액면분할 소급 조정 탓에 과거 주가가 $1 미만까지 내려가는
  # 종목(NVDA 등)이 있어 소수 2자리로는 정밀도가 무너진다 → 4자리로 보관.
  $digits = if ($t.market -eq 'KR') { 0 } else { 4 }

  $candles = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $ts.Count; $i++) {
    # 휴장/결측 봉은 제외 (한 값이라도 null이면 버림)
    if ($null -eq $q.open[$i] -or $null -eq $q.high[$i] -or $null -eq $q.low[$i] -or $null -eq $q.close[$i]) { continue }
    $date = $epoch.AddSeconds($ts[$i]).ToString('yyyy-MM-dd')
    $vol = if ($null -eq $q.volume[$i]) { 0 } else { [long]$q.volume[$i] }
    [void]$candles.Add([ordered]@{
      date   = $date
      open   = [math]::Round([double]$q.open[$i],  $digits)
      high   = [math]::Round([double]$q.high[$i],  $digits)
      low    = [math]::Round([double]$q.low[$i],   $digits)
      close  = [math]::Round([double]$q.close[$i], $digits)
      volume = $vol
    })
  }

  $obj = [ordered]@{
    ticker   = $ticker
    name     = $t.name
    market   = $t.market
    type     = $(if ($t.type) { $t.type } else { 'stock' })
    currency = $(if ($t.market -eq 'KR') { 'KRW' } else { 'USD' })
    candles  = $candles
  }

  # '^KS11' 같은 지수 심볼은 URL 에서 다루기 번거로워 파일명에서 ^ 를 _ 로 바꾼다
  $path = Join-Path $outDir (($ticker -replace '\^', '_') + '.json')
  [System.IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host " $($candles.Count) candles -> $(Split-Path -Leaf $path)"

  $index += [ordered]@{
    ticker = $ticker
    name   = $t.name
    market = $t.market
    type   = $(if ($t.type) { $t.type } else { 'stock' })
    from   = $candles[0].date
    to     = $candles[$candles.Count - 1].date
    count  = $candles.Count
  }

  Start-Sleep -Milliseconds 300
}

[System.IO.File]::WriteAllText((Join-Path $outDir 'index.json'), ($index | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`ndone. $($index.Count) tickers -> data/stocks/index.json"
