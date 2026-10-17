$regPath = "HKCU:\Software\Elantech\SmartPad"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name "ScrollControl_Mode" -Type DWord -Value 1
