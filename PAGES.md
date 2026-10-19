# GitHub Pages 发布清单（lots.github.io）

站点仓库：`lots/lots.github.io`（公开，启用 Pages，分支 `main`）
应用源码仓库：`lots/ChessClock` ← **只从这里往外拷，不要反向修改**

本文件是"发布到 Pages 时该放哪些文件"的唯一清单。目的是让站点又小又干净，
同时避免把测试、脚本、图标原图、备份图这些**只在开发时有用**的东西推到公网。

---

## 一、应该发布的文件（白名单）

严格只需这 12 个；除最后两项外都是页面直接引用的：

| 路径 | 大小 | 作用 |
| --- | --- | --- |
| `index.html` | 10.7 KB | 页面结构（唯一入口） |
| `styles.css` | 17.3 KB | 样式 + 三套主题变量 |
| `engine.js` | 15.8 KB | 计时引擎（纯逻辑） |
| `i18n.js` | 13.9 KB | 中英词条表 |
| `app.js` | 31.7 KB | 界面与操作层 |
| `assets/icon-32.png` | 2.3 KB | favicon |
| `assets/icon-64.png` | 7.6 KB | favicon（高分屏） |
| `assets/icon-180.png` | 47.1 KB | iOS「添加到主屏幕」图标 |
| `assets/logo-brand.png` | 104.8 KB | 设置页 logo（96×96 显示） |
| `assets/logo-strip.png` | 32.1 KB | 操作条 logo（48×48 显示） |
| `README.md` | 26.7 KB | 仓库首页说明（英文） |
| `README_CN.md` | 24.6 KB | 仓库首页说明（华文） |
| `screenshots/midgame-portrait.png` | 149.5 KB | README 示意图 |
| `screenshots/byoyomi-portrait.png` | 150.4 KB | README 示意图 |
| `screenshots/midgame-landscape.png` | 157.7 KB | README 示意图 |

合计约 **790 KB**。

> 表内大小取自源码仓库。站点仓库里同样的文件会略大约 2–5%，因为那边行尾是 CRLF
> （内容一致，见第四节实测）。

### README 的截图：已解决 ✓

两份 README 现在引用的是 **`screenshots/`** 下的三张图（不再引用 `tests/`），
所以站点只需发布 `screenshots/` 这一个目录即可，不再需要发布 `tests/`。
主仓库里 `tests/visual/shoot.ps1` 每次截图后会自动同步 `screenshots/`，
测试（`tests/project.test.js`）也会核对两边逐字节一致，以及 README 里每个 `<img src>` 真实存在。


---

## 二、不该发布的文件（**已于 2026-10-12 删除** ✓，共删 29 个文件）

| 路径 | 大小 | 为什么不该在站点上 |
| --- | --- | --- |
| `assets/bak/`（19 个） | ~280 KB | 图标/logo 的历史备份与 `_ori` 原件 |
| `assets/TARUMT_shield.png` | 221.8 KB | 校徽原图（开发素材） |
| `assets/TARUMT_shield_96x96.png` | 15.8 KB | 同上 |
| `assets/TARUMT_shield_48x48.png` | 4.7 KB | 同上 |
| `assets/logo-source.png` | 221.8 KB | 图标**原图**（只在跑 `tools/export-icons.js` 时用） |
| `assets/logo.svg` | 2.1 KB | 旧版 CoQ 矢量图（界面不使用） |
| `assets/README.md` | 2.2 KB | 换图标说明（开发文档） |
| `serve.js` | 2.8 KB | 局域网开发服务器 |
| `package.json` | 0.6 KB | npm 脚本（`npm test` 等） |

> 注意：两份 README 里有「细节见 `assets/README.md`」的链接，删掉这个文件后该链接会失效 ✗
> （影响很小，但先知道）。

一条命令删完（在站点仓库的克隆里执行）：

```powershell
git rm -r assets/bak
git rm assets/TARUMT_shield.png assets/TARUMT_shield_96x96.png assets/TARUMT_shield_48x48.png `
       assets/logo-source.png assets/logo.svg assets/README.md serve.js package.json
git commit -m "Publish only the site runtime"
git push
```

---

## 三、以后怎么发布（避免杂物再跑回来）

**别整个目录拷**（`tests/`、`tools/`、`_scene-*.html`、`assets/bak/` 就是这样被带上去的）。
用这份白名单拷：

```powershell
# 1) 准备站点仓库（首次）
cd C:\Users\ILLEGEAR\myDev
git clone https://github.com/lots/lots.github.io.git

# 2) 只拷白名单里的文件
$src = 'C:\Users\ILLEGEAR\myDev\DSH\ChessClock'
$dst = 'C:\Users\ILLEGEAR\myDev\lots.github.io'
Copy-Item "$src\index.html","$src\styles.css","$src\engine.js","$src\i18n.js","$src\app.js" $dst -Force
New-Item -ItemType Directory -Force "$dst\assets" | Out-Null
'icon-32.png','icon-64.png','icon-180.png','logo-brand.png','logo-strip.png' |
    ForEach-Object { Copy-Item "$src\assets\$_" "$dst\assets\" -Force }
Copy-Item "$src\README.md","$src\README_CN.md" $dst -Force

# README 用的三张示意图（主仓库的 screenshots/ 由 npm run shots 自动同步）
New-Item -ItemType Directory -Force "$dst\screenshots" | Out-Null
Copy-Item "$src\screenshots\*.png" "$dst\screenshots\" -Force

# 3) 看一眼再提交
cd $dst
git status --short          # 只应出现白名单内的文件
git add -A
git commit -m "Sync the published site with ChessClock"
git push
```

**发布前自检**（在站点仓库里执行，输出应为空）：

```powershell
git ls-files | Select-String -Pattern '^tests/|^tools/|^_scene-|^assets/bak/|^serve\.js$|^package\.json$'
```

---

## 四、本次核查与执行记录（2026-10-12）

用 `git clone --depth 1` 实拉远端 `main` 后统计与比对，并执行了清理：

- 清理前：**41 个文件 / 1.15 MB**；`tests/`、`tools/`、`_scene-*.html` 此前已删除 ✓
- 清理后：**15 个文件 / 792.2 KB**（删 29、改 2、增 3 张 `screenshots/`）✓
  - 提交 `187a6b4`，远端 `main` 已复核为该提交 ✓
- 最终树与第一节白名单**逐项一致**（5 个应用文件 + 5 个 assets 图 + 2 份 README + 3 张截图）✓
- **与源码仓库逐文件比对（SHA256）**：清理前，
  `index.html`、`styles.css`、`engine.js`、`i18n.js`、`app.js`、`README.md`、`README_CN.md`
  七份 **内容完全一致** ✓（字节差 197–896 B 全部来自行尾 CRLF）；
  页面引用的 5 个 PNG（`icon-32`、`icon-64`、`icon-180`、`logo-brand`、`logo-strip`）
  **哈希完全相同** ✓
- 本地已保留一份干净的站点克隆：`C:\Users\ILLEGEAR\myDev\lots.github.io`（与远端 HEAD 同步），
  以后按第三节的白名单同步即可 ✓
