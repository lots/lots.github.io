# assets —— 图标资源

## 想换图标？只改一个文件

**`logo.svg`** 是图形源（含顶部字标 CoQ）。页面里两处 logo 与浏览器标签页图标用的 PNG
都是由它导出的 —— 改完 SVG 跑一次导出脚本即可，不用动 HTML / CSS / JS：

```bash
node tools/export-icons.js      # 重出下面表格里的全部 PNG
```

需要本机装有 Chrome 或 Edge；也可用环境变量指定，例如
`CHROME_PATH="/usr/bin/chromium" node tools/export-icons.js`。

写 `logo.svg` 时的几条约定：

* 画布固定 `viewBox="0 0 64 64"`，从 16px 缩到 512px 都不会糊；
* 只用圆角矩形、圆、线段这类基本图形，方便手改
  （顶部字标 CoQ 用的是系统无衬线字体，不引用任何外部字体文件）；
* 不引用外部位图（否则离线打开或托管时会挂）。

## 文件

| 文件 | 用途 | 像素 |
| --- | --- | --- |
| `logo.svg` | **图形源**：下面所有 PNG 都由它渲染 | 64×64 的 viewBox |
| `logo-96.png` | 设置页标题旁的 logo（页面引用的是它） | 96×96 |
| `logo-96@2x.png` | 同上，`srcset` 里的 2× 版（高分屏不发虚） | 192×192 |
| `logo-48.png` | 棋钟操作条里的 logo | 48×48 |
| `logo-48@2x.png` | 同上，2× 版 | 96×96 |
| `icon-32.png` | favicon（老浏览器） | 32×32 |
| `icon-64.png` | favicon（高分屏） | 64×64 |
| `icon-180.png` | iOS「添加到主屏幕」图标 | 180×180 |

> 显示尺寸写在 `styles.css` 的 `.brand-logo` / `.strip-logo` 与 `index.html` 对应的
> `width`/`height` 属性上；要一起改的话，`tools/export-icons.js` 顶部的 `LOGO_JOBS`
> 也要同步（测试会核对三处是否一致）。
