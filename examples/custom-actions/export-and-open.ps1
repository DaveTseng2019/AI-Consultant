# Example: open this conversation in VS Code.
#
# Set the button's "what the button hands the script" to "this conversation as .md". The app writes
# the conversation into its export folder and passes the file here; deciding what opens it is this
# file's whole job, because Windows ships no default program for .md.
#
# Nothing here needs .md to be associated with anything: `code` is called by name, so the file
# opens in VS Code whether or not Explorer would have known what to do with it.
param([Parameter(Mandatory)][string]$MarkdownPath)
$ErrorActionPreference = 'Stop'

# code.cmd, not code: the plain name is a shim that Start-Process will not resolve on its own.
# VS Code puts it on PATH during install ("Add to PATH" is on by default).
$code = 'code.cmd'
if (-not (Get-Command $code -ErrorAction SilentlyContinue)) {
    throw "VS Code is not on PATH. Reinstall it with the PATH option, or edit this script to use the full path to Code.exe."
}

# -r reuses the window that is already open instead of stacking up one per export.
Start-Process -FilePath $code -ArgumentList @('-r', "`"$MarkdownPath`"") -WindowStyle Hidden

# The app shows this script's last line of output next to its "done" message, so say where the file
# went. The file is kept, not swept: exporting this conversation again rewrites that same path.
Write-Output $MarkdownPath
