# Builds the windows-media-ocr C# sidecar into resources/bin/.
# Invoked by `npm run build:sidecar:win`.
#
# Requires:
#   - .NET 9 SDK (https://dotnet.microsoft.com/download)
#   - Windows 10 19041 SDK (auto-installed by VS or `winget install Microsoft.WindowsSDK.10.0.19041`)

param(
    [string]$Runtime = ""
)

$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
    if ([string]::IsNullOrEmpty($Runtime)) {
        $arch = (Get-CimInstance Win32_OperatingSystem).OSArchitecture
        $Runtime = if ($arch -match "ARM") { "win-arm64" } else { "win-x64" }
    }

    $projectRoot = Resolve-Path "..\.."
    $outDir = Join-Path $projectRoot "resources\bin"
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null

    Write-Host "Building windows-media-ocr ($Runtime)..."
    dotnet publish "VnReader.WindowsMediaOcr.csproj" `
        -c Release `
        -r $Runtime `
        -o $outDir `
        --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true | Out-Host

    $exe = Join-Path $outDir "windows-media-ocr.exe"
    if (Test-Path $exe) {
        Write-Host "built $exe"
    } else {
        Write-Error "build did not produce windows-media-ocr.exe at $exe"
    }
}
finally {
    Pop-Location
}
