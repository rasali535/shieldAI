$key = '2e544479-9ec7-46c1-aea7-e894e1efd3bf'
$zone = 'serp_api1'

Write-Host '=== Testing BrightData SERP API (deeper probe) ==='

$body = '{"zone":"serp_api1","url":"https://www.google.com/search?q=data+breach+2024","format":"json"}'

try {
    $r = Invoke-WebRequest `
        -Uri 'https://api.brightdata.com/request' `
        -Method POST `
        -Headers @{ 'Authorization' = "Bearer $key"; 'Content-Type' = 'application/json' } `
        -Body $body `
        -UseBasicParsing `
        -TimeoutSec 30
    Write-Host "Status: $($r.StatusCode)"
    $content = $r.Content
    Write-Host "Response length: $($content.Length)"
    if ($content.Length -gt 1000) { $content = $content.Substring(0, 1000) }
    Write-Host "Response: $content"
} catch {
    $statusCode = $null
    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    Write-Host "HTTP Error: $statusCode"
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errBody = $reader.ReadToEnd()
        if ($errBody.Length -gt 600) { $errBody = $errBody.Substring(0, 600) }
        Write-Host "Error Body: $errBody"
    } catch {
        Write-Host "Could not read error body"
    }
}
