"""按实现原样（不是示意图）画一遍：旧形态 + 半透明白胶囊文字。

对齐 src/client.js：FAB_TILE=60 / FAB_INNER=46 / gap 6 / 胶囊 padding 1px 7px / 字号 11 700 /
胶囊底色 rgba(255,255,255,.90) + 1px 边 + 轻阴影。
深色壁纸、浅色壁纸各一遍，1:1 真实像素 + 2.5 倍放大。
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1240, 700
CJK = "C:/Windows/Fonts/msyh.ttc"
CJK_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
TILE, INNER, GAP = 60, 46, 6
LABEL = "手机连 DSH"


def font(size, bold=True):
    try:
        return ImageFont.truetype(CJK_BOLD if bold else CJK, int(size))
    except OSError:
        return ImageFont.load_default()


tail = Image.open("icon-transparent.png").convert("RGBA").resize((INNER, INNER), Image.LANCZOS)


def soft_shadow(canvas, x, y, w, h, radius, alpha=80, blur=8, dy=5):
    sh = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([30, 30 + dy, 30 + w - 1, 30 + dy + h - 1], radius=radius,
                                         fill=(0, 0, 0, alpha))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.paste(sh, (x - 30, y - 30), sh)


def make_fab(badge=False, color='#33405c', text=LABEL):
    """返回一张 96x84 的悬浮球位图（和页面里 render 出来的结构一致）。"""
    w, h = 96, TILE + GAP + 18
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    tx = (w - TILE) // 2
    soft_shadow(img, tx, 0, TILE, TILE, 16)
    d.rounded_rectangle([tx, 0, tx + TILE - 1, TILE - 1], radius=16, fill=(255, 255, 255, 255),
                        outline=(228, 234, 244, 255))
    off = (TILE - INNER) // 2
    img.paste(tail, (tx + off, off), tail)
    if badge:
        d.ellipse([tx + TILE - 14, -4, tx + TILE + 4, 14], fill=(225, 29, 72), outline=(255, 255, 255), width=2)
        t1 = d.textlength("1", font=font(11))
        d.text((tx + TILE - 14 + 5 - t1 / 2, -2), "1", font=font(11), fill=(255, 255, 255))
    # 胶囊
    f = font(11)
    tw = d.textlength(text, font=f)
    pw, ph = int(tw + 16), 18
    px, py = int((w - pw) / 2), TILE + GAP
    soft_shadow(img, px, py, pw, ph, ph // 2, alpha=55, blur=6, dy=2)
    d.rounded_rectangle([px, py, px + pw - 1, py + ph - 1], radius=ph // 2, fill=(255, 255, 255, 230),
                        outline=(232, 237, 246, 255))
    d.text((px + 8, py + 2), text, font=f, fill=color)
    return img


# 背景：上半深色壁纸、下半浅色壁纸
bg = Image.new("RGB", (W, H), (18, 26, 44))
d = ImageDraw.Draw(bg)
for y in range(0, 350):
    t = y / 350
    d.line([(0, y), (W, y)], fill=(int(16 + 18 * t), int(24 + 26 * t), int(44 + 34 * t)))
for cx, cy, r, col in [(1040, 160, 250, (46, 78, 138)), (240, 280, 200, (36, 60, 108))]:
    for i in range(r, 0, -8):
        top = bg.crop((0, 0, W, 350))
        bg.paste(Image.blend(top, Image.new("RGB", (W, 350), col), 0.02 * (1 - i / r)), (0, 0))
for y in range(350, H):
    t = (y - 350) / (H - 350)
    d.line([(0, y), (W, y)], fill=(int(236 - 16 * t), int(241 - 14 * t), int(247 - 10 * t)))
blob = Image.new("RGB", (W, H), (222, 231, 243))
mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(mask).ellipse([900 - 190, 470 - 190, 900 + 190, 470 + 190], fill=26)
bg = Image.composite(blob, bg, mask)
d = ImageDraw.Draw(bg)

plain = make_fab(False)
badged = make_fab(True, color='#c0271b', text='1 台刚连入')

# 深色区（1:1）
for i, (img, cx) in enumerate([(plain, 260), (badged, 560)]):
    bg.paste(img, (cx - img.width // 2, 150), img)
d.text((40, 30), "按实现原样画的：白色方块 60px + 鲸尾 46px，字垫一块半透明白胶囊",
       font=font(18), fill=(255, 255, 255))
d.text((40, 62), "深色壁纸（上）和浅色壁纸（下）各一遍，1:1 真实像素；右边最大那个是 2.5 倍放大。",
       font=font(12, False), fill=(152, 170, 198))

# 浅色区（1:1）
for img, cx in [(plain, 260), (badged, 560)]:
    bg.paste(img, (cx - img.width // 2, 420), img)

# 放大 2.5 倍
Z = 2.5
big = plain.resize((int(plain.width * Z), int(plain.height * Z)), Image.LANCZOS)
soft_shadow(bg, 820, 420, big.width, big.height, int(16 * Z), alpha=90, blur=14, dy=10)
bg.paste(big, (820, 420), big)

d = ImageDraw.Draw(bg)
d.text((64, 250), "平时：\n手机连 DSH", font=font(12.5, False), fill=(158, 176, 204), spacing=7)
d.text((470, 250), "有新设备连入：\n字变红并报数", font=font(12.5, False), fill=(158, 176, 204), spacing=7)
d.text((64, 560), "浅色壁纸同样清楚：\n胶囊自带底色，不靠壁纸颜色。",
       font=font(12.5, False), fill=(52, 64, 88), spacing=7)
d.text((820, 660), "2.5 倍放大：鲸尾 46px 在 60px 方格里留白均匀，胶囊底几乎看不出边界。",
       font=font(12, False), fill=(72, 84, 108))

bg.convert("RGB").save("test/mock_label2.png")
print("test/mock_label2.png", bg.size)
