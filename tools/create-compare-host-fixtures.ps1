param(
    [Parameter(Mandatory = $true)]
    [string]$OutputRoot
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $root | Out-Null

function New-HostFixture {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Paragraphs
    )

    $temporaryRoot = Join-Path $root (".fixture-" + [Guid]::NewGuid().ToString("N"))
    try {
        New-Item -ItemType Directory -Force -Path `
            $temporaryRoot,(Join-Path $temporaryRoot "_rels"),(Join-Path $temporaryRoot "word") |
            Out-Null
        @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot "[Content_Types].xml") -Encoding utf8NoBOM
        @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot "_rels/.rels") -Encoding utf8NoBOM

        $escapedParagraphs = $Paragraphs | ForEach-Object {
            $escaped = [Security.SecurityElement]::Escape($_)
            "<w:p><w:r><w:t xml:space=`"preserve`">$escaped</w:t></w:r></w:p>"
        }
        $document = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    $($escapedParagraphs -join "`n    ")
    <w:sectPr/>
  </w:body>
</w:document>
"@
        Set-Content -LiteralPath (Join-Path $temporaryRoot "word/document.xml") `
            -Value $document -Encoding utf8NoBOM
        if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
        Compress-Archive -Path (Join-Path $temporaryRoot "*") -DestinationPath $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryRoot) {
            Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
        }
    }
}

New-HostFixture -Path (Join-Path $root "compare-original.docx") -Paragraphs @(
    "WORDOLLAMA_COMPARE_CONTRACT",
    "Remove this obsolete clause.",
    "Payment is due in 30 days.",
    "Tail anchor."
)
New-HostFixture -Path (Join-Path $root "compare-revised.docx") -Paragraphs @(
    "WORDOLLAMA_COMPARE_CONTRACT",
    "Inserted compliance clause.",
    "Payment is due in 15 business days.",
    "Tail anchor."
)

Write-Host "Created compare-original.docx and compare-revised.docx under $root"
