# Packages
$packages = @(
	"Clipchamp.Clipchamp",
	"Microsoft.BingNews",
	"Microsoft.BingSearch",
	"Microsoft.BingWeather",
	"Microsoft.Copilot",
	"Microsoft.GamingApp",
	"Microsoft.GetHelp",
	"Microsoft.MicrosoftOfficeHub",
	"Microsoft.MicrosoftSolitaireCollection",
	"Microsoft.MicrosoftStickyNotes",
	"Microsoft.OutlookForWindows",
	"Microsoft.Paint",
	"Microsoft.PowerAutomateDesktop",
	"Microsoft.Todos",
	"Microsoft.WindowsFeedbackHub",
	"Microsoft.WindowsSoundRecorder",
	"Microsoft.Xbox.TCUI",
	"Microsoft.XboxGameCallableUI",
	"Microsoft.XboxGamingOverlay",
	"Microsoft.XboxIdentityProvider",
	"Microsoft.XboxSpeechToTextOverlay",
	"MicrosoftCorporationII.QuickAssist",
	"MSTeams",
	"Microsoft.WindowsCamera",
	"Microsoft.Windows.Photos",
	"Microsoft.Windows.DevHome",
	"Microsoft.YourPhone",
	"Microsoft.Windows.NarratorQuickStart",
	"Microsoft.WidgetsPlatformRuntime",
	"Microsoft.WindowsTerminal",
	"Microsoft.ZuneMusic"
)

Write-Host "Removing Packages"
$provisioned = Get-AppxProvisionedPackage -Online
ForEach ($package in $packages) {
	$appx = Get-AppxPackage -Name $package -AllUsers
	if ($appx) {
		Write-Host "- Removing '$package'"
		$appx | Remove-AppxPackage -AllUsers -ErrorAction SilentlyContinue
	}
	$prov = $provisioned | Where-Object DisplayName -eq $package
	if ($prov) {
		$prov | Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Out-Null
	}
}

# Capabilities
$capabilities = @(
	"Microsoft.Windows.Notepad~~~~0.0.1.0",
	"App.StepsRecorder~~~~0.0.1.0",
	"Browser.InternetExplorer~~~~0.0.11.0",
	"DirectX.Configuration.Database~~~~0.0.1.0",
	"Hello.Face.20134~~~~0.0.1.0",
	"Language.Handwriting~~~en-GB~0.0.1.0",
	"Language.OCR~~~en-GB~0.0.1.0",
	"Language.Speech~~~en-GB~0.0.1.0",
	"Language.TextToSpeech~~~en-GB~0.0.1.0",
	"Language.Handwriting~~~en-US~0.0.1.0",
	"Language.OCR~~~en-US~0.0.1.0",
	"Language.Speech~~~en-US~0.0.1.0",
	"Language.TextToSpeech~~~en-US~0.0.1.0",
	"MathRecognizer~~~~0.0.1.0",
	"Media.WindowsMediaPlayer~~~~0.0.12.0",
	"Microsoft.Wallpapers.Extended~~~~0.0.1.0",
	"Microsoft.Windows.Ethernet.Client.Intel.E1i68x64~~~~0.0.1.0",
	"Microsoft.Windows.Ethernet.Client.Intel.E2f68~~~~0.0.1.0",
	"Microsoft.Windows.Ethernet.Client.Realtek.Rtcx21x64~~~~0.0.1.0",
	"Microsoft.Windows.Ethernet.Client.Vmware.Vmxnet3~~~~0.0.1.0",
	"Microsoft.Windows.Notepad.System~~~~0.0.1.0",
	"Microsoft.Windows.PowerShell.ISE~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Broadcom.Bcmpciedhd63~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Broadcom.Bcmwl63al~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Broadcom.Bcmwl63a~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwbw02~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwew00~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwew01~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwlv64~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwns64~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwsw00~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwtw02~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwtw04~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwtw06~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwtw08~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Intel.Netwtw10~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Marvel.Mrvlpcie8897~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Qualcomm.Athw8x~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Qualcomm.Athwnx~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Qualcomm.Qcamain10x64~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Ralink.Netr28x~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Realtek.Rtl8192se~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Realtek.Rtwlane01~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Realtek.Rtwlane13~~~~0.0.1.0",
	"Microsoft.Windows.Wifi.Client.Realtek.Rtwlane~~~~0.0.1.0",
	"OpenSSH.Client~~~~0.0.1.0",
	"OneCoreUAP.OneSync~~~~0.0.1.0",
	"Print.Management.Console~~~~0.0.1.0",
	"VBSCRIPT~~~~0.0.1.0",
	"Windows.Kernel.LA57~~~~0.0.1.0",
	"Hello.Face.18967~~~~0.0.1.0",
	"Print.Fax.Scan~~~~0.0.1.0",
	"Microsoft.Windows.WordPad~~~~0.0.1.0",
	"Microsoft.Windows.MSPaint~~~~0.0.1.0",
	"App.Support.QuickAssist~~~~0.0.1.0"
)

Write-Host "Removing Capabilities"
$installedCapabilities = (Get-WindowsCapability -Online | Where-Object State -eq "Installed").Name
ForEach ($capability in $capabilities) {
	if ($installedCapabilities -contains $capability) {
		Write-Host "- Removing '$capability'"
		Remove-WindowsCapability -Online -Name $capability | Out-Null
	}
}

# Features
$features = @(
	"WorkFolders-Client",
	"WCF-Services45",
	"WCF-TCP-PortSharing45",
	"MediaPlayback",
	"SmbDirect",
	"MSRDC-Infrastructure",
	"NetFx4-AdvSrvs",
	"SearchEngine-Client-Package",
	"Microsoft-RemoteDesktopConnection",
	"MicrosoftWindowsPowerShellV2",
	"Printing-XPSServices-Features",
	"MicrosoftWindowsPowerShellV2Root",
	"Printing-Foundation-InternetPrinting-Client"
)

Write-Host "Disabling Features"
$enabledFeatures = (Get-WindowsOptionalFeature -Online | Where-Object State -eq "Enabled").FeatureName
ForEach ($feature in $features) {
	if ($enabledFeatures -contains $feature) {
		Write-Host "- Disabling '$feature'"
		Disable-WindowsOptionalFeature -Online -FeatureName $feature -NoRestart | Out-Null
	}
}

# Services
$services = @(
	"DiagTrack",
	"dmwappushservice"
)

Write-Host "Disabling Services"
ForEach ($service in $services) {
	if (Get-Service -Name $service -ErrorAction SilentlyContinue) {
		Write-Host "- Disabling '$service'"
		Stop-Service -Name $service -Force -ErrorAction SilentlyContinue
		Set-Service -Name $service -StartupType Disabled
	}
}

# Policies
Write-Host "Applying Policies"
$telemetryPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection"
if (-not (Test-Path $telemetryPolicyPath)) { New-Item -Path $telemetryPolicyPath -Force | Out-Null }
Set-ItemProperty -Path $telemetryPolicyPath -Name "AllowTelemetry" -Type DWord -Value 0

$explorerPolicyPath = "HKCU:\Software\Policies\Microsoft\Windows\Explorer"
if (-not (Test-Path $explorerPolicyPath)) { New-Item -Path $explorerPolicyPath -Force | Out-Null }
Set-ItemProperty -Path $explorerPolicyPath -Name "DisableSearchBoxSuggestions" -Type DWord -Value 1

# Reboot
Write-Host "`nRebooting system in 5 seconds..."
Start-Sleep -Seconds 5
Restart-Computer -Force