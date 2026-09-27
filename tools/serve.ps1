<#
  로컬 정적 서버 (Node/Python 없이 동작)

  이 앱은 ES 모듈과 fetch를 쓰기 때문에 file:// 로 열면 동작하지 않는다.
  반드시 http:// 로 열어야 한다.

  사용법:  powershell -ExecutionPolicy Bypass -File tools\serve.ps1
  종료:    Ctrl+C
#>
param(
  [int]$Port = 8123,
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.woff2' = 'font/woff2'
  '.md'   = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "serving $Root"
Write-Host "  -> http://localhost:$Port/"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)

      # 생성은 Node CLI 한 경로만 사용한다. 브라우저에서 저장 파일을 덮어쓰지 않는다.
      if ($ctx.Request.HttpMethod -notin @('GET', 'HEAD')) {
        $res.StatusCode = 405
        $res.Headers.Add('Allow', 'GET, HEAD')
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')
        $res.ContentType = 'text/plain; charset=utf-8'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        continue   # 응답 종료는 아래 finally 의 $res.Close() 가 처리한다
      }

      if ($rel -eq '/' -or $rel.EndsWith('/')) { $rel += 'index.html' }
      $path = Join-Path $Root ($rel.TrimStart('/') -replace '/', '\')

      # 루트 밖으로 나가는 경로 차단
      $full = [System.IO.Path]::GetFullPath($path)
      $rootPrefix = $Root.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
      if (-not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found: ' + $rel)
        $res.ContentType = 'text/plain; charset=utf-8'
      } else {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
        $res.Headers.Add('Cache-Control', 'no-store')
        $bytes = [System.IO.File]::ReadAllBytes($full)
      }
      $res.ContentLength64 = $bytes.Length
      if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      Write-Host ("{0} {1}" -f $res.StatusCode, $rel)
    } catch {
      Write-Host ("ERR " + $_.Exception.Message) -ForegroundColor Red
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
