$recycleBinClsid = "{645FF040-5081-101B-9F08-00AA002F954E}"

# Desktop
$desktopPaths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\ClassicStartMenu"
)

foreach ($path in $desktopPaths) {
    if (-not (Test-Path $path)) {
        New-Item -Path $path -Force | Out-Null
    }
    Set-ItemProperty -Path $path -Name $recycleBinClsid -Type DWord -Value 1
}

# Sidebar
$clsidPath = "HKCU:\Software\Classes\CLSID\$recycleBinClsid"
if (-not (Test-Path $clsidPath)) {
    New-Item -Path $clsidPath -Force | Out-Null
}
Set-ItemProperty -Path $clsidPath -Name "System.IsPinnedToNameSpaceTree" -Type DWord -Value 1
Set-ItemProperty -Path $clsidPath -Name "SortOrderIndex" -Type DWord -Value 120
