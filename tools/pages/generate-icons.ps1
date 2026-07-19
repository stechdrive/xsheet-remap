$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outputDirectory = Join-Path $repoRoot 'apps\web\public\icons'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )
  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Write-PwaIcon {
  param([int]$Size)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($Size / 128.0, $Size / 128.0)
    $graphics.Clear([System.Drawing.Color]::FromArgb(242, 247, 241))

    $navy = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(33, 72, 84))
    $paper = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(242, 247, 241))
    $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(102, 210, 175))
    $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(127, 184, 199), 7)
    $marks = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(33, 72, 84), 6)
    $marks.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $marks.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    try {
      $outer = New-RoundedRectanglePath 8 8 112 112 26
      $inner = New-RoundedRectanglePath 14 14 100 100 21
      $sheet = New-RoundedRectanglePath 42 24 44 80 7
      $stripe = New-RoundedRectanglePath 65 32 13 64 4
      try {
        $graphics.FillPath($navy, $outer)
        $graphics.DrawPath($border, $inner)
        $graphics.FillPath($paper, $sheet)
        $graphics.FillPath($accent, $stripe)
        foreach ($y in 43, 64, 85) { $graphics.DrawLine($marks, 51, $y, 62, $y) }
      } finally {
        $outer.Dispose()
        $inner.Dispose()
        $sheet.Dispose()
        $stripe.Dispose()
      }
    } finally {
      $navy.Dispose()
      $paper.Dispose()
      $accent.Dispose()
      $border.Dispose()
      $marks.Dispose()
    }

    $outputPath = Join-Path $outputDirectory "icon-$Size.png"
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "[pages-icons] wrote $outputPath"
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

Write-PwaIcon 192
Write-PwaIcon 512
