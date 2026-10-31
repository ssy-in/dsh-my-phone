"""把插件图标做成「App 图标块」：圆角方形 + 天空/鲸尾画面。

原来的 icon.png / icon-transparent.png 是透明底的一尾青色鲸尾 —— 贴在白色方块里几乎看不出形状
（青白撞色），这也是「icon 看不清」的直接原因。icon-badge.png 是同一条鲸尾压在天空+海面里，
裁圆角方之后自带颜色和层次，缩小到 44px 依然认得出。
"""
from PIL import Image, ImageDraw

SRC = "icon-badge.png"
OUT96 = "icon-96.png"
OUT256 = "icon-256.png"

im = Image.open(SRC).convert("RGB")
w, h = im.size
# 把外面那圈白边裁掉一点，让画面铺满图标块
m = int(w * 0.035)
sq = im.crop((m, m, w - m, h - m)).resize((512, 512), Image.LANCZOS)

mask = Image.new("L", (512, 512), 0)
d = ImageDraw.Draw(mask)
# iOS/Android 那种圆角比例（边长 22% 左右）
d.rounded_rectangle([0, 0, 511, 511], radius=112, fill=255)

tile = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
tile.paste(sq, (0, 0), mask)
tile.save(OUT256)
tile.resize((96, 96), Image.LANCZOS).save(OUT96)
print(f"{OUT256} 512x512, {OUT96} 96x96 ok")
