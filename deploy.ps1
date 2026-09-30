# 部署「日語隨身練」的推播伺服器到 Cloudflare
#
# 網頁本身在 GitHub Pages，不用這個。這裡只架「每天送三句」的推播伺服器。
# 跟工地氣象站用同一個 Cloudflare 帳號。
#
# 順序：
#   1. 登入（這一步不能有管道，否則 wrangler 會判定為非互動而拒絕開瀏覽器）
#   2. 建立存訂閱資料的 KV（只有第一次）
#   3. 產生推播金鑰（只有第一次，存在 .env，之後沿用；換金鑰的話已訂閱的手機會收不到）
#   4. 部署
#   5. 上傳金鑰

$ErrorActionPreference = 'Continue'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $proj

function Say($msg, $color = 'Gray') { Write-Host "   $msg" -ForegroundColor $color }
function Fail($msg) {
    Write-Host ''
    Say $msg 'Red'
    Read-Host '按 Enter 關閉'; exit 1
}

Write-Host ''
Say '部署日語隨身練 推播伺服器到 Cloudflare' 'Cyan'
Say ('-' * 46)

# ---------------------------------------------------------- 1. 登入

Write-Host ''
Say '[1/5] 檢查 Cloudflare 登入狀態'
$who = & npx --yes wrangler@4 whoami 2>&1 | Out-String
if ($who -match 'not authenticated') {
    Write-Host ''
    Say '尚未登入。接下來瀏覽器會開啟 Cloudflare 授權頁面，' 'Yellow'
    Say '請在瀏覽器按 Allow，然後回到這個視窗。' 'Yellow'
    Write-Host ''
    & npx --yes wrangler@4 login
    $who = & npx --yes wrangler@4 whoami 2>&1 | Out-String
    if ($who -match 'not authenticated') { Fail '登入沒有完成，請重新執行一次。' }
}
Say '已登入' 'Green'

# ---------------------------------------------------------- 2. KV

Write-Host ''
Say '[2/5] 訂閱資料庫（KV）'
$toml = Get-Content 'wrangler.toml' -Raw -Encoding UTF8
if ($toml -match 'id = "PLACEHOLDER"') {
    $out = & npx --yes wrangler@4 kv namespace create SUBS 2>&1 | Out-String
    $id = $null
    if ($out -match '([0-9a-f]{32})') { $id = $Matches[1] }
    if (-not $id) {
        # 可能之前建過了：從清單裡找
        $list = & npx --yes wrangler@4 kv namespace list 2>&1 | Out-String
        try {
            $ns = ($list.Substring($list.IndexOf('[')) | ConvertFrom-Json) |
                Where-Object { $_.title -eq 'SUBS' -or $_.title -eq 'japanese-practice-push-SUBS' } |
                Select-Object -First 1
            if ($ns) { $id = $ns.id }
        } catch { }
    }
    if (-not $id) {
        Write-Host $out
        Fail '建立 KV 失敗，請把上面的訊息貼給我。'
    }
    $toml = $toml -replace 'id = "PLACEHOLDER"', ('id = "' + $id + '"')
    [System.IO.File]::WriteAllText((Join-Path $proj 'wrangler.toml'), $toml, (New-Object System.Text.UTF8Encoding $false))
    Say ('已建立：' + $id) 'Green'
} else {
    Say '已經有了' 'Green'
}

# ---------------------------------------------------------- 3. 推播金鑰

Write-Host ''
Say '[3/5] 推播金鑰'
$keys = @{}
if (Test-Path '.env') {
    foreach ($line in Get-Content '.env' -Encoding UTF8) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#') -or $t -notmatch '=') { continue }
        $k, $v = $t -split '=', 2
        $keys[$k.Trim()] = $v.Trim().Trim('"').Trim("'")
    }
}
if (-not $keys['VAPID_PRIVATE'] -or -not $keys['VAPID_PUBLIC']) {
    $gen = & npx --yes web-push@3 generate-vapid-keys --json 2>&1 | Out-String
    try {
        $v = $gen.Substring($gen.IndexOf('{')) | ConvertFrom-Json
        $keys['VAPID_PUBLIC'] = $v.publicKey
        $keys['VAPID_PRIVATE'] = $v.privateKey
    } catch {
        Write-Host $gen
        Fail '產生金鑰失敗，請把上面的訊息貼給我。'
    }
    $envText = "# 推播金鑰（不會進版本庫）。不要刪，換金鑰的話已訂閱的手機會收不到通知。`r`n" +
        "VAPID_PUBLIC=$($keys['VAPID_PUBLIC'])`r`nVAPID_PRIVATE=$($keys['VAPID_PRIVATE'])`r`n"
    [System.IO.File]::WriteAllText((Join-Path $proj '.env'), $envText, (New-Object System.Text.UTF8Encoding $false))
    Say '已產生新金鑰，存在 .env' 'Green'
} else {
    Say '沿用 .env 裡的金鑰' 'Green'
}

# ---------------------------------------------------------- 4. 部署

Write-Host ''
Say '[4/5] 部署（第一次會比較久）'
Write-Host ''
& npx --yes wrangler@4 deploy
if ($LASTEXITCODE -ne 0) { Fail '部署失敗，請把上面的錯誤訊息貼給我。' }

# ---------------------------------------------------------- 5. 上傳金鑰

Write-Host ''
Say '[5/5] 上傳金鑰到 Cloudflare'
$tmp = Join-Path $env:TEMP ('jp-secrets-{0}.json' -f [guid]::NewGuid())
try {
    @{ VAPID_PUBLIC = $keys['VAPID_PUBLIC']; VAPID_PRIVATE = $keys['VAPID_PRIVATE'] } |
        ConvertTo-Json | Set-Content $tmp -Encoding UTF8
    & npx --yes wrangler@4 secret bulk $tmp
    $ok = ($LASTEXITCODE -eq 0)
}
finally {
    # 金鑰不留在暫存資料夾
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
}

Write-Host ''
Say ('-' * 46)
if ($ok) {
    Say '完成。' 'Green'
    Write-Host ''
    Say '請確認上面 wrangler 印出的網址是：' 'Cyan'
    Say 'https://japanese-practice-push.qianzhen-site.workers.dev' 'Cyan'
    Say '如果不一樣，把網址告訴 Claude，要改 app.js 裡的 PUSH_API。' 'Yellow'
} else {
    Say '伺服器已上線，但金鑰沒有上傳成功，通知會開不起來。' 'Yellow'
    Say '請把錯誤訊息貼給我。' 'Yellow'
}
Write-Host ''
Read-Host '按 Enter 關閉'
