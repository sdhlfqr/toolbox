param (
    [string]$rootPath = "."
)

# Check
if (-Not (Test-Path $rootPath)) {
    Write-Host "The specified path does not exist."
    exit
}

# Convert
$directories = Get-ChildItem -Path $rootPath -Directory -Recurse |
    Sort-Object { $_.FullName.Length } -Descending

foreach ($directory in $directories) {
    $mdFilePath = Join-Path -Path $directory.Parent.FullName -ChildPath "$($directory.Name).md"
    New-Item -Path $mdFilePath -ItemType File -Force | Out-Null
    Remove-Item -Path $directory.FullName -Force
}