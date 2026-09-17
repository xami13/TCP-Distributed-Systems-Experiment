param([string]$Message)
$ErrorActionPreference = 'Stop'
if ($PSBoundParameters.ContainsKey('Message')) {
    & node "$PSScriptRoot\experiments.js" chaos $Message
} else {
    & node "$PSScriptRoot\experiments.js" chaos
}
exit $LASTEXITCODE

