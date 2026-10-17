param (
    [string]$directory = "."
)

# Check
if (-Not (Test-Path $directory)) {
    Write-Host "The specified path does not exist."
    exit
}

# Config
$clusterSizes = @(512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152)

$fileClusterCount = @{
  512       = 0
  1024      = 0
  2048      = 0
  4096      = 0
  8192      = 0
  16384     = 0
  32768     = 0
  65536     = 0
  131072    = 0
  262144    = 0
  524288    = 0
  1048576   = 0
  2097152   = 0
}

# Scan
$files = Get-ChildItem -Path $directory -File -Recurse

foreach ($file in $files) {
    $fileSize = $file.Length
    $foundCluster = $false

    foreach ($clusterSize in $clusterSizes) {
        if ($fileSize -le $clusterSize) {
            $fileClusterCount[$clusterSize]++
            $foundCluster = $true
            break
        }
    }

    if (-not $foundCluster) {
        $fileClusterCount[2097152]++
    }
}

# Output
Write-Host "File cluster sizes:"
$maxCount = $fileClusterCount.Values | Measure-Object -Maximum | Select-Object -ExpandProperty Maximum

foreach ($cluster in $clusterSizes) {
    $count = $fileClusterCount[$cluster]
    $bar = if ($maxCount -gt 0) { "#" * [Math]::Round(($count / $maxCount) * 50) } else { "" }
    Write-Host "${cluster}: $bar ($count)"
}