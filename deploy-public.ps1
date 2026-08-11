<#
  Portfolio Manager - build the public copy of the site

  Double-click deploy-public.cmd to run this.

  It does two things and then tells you what to do in GitHub Desktop:

    1. runs every release gate, and refuses to go on if one fails
    2. refreshes the public working copy so it holds exactly the files the hosted site needs

  It never commits and never pushes. Publishing stays a deliberate act you take in GitHub
  Desktop, where you can see what is going out before it goes.

  WHERE THE PUBLIC COPY LIVES

  Beside this folder, not inside it: ..\ppm-proof-of-concept. It has to be a sibling. This
  folder is a git repository, and GitHub Desktop will not add or create a repository inside
  another one - it simply refuses to select the folder, with no useful explanation. The first
  version of this script wrote to deploy\ in here, which could never have been published.
#>

$ErrorActionPreference = "Stop"
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $folder

# Relative for the sync (it resolves against the script's folder), absolute for messages.
$publicRelative = "../ppm-proof-of-concept"
$publicFolder = Join-Path (Split-Path -Parent $folder) "ppm-proof-of-concept"

function Heading($text) {
    Write-Host ""
    Write-Host $text -ForegroundColor Cyan
    Write-Host ("-" * $text.Length) -ForegroundColor DarkGray
}

Heading "Step 1 of 2 - checking the build"

# A failing gate means something is broken that has been broken before - that is what each gate
# is for. Publishing over the top of it puts it in front of every tester.
& node VERIFY-ALL.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "STOPPED. A check failed, so nothing has been copied and nothing will be published." -ForegroundColor Red
    Write-Host "Read the failure above, or send it to me. The live site is untouched." -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

Heading "Step 2 of 2 - refreshing the public copy"

# The public folder must exist and be a clone before there is anything to refresh. Saying so
# here is friendlier than the sync's own refusal, which cannot know why the folder is absent.
if (-not (Test-Path $publicFolder)) {
    Write-Host ""
    Write-Host "The public folder does not exist yet:" -ForegroundColor Yellow
    Write-Host "   $publicFolder"
    Write-Host ""
    Write-Host "Clone it once in GitHub Desktop, then run this again:"
    Write-Host ""
    Write-Host "   1. File > Clone repository > URL"
    Write-Host "   2. Repository:  Lolsnaps/ppm-proof-of-concept"
    Write-Host "   3. Local path:  $(Split-Path -Parent $folder)"
    Write-Host "      (the folder that contains this one, NOT this one)"
    Write-Host "   4. Clone"
    Write-Host ""
    Write-Host "Step 2 of PRIVATE-AND-PUBLIC-REPOS.md has this in more detail."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

& node BUILD-DEPLOY-SET.mjs --sync $publicRelative
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "STOPPED. The public copy could not be refreshed, so nothing will be published." -ForegroundColor Red
    Write-Host "The live site is untouched." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$version = (Get-Content -LiteralPath (Join-Path $folder "VERSION") -Raw).Trim()
$isNew = -not (Test-Path (Join-Path $publicFolder ".git"))

Heading "What to do next"

if ($isNew) {
    Write-Host "That folder is not a git repository, so there is nowhere to push it." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Delete it, then clone the public repository into its place with GitHub Desktop:"
    Write-Host "   File > Clone repository > URL > Lolsnaps/ppm-proof-of-concept"
    Write-Host "   Local path:  $(Split-Path -Parent $folder)"
    Write-Host ""
    Write-Host "See PRIVATE-AND-PUBLIC-REPOS.md."
} else {
    # git is only used to count what changed, which is a nicety. GitHub Desktop bundles its own
    # copy and does not put it on PATH, so on a machine with no separate install this would be a
    # CommandNotFoundException - and under ErrorActionPreference = Stop that ends the script with
    # a red stack trace instead of the instructions it exists to print. So it is optional.
    $changes = $null
    $countable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
    if ($countable) {
        Push-Location $publicFolder
        try { $changes = & git status --porcelain } catch { $countable = $false } finally { Pop-Location }
    }

    if ($countable -and [string]::IsNullOrWhiteSpace($changes)) {
        Write-Host "Nothing has changed since you last published." -ForegroundColor Green
        Write-Host "The public site is already up to date with this folder. There is nothing to do."
    } else {
        if ($countable) {
            $count = ($changes | Measure-Object -Line).Lines
            Write-Host "$count file(s) are ready to publish." -ForegroundColor Green
        } else {
            Write-Host "The public copy is up to date with this folder." -ForegroundColor Green
            Write-Host "GitHub Desktop will show you whether anything actually changed."
        }
        Write-Host ""
        Write-Host "In GitHub Desktop:"
        Write-Host ""
        Write-Host "   1. Change the repository at the top left to  ppm-proof-of-concept"
        Write-Host "      (not PPM Tool 33 - that one is the private source)"
        Write-Host "   2. Check the list of changes looks like what you expect"
        Write-Host "   3. Summary:  Build $version"
        Write-Host "   4. Commit to main"
        Write-Host "   5. Push origin"
        Write-Host ""
        Write-Host "The site updates a minute or two after the push."
        Write-Host ""
        Write-Host "Remember to commit and push PPM Tool 33 as well, so the private" -ForegroundColor DarkGray
        Write-Host "repository keeps the documentation and the history." -ForegroundColor DarkGray
    }
}

Write-Host ""
Read-Host "Press Enter to close"
