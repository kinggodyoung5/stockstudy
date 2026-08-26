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
$targets = @(
  @{ ticker = '005930.KS'; name = '삼성전자';        market = 'KR' },
  @{ ticker = '000660.KS'; name = 'SK하이닉스';      market = 'KR' },
  @{ ticker = '035420.KS'; name = 'NAVER';           market = 'KR' },
  @{ ticker = '005380.KS'; name = '현대차';          market = 'KR' },
  @{ ticker = '035720.KS'; name = '카카오';          market = 'KR' },
  @{ ticker = '051910.KS'; name = 'LG화학';          market = 'KR' },
  @{ ticker = '247540.KQ'; name = '에코프로비엠';    market = 'KR' },
  @{ ticker = 'AAPL';      name = 'Apple';           market = 'US' },
  @{ ticker = 'MSFT';      name = 'Microsoft';       market = 'US' },
  @{ ticker = 'NVDA';      name = 'NVIDIA';          market = 'US' },
  @{ ticker = 'TSLA';      name = 'Tesla';           market = 'US' }
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
    currency = $(if ($t.market -eq 'KR') { 'KRW' } else { 'USD' })
    candles  = $candles
  }

  $path = Join-Path $outDir ($ticker + '.json')
  [System.IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host " $($candles.Count) candles -> data/stocks/$ticker.json"

  $index += [ordered]@{
    ticker = $ticker
    name   = $t.name
    market = $t.market
    from   = $candles[0].date
    to     = $candles[$candles.Count - 1].date
    count  = $candles.Count
  }

  Start-Sleep -Milliseconds 300
}

[System.IO.File]::WriteAllText((Join-Path $outDir 'index.json'), ($index | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`ndone. $($index.Count) tickers -> data/stocks/index.json"
