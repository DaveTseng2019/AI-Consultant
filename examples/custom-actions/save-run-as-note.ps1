# Example: turn one recorded run into a Markdown note.
#
# Set the button's "what the button hands the script" to "this run". The app passes -SnapshotId and
# guarantees the file exists for the length of this script -- including when durable snapshots are
# off, where it writes the run just for this call and deletes it again afterwards.
#
# What a snapshot holds depends on the redaction tier the run was recorded at. Only `full-local`
# keeps the real text; every other tier stores a hash or nothing, and this script says so rather
# than writing a note full of blanks.
#
# notes: ASCII only on purpose. Windows PowerShell 5.1 reads a BOM-less .ps1 as the system ANSI
#        codepage, so non-ASCII here would arrive as mojibake and usually die as a parser error.
#        Put your own language in the headings below only if you save this file as UTF-8 WITH BOM.
param(
    [Parameter(Mandatory)][string]$SnapshotId,
    # Where the notes go. Anywhere you can write to; one file per run.
    [string]$Out = "$env:USERPROFILE\Documents\AI Consultant",
    [string]$SnapshotDir = "$env:APPDATA\tw.micasa.aiconsultant\snapshots"
)
$ErrorActionPreference = 'Stop'

# The app spawns this with no console attached, so stdout would otherwise be encoded with the system
# ANSI codepage and arrive as replacement characters for anything outside it.
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$file = Join-Path $SnapshotDir "$SnapshotId.json"
if (-not (Test-Path -LiteralPath $file)) { throw "snapshot not found: $file" }
$run = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json

$question = if ($run.userQuestion.text) { $run.userQuestion.text } else { '' }
if (-not $question) {
    throw "this run was recorded at tier '$($run.redactionTier)', which keeps no text. Set the tier to full-local and ask again."
}

# The timestamp leads the file name so a plain name sort is chronological, and it keeps two runs of
# the same question apart. Everything Windows forbids in a name is replaced rather than dropped, so
# two different questions cannot collapse into one file.
$when = [datetime]::Parse($run.createdAt).ToLocalTime()
$title = ($question -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
foreach ($bad in [IO.Path]::GetInvalidFileNameChars()) { $title = $title.Replace($bad, '-') }
if ($title.Length -gt 60) { $title = $title.Substring(0, 60).TrimEnd() }
$name = $when.ToString('yyyy-MM-dd HHmm') + ' ' + $title + '.md'
$path = Join-Path $Out $name

New-Item -ItemType Directory -Force $Out | Out-Null

$md = @('---', "date: $($when.ToString('yyyy-MM-dd HH:mm'))", "graph: $($run.graphId)",
        "snapshot: $($run.snapshotId)", "tier: $($run.redactionTier)", '---', '', '## Question', '', $question, '')
foreach ($step in $run.steps | Sort-Object nodeId) {
    $answer = if ($step.outputRef.text) { $step.outputRef.text } else { "(no text at tier '$($step.outputRef.tier)')" }
    $md += @("## $($step.provider)", '', $answer, '')
}
$md -join "`n" | Set-Content -LiteralPath $path -Encoding UTF8

# The app shows this script's last line of output next to its "done" message.
Write-Output $path
