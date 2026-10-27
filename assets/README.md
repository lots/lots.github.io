# assets —— 图标资源

## 换 logo：只覆盖一个文件

原图是 **`logo-source.png`**（当前：TARUMT 校徽，447×447，带透明通道）。
用你的新图覆盖它，再跑一次导出脚本即可：

```bash
node tools/export-icons.js        # 重出下面表格里的全部成品
```

需要本机装有 Chrome 或 Edge（脚本用无头浏览器做缩放，无需安装任何依赖）；
也可用 `CHROME_PATH="/usr/bin/chromium" node tools/export-icons.js` 指定。

也可以**直接覆盖成品文件**（例如只换操作条那一个）：每个用途只有一个文件，
手机上同样会用到它 —— 这正是下面这条注意事项的由来。

## ⚠️ 为什么页面里不写 `srcset`

早先的写法是：

```html
<img src="assets/logo-96.png"
     srcset="assets/logo-96.png 1x, assets/logo-96@2x.png 2x" …>
```

结果：**PC 上显示正常，手机上 logo 不见了**。原因是手机的像素密度 ≥2，
浏览器只挑选 `2x` 那个候选文件，`1x` 那份**根本不会被加载** ——
手工只替换了 `1x`，手机取到的还是旧图（或换图后两边不一致）。

现在的做法：**每个用途只导出一个文件，并按"显示尺寸的 3 倍"出图**。
手机上清晰（3 倍余量够 2×/3× 屏），PC 上由浏览器顺手缩小，换图也只需换一个文件。

| 成品 | 用在哪 | 文件像素 | 页面显示 |
| --- | --- | --- | --- |
| `logo-brand.png` | 设置页标题旁 | 288×288 | 96×96 |
| `logo-strip.png` | 棋钟操作条 | 144×144 | 48×48 |
| `icon-180.png` | iOS「添加到主屏幕」 | 180×180 | — |
| `icon-64.png` | favicon（高分屏） | 64×64 | — |
| `icon-32.png` | favicon | 32×32 | — |

显示尺寸写在 `styles.css` 的 `.brand-logo` / `.strip-logo` 与 `index.html` 对应的
`width`/`height` 上；三者（CSS、HTML、本脚本的 `JOBS`）要一起改，测试会核对。

## 其它文件

| 文件 | 说明 |
| --- | --- |
| `logo.svg` | **旧版 CoQ 图形**（蓝底，矢量），界面不使用，留作备用；现行版本是 `logo-coq.svg` |
| `logo-coq.svg` / `logo-mwa.svg` / `logo-chess.svg` / `logo-weiqi.svg` | 四个标志的矢量源，见下一节 |
| `logo-{coq,mwa,chess,weiqi}-{32..512}.png` | 四个标志的 PNG 成品（每个 9 档，共 36 张），由 `tools/export-logos.js` 生成 |
| `TARUMT_shield*.png/.jpg` | 校徽的原始素材与你自己导出的尺寸，脚本不会动它们 |
| `_icon-*.png` | 早期手工备份，脚本不会动 |

## 四个标志：CoQ / MWA / Chess / 围棋

| 标志 | 矢量源 | 图形 |
| --- | --- | --- |
| **CoQ 棋钟** | `logo-coq.svg` | 木色底（与围棋标志**完全同一套渐变**）+ 黑白两只表盘 + 顶部拍钟键 + `CoQ` 字标 |
| **MWA**（Malaysia Weiqi Association） | `logo-mwa.svg` | 官方会徽的方形版：金黄底 + 左黑右白两颗棋子 + 每颗棋子上一道弧线反光 |
| **Chess**（国际象棋） | `logo-chess.svg` | 象牙白底 + 墨色「车 / Rook」+ 一条主蓝细线 |
| **围棋**（Weiqi / Go） | `logo-weiqi.svg` | 木色棋盘 + 网格 + 一黑一白两颗棋子 |

四个标志用同一套几何：**64×64 画布、圆角方块底（rx 15）**，
所以和 TARUMT 校徽并排出现时不违和；在深色界面、浅色界面、白底文档里都做了对比度检查。

### 界面里的点击循环

设置页页头（96×96）和棋钟操作条（48×48）的 logo 都是按钮：点一下按
**TARUMT → CoQ → Chess → 围棋 → MWA** 循环，选择存进 `localStorage`，下次打开保持；
两处永远同步，链接里加 `?logo=<id>` 可临时指定（不写盘）。两处用的文件：
TARUMT = `logo-brand.png` / `logo-strip.png`，其余 = `logo-*-512.png` / `logo-*-192.png`。

### MWA 会徽的出处

官方会徽在官网封面：<https://weiqi.org.my/zh>，图源
<https://weiqi.org.my/brand/mwa-emblem-stones.png>（215×135，黄底 + 一黑一白两颗带弧线反光的棋子）。

`logo-mwa.svg` 只做「方形图标化」，没有重画图形：金黄底、左黑右白、叠压关系（黑子压白子）、
反光弧的角度（黑子 255°→355°、白子 270°→355°）都按官方原图量取；只有圆心距略收窄，
好让两颗棋子填满方形画布。官方若改版，按新原图更新这个文件即可。

### 尺寸：按设备选档

| 场景 | 显示尺寸 | 用哪张 PNG |
| --- | --- | --- |
| 手机 标题栏 / 列表 | 32–48 pt | `logo-*-96.png`（3×） |
| 手机 主屏图标 | 180 / 192 | `logo-*-180.png`（iOS）/ `logo-*-192.png`（Android） |
| 8 英寸平板 标题栏 | 56–64 pt | `logo-*-128.png`（2×） |
| 8 英寸平板 应用图标 | 192 | `logo-*-192.png` |
| 个人电脑 标题栏 | 96 CSS px | `logo-*-256.png`（2×） |
| 个人电脑 工具栏 / 卡片 | 32–48 / 64 px | `logo-*-96.png` / `logo-*-128.png` |
| favicon | 32 / 64 | `logo-*-32.png` / `logo-*-64.png` |

规则：**PNG 像素 ≥ 显示尺寸 × 屏幕密度**。手机 2×/3× 屏上，32 pt 的图标要用 96 px 的文件，
用 48 px 的会发虚；反过来 PC 上用 512 也没问题，浏览器会缩小。

想省事就直接用 `.svg`：矢量，任意尺寸、任意密度都清晰，这是首选。

### 九档 PNG 与重新导出

每个标志各一套：`32 / 48 / 64 / 96 / 128 / 180 / 192 / 256 / 512`，四个标志共 36 张。

```bash
node tools/export-logos.js              # 四个标志全部重出
node tools/export-logos.js --only=mwa   # 只重出 MWA（coq / mwa / chess / weiqi）
```

改设计只改对应的 `.svg`，再跑一次脚本即可；和 `export-icons.js` 一样用无头 Chrome/Edge 渲染，
不用装依赖。`screenshots/logos-devices.png` 是手机 / 8 英寸平板 / PC 三档的尺寸示意。

界面目前还没有引用这些图；要用时按上表选档，例如：

```html
<img src="assets/logo-mwa-96.png" width="32" height="32" alt="MWA">
```

