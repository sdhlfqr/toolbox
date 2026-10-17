$regPath = "HKCU:\Software\Elantech\SmartPad"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name "Tap_Two_Finger_Enable" -Type DWord -Value 1
Set-ItemProperty -Path $regPath -Name "Tap_Two_Finger" -Type DWord -Value 1
