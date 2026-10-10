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
| `logo.svg` | **旧版 CoQ 图形**（矢量），当前界面已不使用，留作备用/参考 |
| `TARUMT_shield*.png/.jpg` | 校徽的原始素材与你自己导出的尺寸，脚本不会动它们 |
| `_icon-*.png` | 早期手工备份，脚本不会动 |
