param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-Python {
  $candidates = @(
    @{ Command = "py"; Args = @("-3.11") },
    @{ Command = "py"; Args = @("-3") },
    @{ Command = "python"; Args = @() },
    @{ Command = "python3"; Args = @() }
  )

  foreach ($candidate in $candidates) {
    $command = $candidate.Command
    $args = $candidate.Args
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      continue
    }

    try {
      $version = & $command @args -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"
      if ($LASTEXITCODE -eq 0 -and $version) {
        return @{ Command = $command; Args = $args; Version = $version.Trim() }
      }
    } catch {
      continue
    }
  }

  throw "Python introuvable. Installe Python 3.11+ puis relance ce script."
}

function Invoke-Python {
  param(
    [hashtable]$Python,
    [string[]]$Args
  )

  & $Python.Command @($Python.Args) @Args
  if ($LASTEXITCODE -ne 0) {
    throw "La commande Python a echoue."
  }
}

function Find-Npm {
  if (Get-Command "npm.cmd" -ErrorAction SilentlyContinue) {
    return "npm.cmd"
  }
  if (Get-Command "npm" -ErrorAction SilentlyContinue) {
    return "npm"
  }
  throw "npm introuvable. Installe Node.js 18+ puis relance ce script."
}

try {
  Write-Step "Verification de Python"
  $Python = Find-Python
  Write-Host "Python detecte : $($Python.Command) $($Python.Args -join ' ') ($($Python.Version))"

  if (-not $SkipInstall) {
    Write-Step "Installation des dependances Python"
    Invoke-Python $Python @("-m", "pip", "install", "-r", "requirements.txt")
  }

  if (-not (Test-Path -LiteralPath "data\graph.pkl")) {
    Write-Step "Generation du graphe data/graph.pkl"
    Write-Host "Le premier lancement peut prendre quelques minutes."
    Invoke-Python $Python @("pipeline\build_graph.py")
  }

  Write-Step "Verification de Node / npm"
  $Npm = Find-Npm
  Write-Host "npm detecte : $Npm"

  Push-Location "frontend"
  try {
    if (-not $SkipInstall) {
      Write-Step "Installation des dependances frontend"
      & $Npm install
      if ($LASTEXITCODE -ne 0) {
        throw "npm install a echoue."
      }
    }

    Write-Step "Build du frontend"
    & $Npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "npm run build a echoue."
    }
  } finally {
    Pop-Location
  }

  Write-Step "Lancement du site"
  Write-Host "URL : http://127.0.0.1:8000/"
  Write-Host "Garde ce terminal ouvert. Appuie sur Ctrl+C pour arreter le serveur."

  Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://127.0.0.1:8000/"
  } | Out-Null

  Invoke-Python $Python @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000")
} catch {
  Write-Host ""
  Write-Host "Erreur : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ""
  Write-Host "Si PowerShell bloque le script, lance plutot :"
  Write-Host "  .\start.bat"
  exit 1
}
