$deployUrl = 'https://shield-66q9z0la9-alis-projects-635e952f.vercel.app'

Write-Host '=== Testing Live Vercel Deployment ==='
Write-Host "URL: $deployUrl"
Write-Host ''

# Test 1: Homepage
Write-Host '--- [1] Homepage ---'
try {
    $r = Invoke-WebRequest -Uri $deployUrl -UseBasicParsing -TimeoutSec 10
    Write-Host "Status: $($r.StatusCode)"
    Write-Host "Content-Length: $($r.Content.Length) bytes"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

Write-Host ''
Write-Host '--- [2] POST /api/cron/monitor ---'
try {
    $body = '{"customQuery":"live-api-test"}'
    $r = Invoke-WebRequest -Uri "$deployUrl/api/cron/monitor" -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 15
    $preview = $r.Content
    if ($preview.Length -gt 400) { $preview = $preview.Substring(0, 400) }
    Write-Host "Status: $($r.StatusCode)"
    Write-Host "Body: $preview"
} catch {
    $statusCode = $null
    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    Write-Host "HTTP Error: $statusCode"
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errBody = $reader.ReadToEnd()
        if ($errBody.Length -gt 400) { $errBody = $errBody.Substring(0, 400) }
        Write-Host "Error Body: $errBody"
    } catch {
        Write-Host "Could not read error body"
    }
}

Write-Host ''
Write-Host '--- [3] GET /api/cron/monitor ---'
try {
    $r = Invoke-WebRequest -Uri "$deployUrl/api/cron/monitor" -Method GET -UseBasicParsing -TimeoutSec 15
    $preview = $r.Content
    if ($preview.Length -gt 400) { $preview = $preview.Substring(0, 400) }
    Write-Host "Status: $($r.StatusCode)"
    Write-Host "Body: $preview"
} catch {
    $statusCode = $null
    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    Write-Host "HTTP Error: $statusCode"
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errBody = $reader.ReadToEnd()
        if ($errBody.Length -gt 400) { $errBody = $errBody.Substring(0, 400) }
        Write-Host "Error Body: $errBody"
    } catch {
        Write-Host "Could not read error body"
    }
}
