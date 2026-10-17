# Folders
$folderGuids = @(
    "{0DB7E03F-FC29-4DC6-9020-FF41B59E513A}", # 3D Objects
    "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}", # Desktop
    "{d3162b92-9365-467a-956b-92703aca08af}", # Documents
    "{A8CDFF1C-4878-43be-B5FD-F8091C1C60D0}", # Documents (Legacy)
    "{088e3905-0323-4b02-9826-5d99428e115f}", # Downloads
    "{374DE290-123F-4565-9164-39C4925E467B}", # Downloads (Legacy)
    "{3dfdf296-dbec-4fb4-81d1-6a3438bcf4de}", # Music
    "{1CF1260C-4DD0-4ebb-811F-33C572699FDE}", # Music (Legacy)
    "{24ad3ad4-a569-4530-98e1-ab02f9417aa8}", # Pictures
    "{3ADD1653-EB32-4cb0-BBD7-DFA0ABB5ACCA}", # Pictures (Legacy)
    "{f86fa3ab-70d2-4fc7-9c99-fcbf05467f3a}", # Videos
    "{A0953C92-50DC-43bf-BE83-3742FED03C9C}"  # Videos (Legacy)
)

$basePaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\MyComputer\NameSpace",
    "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Explorer\MyComputer\NameSpace"
)

foreach ($basePath in $basePaths) {
    foreach ($guid in $folderGuids) {
        $target = Join-Path $basePath $guid
        if (Test-Path $target) {
            Remove-Item -Path $target -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
        }
    }
}

# Duplicate Drives
$duplicateDrivePaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace\DelegateFolders\{F5FB2C77-0E2F-4A16-A381-3E560C68BC83}",
    "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace\DelegateFolders\{F5FB2C77-0E2F-4A16-A381-3E560C68BC83}"
)

foreach ($drivePath in $duplicateDrivePaths) {
    if (Test-Path $drivePath) {
        Remove-Item -Path $drivePath -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
    }
}
