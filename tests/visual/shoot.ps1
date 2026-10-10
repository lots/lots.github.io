# 用无头 Chrome 给各场景截图，做视觉回归校验。
#
#   node tests/visual/build.js                 # 先生成场景页（项目根目录下的 _scene-*.html）
#   powershell -ExecutionPolicy Bypass -File tests/visual/shoot.ps1
#
# 说明：
#  * 每个场景使用独立的 user-data-dir，避免 Chrome 把请求转发给本机已打开的浏览器会话；
#  * 场景页里会把页面钉成精确的设备尺寸（w/h 查询参数），因为无头 Chrome 的 --window-size
#    并不会改变布局视口，不钉住的话截出来的图会与真实手机不一致；
#  * 截图完成后可删除 _scene-*.html 与 .chrome-profile-* （后者被 Chrome 占用时删不掉属正常）。

param(
  # 只截其中几个场景（逗号分隔，名字见下面的 $jobs），空 = 全截。
  # 例：-Only 'setup,midgame-portrait'  —— 改完样式想快速看一眼时很有用，
  # 因为 byoyomi/critical/flag 三个场景带了 60~97 秒的虚拟时间预算，全跑要几分钟。
  [string]$Only = '',
  # 像素密度：1 = 普通 PC 显示器，2 = 手机/Retina（默认）。
  # 手机专用资源（例如 srcset 选错）这类问题只有在 2 下才暴露得出来。
  [int]$Scale = 2
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$out = Join-Path $PSScriptRoot 'out'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) { $chrome = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
if (-not (Test-Path $chrome)) { throw '未找到 Chrome / Edge' }

$jobs = @(
  @{ name = 'setup';             scene = 'setup';    w = 390; h = 844; budget = 2000 },
  @{ name = 'midgame-portrait';  scene = 'midgame';  w = 390; h = 844; budget = 8000 },
  @{ name = 'byoyomi-portrait';  scene = 'byoyomi';  w = 390; h = 844; budget = 97000 },
  @{ name = 'states-portrait';   scene = 'states';   w = 390; h = 844; budget = 4000 },
  @{ name = 'critical-portrait'; scene = 'critical'; w = 390; h = 844; budget = 60000 },
  @{ name = 'flag-portrait';     scene = 'flag';     w = 390; h = 844; budget = 80000 },
  @{ name = 'midgame-landscape'; scene = 'midgame';  w = 844; h = 390; budget = 8000 }
)

foreach ($j in $jobs) {
  if ($Only -ne '' -and (($Only -split ',') -notcontains $j.name)) { continue }
  $png = Join-Path $out ($j.name + $(if ($Scale -eq 2) { '' } else { "@${Scale}x" }) + '.png')
  if (Test-Path $png) { Remove-Item $png -Force }
  $prof = Join-Path $root ('.chrome-profile-' + $j.name)
  if (Test-Path $prof) { Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue }
  $url = 'file:///' + ($root -replace '\\', '/') + '/_scene-' + $j.scene + '.html?scene=' + $j.scene +
         '&w=' + $j.w + '&h=' + $j.h
  & $chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check `
    "--user-data-dir=$prof" "--window-size=$($j.w),$($j.h)" "--force-device-scale-factor=$Scale" `
    "--virtual-time-budget=$($j.budget)" "--screenshot=$png" $url 2>$null | Out-Null
  if (Test-Path $png) {
    Write-Output ('OK   {0,-20} {1} bytes' -f $j.name, (Get-Item $png).Length)
  } else {
    Write-Output ('FAIL {0}' -f $j.name)
  }
}
