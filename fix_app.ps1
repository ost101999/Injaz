$content = Get-Content 'App.tsx'
$effectBlock = $content[585..705]
$newContent = @()
$newContent += $content[0..584]
$newContent += $content[706..2852]
$newContent += $effectBlock
$newContent += $content[2853..($content.Length-1)]

# Also fix the duplicate dir attribute while we are at it
# Line 3521 in original was dir="auto"
# After moving 121 lines up, it's around 3400
# But let's just find it by content
for ($i = 0; $i -lt $newContent.Length; $i++) {
    if ($newContent[$i] -match '^\s+dir="auto"$') {
        # Check if previous line was contentEditable
        if ($newContent[$i-1] -match 'contentEditable') {
             $newContent[$i] = $null # Mark for removal
        }
    }
}

$newContent | Where-Object { $_ -ne $null } | Set-Content 'App_fixed.tsx'
