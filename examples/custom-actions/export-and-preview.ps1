# Example: open this conversation in a rendered Markdown preview window.
#
# Set the button's "what the button hands the script" to "this conversation as .md". The app writes
# the conversation into its export folder and passes the file here; deciding what opens it is this
# file's whole job, because Windows ships no default program for .md.
#
# This one hands the file to md-preview (https://github.com/DaveTseng2019/md-preview), which renders
# it - Mermaid diagrams included - in a plain window with no address bar and no tabs. Use it when the
# export is meant to be read. Use export-and-open.ps1 instead when it is meant to be edited.
#
# md-preview is a separate checkout. Point -PreviewScript at wherever you put it.
param(
    [Parameter(Mandatory)][string]$MarkdownPath,
    [string]$PreviewScript = 'C:\Learning\md-preview\md-preview.ps1'
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PreviewScript)) {
    throw "md-preview not found at $PreviewScript. Clone https://github.com/DaveTseng2019/md-preview and pass -PreviewScript with its path."
}

# Start-Process, not a direct call: md-preview launches a browser and this button should return at
# once. -WindowStyle Hidden keeps the PowerShell console from flashing.
Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$PreviewScript`"", "`"$MarkdownPath`""
)

# The app shows this script's last line of output next to its "done" message, so say where the file
# went. The file is kept, not swept: exporting this conversation again rewrites that same path.
Write-Output $MarkdownPath
