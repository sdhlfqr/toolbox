# Win32 API
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct ANIMATIONINFO {
    public uint cbSize;
    public int iMinAnimate;
}

public class Win32VisualEffects {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref ANIMATIONINFO pvParam, uint fWinIni);
}
"@

$SPIF = 3

# Mode
$visualFxPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects"
if (-not (Test-Path $visualFxPath)) { New-Item -Path $visualFxPath -Force | Out-Null }
Set-ItemProperty -Path $visualFxPath -Name "VisualFXSetting" -Type DWord -Value 3

# Visuals (Enable)
[Win32VisualEffects]::SystemParametersInfo(0x004B, 1, [IntPtr]0, $SPIF) | Out-Null # Smooth fonts
[Win32VisualEffects]::SystemParametersInfo(0x0025, 1, [IntPtr]0, $SPIF) | Out-Null # Drag content
[Win32VisualEffects]::SystemParametersInfo(0x1025, 0, [IntPtr]1, $SPIF) | Out-Null # Window shadows
[Win32VisualEffects]::SystemParametersInfo(0x1007, 0, [IntPtr]1, $SPIF) | Out-Null # Smooth scroll

$explorerAdvPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
Set-ItemProperty -Path $explorerAdvPath -Name "IconsOnly" -Type DWord -Value 0           # Thumbnails
Set-ItemProperty -Path $explorerAdvPath -Name "ListviewAlphaSelect" -Type DWord -Value 1 # Selection box

# Animations (Disable)
$anim = New-Object ANIMATIONINFO
$anim.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($anim)
$anim.iMinAnimate = 0
[Win32VisualEffects]::SystemParametersInfo(0x0049, $anim.cbSize, [ref]$anim, $SPIF) | Out-Null # Min/Max anim

[Win32VisualEffects]::SystemParametersInfo(0x1043, 0, [IntPtr]0, $SPIF) | Out-Null # Control anim
[Win32VisualEffects]::SystemParametersInfo(0x1003, 0, [IntPtr]0, $SPIF) | Out-Null # Menu fade
[Win32VisualEffects]::SystemParametersInfo(0x1017, 0, [IntPtr]0, $SPIF) | Out-Null # Tooltip fade
[Win32VisualEffects]::SystemParametersInfo(0x1015, 0, [IntPtr]0, $SPIF) | Out-Null # Click fade
[Win32VisualEffects]::SystemParametersInfo(0x1005, 0, [IntPtr]0, $SPIF) | Out-Null # Combo slide
[Win32VisualEffects]::SystemParametersInfo(0x101B, 0, [IntPtr]0, $SPIF) | Out-Null # Cursor shadow

Set-ItemProperty -Path $explorerAdvPath -Name "TaskbarAnimations" -Type DWord -Value 0 # Taskbar anim
Set-ItemProperty -Path $explorerAdvPath -Name "ListviewShadow" -Type DWord -Value 0    # Icon shadows

$dwmPath = "HKCU:\Software\Microsoft\Windows\DWM"
Set-ItemProperty -Path $dwmPath -Name "EnableAeroPeek" -Type DWord -Value 0            # Peek
Set-ItemProperty -Path $dwmPath -Name "AlwaysHibernateThumbnails" -Type DWord -Value 0 # Previews

# Theme
Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name "AutoColorization" -Type DWord -Value 1
Set-ItemProperty -Path $dwmPath -Name "ColorPrevalence" -Type DWord -Value 0

$personalizePath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
if (-not (Test-Path $personalizePath)) { New-Item -Path $personalizePath -Force | Out-Null }
Set-ItemProperty -Path $personalizePath -Name "SystemUsesLightTheme" -Type DWord -Value 1
Set-ItemProperty -Path $personalizePath -Name "AppsUseLightTheme" -Type DWord -Value 1
Set-ItemProperty -Path $personalizePath -Name "EnableTransparency" -Type DWord -Value 0
Set-ItemProperty -Path $personalizePath -Name "ColorPrevalence" -Type DWord -Value 0

# Taskbar
Set-ItemProperty -Path $explorerAdvPath -Name "TaskbarGlomLevel" -Type DWord -Value 2   # Never combine
Set-ItemProperty -Path $explorerAdvPath -Name "MMTaskbarEnabled" -Type DWord -Value 1   # All displays
Set-ItemProperty -Path $explorerAdvPath -Name "MMTaskbarMode" -Type DWord -Value 2      # Active display
Set-ItemProperty -Path $explorerAdvPath -Name "MMTaskbarGlomLevel" -Type DWord -Value 2 # Never combine MM

# Restart
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
