$output = powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null
if ($output -match '([0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})') {
    powercfg -setactive $Matches[1] | Out-Null
}
