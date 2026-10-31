# 设计过程留档

这里的图片不是产品资产，是**设计决策的现场记录**——每次“看着不对”的时候我用 Pillow 按 1:1 真实像素画出来对比，让选择有据可依，而不是靠形容词吵架。

| 文件 | 当时在决定什么 | 结论 |
| --- | --- | --- |
| `mock_fab*.py/png` | 悬浮球该长什么样：裸球 / 白卡片 / 文字烧进图里 | 选 App 图标形态（图标 + DOM 一行字），文字由页面渲染、不烧进 PNG |
| `mock_label*.py/png` | 文字在壁纸上看不清怎么办：描边 / 半透明白胶囊 / 深色胶囊 | 选半透明白胶囊（浅深壁纸都清楚） |
| `mock_letter.png` | 气泡排版要不要“像写信” | 定稿信笺结构：橡皮章式小标签 + 信头时间 + 正文 + 右下落款 |
| `mock_priority.png` | 消息提醒的三档颜色 | P0 琥珀（新设备首连）/ P1 橙（危险开关、会话失败）/ P2 蓝绿（一般信息） |
| `logo_check.png` | 清理水印/底图后的 logo 校验图 | 用 `tools/clean_logo.py` 从原图产出透明底鲸尾 |

## 注意

这些脚本里的路径是**绝对路径**（`H:\因爱而生的鱼\dsh-my-phone\...`），因为它们原本是临时脚本，从 `test/` 移到 `docs/design/` 后没改内部路径。要复用就把路径改成本目录，或直接看 PNG。

真正进产品的图标由 `tools/` 生成：

```bash
python tools/clean_logo.py            # 原图 → icon.png / icon-transparent.png / icon-256.png / icon-96.png / icon.svg
python tools/make_icon_tile.py        # icon-badge.png → 带底色的 App 方块（icon-96.png）
python tools/make_tight_icon.py       # icon.png → icon-tight.png（裁掉透明留白，悬浮球用）
```
