$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dependencies = $env:CONTEXTLEDGER_DEPENDENCIES
if (!$dependencies) { $dependencies = '.runtime' }
$runtime = [IO.Path]::GetFullPath($dependencies, $root)
$sqlite = Join-Path $runtime 'node_modules/sqlite3'
if (!(Test-Path -LiteralPath (Join-Path $sqlite 'package.json'))) {
    throw 'Install the pinned npm packages with --ignore-scripts first.'
}
if ((node -p 'process.arch') -ne 'x64') {
    throw 'This verified fallback is for Windows x64.'
}
$archive = Join-Path $runtime 'sqlite3-win-x64.tar.gz'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v6-win32-x64.tar.gz' -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '7A55F7ADB5FC3126156C56253511EC5AC38110531281ECBAFBE71244555E93CE') {
    throw 'The SQLite release archive did not match the recorded SHA-256.'
}
@'
from pathlib import Path
import sys, tarfile
member = "build/Release/node_sqlite3.node"
with tarfile.open(sys.argv[1]) as archive:
    target = Path(sys.argv[2]) / member
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(archive.extractfile(member).read())
'@ | python - $archive $sqlite
if ($LASTEXITCODE -ne 0) { throw 'SQLite binary extraction failed.' }
