$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$venvPython = Join-Path $backendRoot '.venv\Scripts\python.exe'

if ($env:BUTLER_PYTHON_PATH) {
  $python = $env:BUTLER_PYTHON_PATH
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $python = 'py'
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $python = 'python'
} else {
  throw 'Python 3.11 or newer was not found. Install Python, then run npm run backend:setup again.'
}

if (-not (Test-Path $venvPython)) {
  if ($python -eq 'py') {
    & $python -3.11 -m venv (Join-Path $backendRoot '.venv')
  } else {
    & $python -m venv (Join-Path $backendRoot '.venv')
  }
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install --editable "$backendRoot[dev]"

Write-Host ''
Write-Host 'FastAPI backend environment is ready.'
Write-Host "Python: $venvPython"
Write-Host 'Run npm run backend:test to verify it.'
