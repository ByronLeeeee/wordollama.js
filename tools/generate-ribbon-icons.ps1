Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

$outputDirectory = Join-Path $PSScriptRoot "..\officejs\apps\addin\assets\ribbon"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

function New-RibbonIcon([string]$name) {
  $bitmap = [System.Drawing.Bitmap]::new(80, 80, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 37, 99, 201), 5)
  $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  switch ($name) {
    "image" {
      $graphics.DrawRectangle($pen, 13, 16, 54, 48)
      $graphics.DrawEllipse($pen, 47, 25, 8, 8)
      $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(18,55), [System.Drawing.Point]::new(33,39), [System.Drawing.Point]::new(43,49), [System.Drawing.Point]::new(51,42), [System.Drawing.Point]::new(63,55)))
    }
    "table" {
      $graphics.DrawRectangle($pen, 12, 15, 56, 50)
      $graphics.DrawLine($pen, 12, 31, 68, 31); $graphics.DrawLine($pen, 12, 48, 68, 48)
      $graphics.DrawLine($pen, 31, 15, 31, 65); $graphics.DrawLine($pen, 50, 15, 50, 65)
    }
    "html" {
      $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(31,22), [System.Drawing.Point]::new(15,40), [System.Drawing.Point]::new(31,58)))
      $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(49,22), [System.Drawing.Point]::new(65,40), [System.Drawing.Point]::new(49,58)))
      $graphics.DrawLine($pen, 45, 16, 35, 64)
    }
    "markdown" {
      $graphics.DrawRectangle($pen, 10, 18, 60, 44)
      $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(19,49), [System.Drawing.Point]::new(19,31), [System.Drawing.Point]::new(27,40), [System.Drawing.Point]::new(35,31), [System.Drawing.Point]::new(35,49)))
      $graphics.DrawLine($pen, 51, 29, 51, 49); $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(43,42), [System.Drawing.Point]::new(51,50), [System.Drawing.Point]::new(59,42)))
    }
    "risk" {
      $graphics.DrawPolygon($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(40,11), [System.Drawing.Point]::new(70,65), [System.Drawing.Point]::new(10,65)))
      $graphics.DrawLine($pen, 40, 30, 40, 47); $graphics.DrawEllipse($pen, 38, 55, 4, 4)
    }
    "fairness" {
      $graphics.DrawLine($pen, 40, 14, 40, 65); $graphics.DrawLine($pen, 22, 24, 58, 24); $graphics.DrawLine($pen, 28, 65, 52, 65)
      $graphics.DrawLine($pen, 22, 24, 13, 44); $graphics.DrawLine($pen, 22, 24, 31, 44); $graphics.DrawArc($pen, 13, 35, 18, 18, 0, 180)
      $graphics.DrawLine($pen, 58, 24, 49, 44); $graphics.DrawLine($pen, 58, 24, 67, 44); $graphics.DrawArc($pen, 49, 35, 18, 18, 0, 180)
    }
    "moot-court" {
      $graphics.DrawRectangle($pen, 18, 16, 29, 15); $graphics.DrawRectangle($pen, 39, 38, 29, 15)
      $graphics.DrawLine($pen, 31, 30, 51, 43); $graphics.DrawLine($pen, 20, 59, 60, 59); $graphics.DrawLine($pen, 25, 66, 55, 66)
    }
    "contract-compare" {
      $graphics.DrawRectangle($pen, 10, 14, 24, 36); $graphics.DrawRectangle($pen, 46, 30, 24, 36)
      $graphics.DrawLine($pen, 34, 23, 55, 23); $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(49,17), [System.Drawing.Point]::new(55,23), [System.Drawing.Point]::new(49,29)))
      $graphics.DrawLine($pen, 46, 57, 25, 57); $graphics.DrawLines($pen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(31,51), [System.Drawing.Point]::new(25,57), [System.Drawing.Point]::new(31,63)))
    }
    "compare" {
      $graphics.DrawRectangle($pen, 11, 15, 24, 50); $graphics.DrawRectangle($pen, 45, 15, 24, 50)
      $graphics.DrawLine($pen, 19, 28, 28, 28); $graphics.DrawLine($pen, 19, 39, 28, 39); $graphics.DrawLine($pen, 53, 39, 62, 39); $graphics.DrawLine($pen, 53, 51, 62, 51)
    }
    "law-search" {
      $graphics.DrawEllipse($pen, 12, 12, 36, 36); $graphics.DrawLine($pen, 43, 43, 66, 66)
      $graphics.DrawLine($pen, 30, 20, 30, 42); $graphics.DrawLine($pen, 21, 26, 39, 26); $graphics.DrawArc($pen, 18, 28, 10, 10, 0, 180); $graphics.DrawArc($pen, 32, 28, 10, 10, 0, 180)
    }
  }

  $sourcePath = Join-Path $outputDirectory "$name-80.png"
  $bitmap.Save($sourcePath, [System.Drawing.Imaging.ImageFormat]::Png)
  foreach ($size in @(16, 32)) {
    $small = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $target = [System.Drawing.Graphics]::FromImage($small)
    $target.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $target.DrawImage($bitmap, 0, 0, $size, $size)
    $small.Save((Join-Path $outputDirectory "$name-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $target.Dispose(); $small.Dispose()
  }
  $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

@("image", "table", "html", "markdown", "risk", "fairness", "moot-court", "contract-compare", "compare", "law-search") |
  ForEach-Object { New-RibbonIcon $_ }
