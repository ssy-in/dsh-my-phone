"""把用户提供的 logo 原图（棋盘格背景 + 右下角「豆包AI生成」水印）清理成真透明 PNG。

做法：
1. 从四边 floodfill 吃掉棋盘格（阈值内视为背景），得到 alpha 掩膜；
2. 右下角水印区里「低饱和度灰字」一并判成背景（鲸鱼是深蓝/青色，饱和度都高，不会误伤）；
3. 边缘做一次反预乘（bg≈白）去掉白边，再轻微羽化；
4. 按内容裁边 → 居中放进正方形画布（留 4% 内边距）→ 输出 512 / 96 两份 PNG。

用法：python tools/clean_logo.py <源图> <输出目录>
"""
import sys
import base64
from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else r"H:\因爱而生的鱼\dsh-my-phone\_logo_src.png"
OUTDIR = sys.argv[2] if len(sys.argv) > 2 else r"H:\因爱而生的鱼\dsh-my-phone"

src = Image.open(SRC).convert("RGB")
W, H = src.size
print("source", W, "x", H)

# ---- 1. floodfill 棋盘格 --------------------------------------------------
SENT = (255, 0, 255)
work = src.copy()
# 只用「确实属于棋盘格」的种子：沿边取点时必须先确认它和角落同色。
# （踩过的坑：鲸鱼尾巴的深蓝躯干一直伸到画面底边，早期版本把底边每 24px 的点全当种子，
#   其中一个种子落在深蓝上 → floodfill 把整块深蓝都填成背景色，出来只剩青色叶瓣。）
px = src.load()
corner = px[0, 0]
same = lambda c: abs(c[0] - corner[0]) + abs(c[1] - corner[1]) + abs(c[2] - corner[2]) <= 40
seeds = []
for x in range(0, W, 12):
    for y in (0, H - 1):
        if same(px[x, y]):
            seeds.append((x, y))
for y in range(0, H, 12):
    for x in (0, W - 1):
        if same(px[x, y]):
            seeds.append((x, y))
seeds += [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]
print("seeds", len(seeds))
for s in seeds:
    try:
        # 阈值 70：棋盘格的两档灰只差 4~6，48 会漏掉边缘残留，70 刚好把它们吃掉，
        # 又不会咬进被深蓝描边围住的浅青内部（内部是封闭区域，floodfill 到不了）。
        ImageDraw.floodfill(work, s, SENT, thresh=70)
    except Exception:
        pass

arr = np.array(work).astype(np.int16)
bg = np.all(arr == np.array(SENT, dtype=np.int16), axis=-1)

rgba = np.array(src.convert("RGBA")).astype(np.float32)
alpha = np.where(bg, 0.0, 255.0)
print("bg pixels", int(bg.sum()), "of", bg.size)

# ---- 2. 水印（右下角灰字） -----------------------------------------------
mx, my = int(W * 0.62), int(H * 0.70)
region = rgba[my:, mx:, :3]
mx_c = region.max(axis=-1)
mn_c = region.min(axis=-1)
grey = (mx_c - mn_c) < 26  # 「豆豆AI生成」是灰字，鲸鱼是彩色的
sub = alpha[my:, mx:]
sub[grey] = 0.0
alpha[my:, mx:] = sub

# ---- 3. 反预乘 + 羽化 ----------------------------------------------------
a = alpha / 255.0
safe = np.where(a > 0.02, a, 1.0)
for c in range(3):
    ch = rgba[:, :, c]
    rgba[:, :, c] = np.clip((ch - (1.0 - a) * 255.0) / safe, 0, 255)

out = np.dstack([rgba[:, :, :3], alpha]).astype(np.uint8)
img = Image.fromarray(out, "RGBA")

# 轻微羽化：只在边缘起作用（对 alpha 做 0.6px 高斯）
alpha_img = img.getchannel("A").filter(__import__("PIL.ImageFilter", fromlist=["ImageFilter"]).GaussianBlur(0.6))
img.putalpha(alpha_img)

# ---- 4. 裁边 → 正方形 → 输出 --------------------------------------------
bbox = img.getchannel("A").getbbox()
print("content bbox", bbox)
if bbox:
    img = img.crop(bbox)

side = max(img.size)
pad = 0  # 用户要求：图标四周不留透明边
canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
canvas.paste(img, ((canvas.size[0] - img.size[0]) // 2, (canvas.size[1] - img.size[1]) // 2), img)

big = canvas.resize((512, 512), Image.LANCZOS)
small = canvas.resize((96, 96), Image.LANCZOS)
big.save(f"{OUTDIR}\\icon-transparent.png")
big.save(f"{OUTDIR}\\icon.png")
big.save(f"{OUTDIR}\\icon-256.png")
small.save(f"{OUTDIR}\\icon-96.png")

# ---- 5. icon.svg（内嵌 base64 PNG，跟仓库里原来那份同一个结构） ----------
buf = BytesIO()
big.save(buf, format="PNG", optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode()
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" '
    'role="img" aria-label="DSH My Phone">\n'
    "  <title>DSH My Phone</title>\n"
    f'  <image width="512" height="512" href="data:image/png;base64,{b64}"/>\n'
    "</svg>\n"
)
with open(f"{OUTDIR}\\icon.svg", "w", encoding="utf-8") as fh:
    fh.write(svg)

print("wrote icon-transparent.png / icon.png / icon-256.png / icon-96.png / icon.svg")
print("svg bytes", len(svg))
