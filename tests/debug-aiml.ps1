$envContent = Get-Content 'c:\Users\user\OneDrive\Desktop\shield Ai\.env'
$keyLine = $envContent | Where-Object { $_ -match '^AIML_API_KEY=' }
$key = $keyLine -replace '^AIML_API_KEY=', ''
Write-Host "Key prefix: $($key.Substring(0, [Math]::Min(8, $key.Length)))"
Write-Host "Key length: $($key.Length)"

$body = '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Reply with: hello"}],"temperature":0}'

try {
    $response = Invoke-WebRequest `
        -Uri 'https://api.aimlapi.com/v1/chat/completions' `
        -Method POST `
        -Headers @{ 'Authorization' = "Bearer $key"; 'Content-Type' = 'application/json' } `
        -Body $body `
        -UseBasicParsing
    Write-Host "HTTP Status: $($response.StatusCode)"
    Write-Host "Response: $($response.Content.Substring(0, [Math]::Min(600, $response.Content.Length)))"
} catch {
    Write-Host "Error Status: $($_.Exception.Response.StatusCode.value__)"
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errorBody = $reader.ReadToEnd()
    Write-Host "Error Body: $($errorBody.Substring(0, [Math]::Min(600, $errorBody.Length)))"
}
