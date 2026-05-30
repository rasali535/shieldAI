try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/cron/monitor' -Method POST -Body '{}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30
    Write-Host "STATUS: $($r.StatusCode)"
    Write-Host "BODY: $($r.Content)"
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $code = [int]$resp.StatusCode
        Write-Host "STATUS: $code"
        $stream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        Write-Host "BODY: $body"
    } else {
        Write-Host "ERROR (no HTTP response): $($_.Exception.Message)"
    }
}
