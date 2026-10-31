"""1:1 对比 + 放大：旧悬浮球（透明鲸尾 + 裸文字）vs 新悬浮球（白卡片兜住 App 图标块 + 文字）。

关键点：先渲染一张 1:1 的悬浮球位图，再把它原样放大 2.5 倍 —— 这样放大图和小图一定一致，
不会出现「脚本手算坐标算歪了、看着像画的不是同一个东西」的情况。
尺寸严格对齐 src/client.js：FAB_TILE=46 / FAB_W=92 / FAB_H=84 / label 11.5px。
输出 test/mock_fab2.png（1240x560）。
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1240, 560
CJK = "C:/Windows/Fonts/msyh.ttc"
CJK_BOLD = "C:/Windows/Fonts/msyhbd.ttc"

TILE, CARD_W, CARD_H = 46, 92, 84
LABEL = "手机连 DSH"


def font(size, bold=False):
    try:
        return ImageFont.truetype(CJK_BOLD if bold else CJK, int(size))
    except OSError:
        return ImageFont.load_default()


tile = Image.open("icon-96.png").convert("RGBA").resize((TILE, TILE), Image.LANCZOS)
tail = Image.open("icon-transparent.png").convert("RGBA").resize((TILE, TILE), Image.LANCZOS)


def render_new(badge=True):
    """新：白卡片 W×H，里面图标 + 一行字（+ 可选红点）。"""
    img = Image.new("RGBA", (CARD_W, CARD_H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    dd.rounded_rectangle([0, 0, CARD_W - 1, CARD_H - 1], radius=20, fill=(255, 255, 255, 255),
                         outline=(214, 224, 239, 255))
    ix = (CARD_W - TILE) // 2
    img.paste(tile, (ix, 8), tile)
    f = font(11.5, True)
    tw = dd.textlength(LABEL, font=f)
    dd.text(((CARD_W - tw) / 2, 8 + TILE + 4), LABEL, font=f, fill=(64, 82, 110))
    if badge:
        r = 9
        cx, cy = CARD_W - 20, 15
        dd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(225, 29, 72), outline=(255, 255, 255), width=2)
        t1 = dd.textlength("1", font=font(11, True))
        dd.text((cx - t1 / 2, cy - 7), "1", font=font(11, True), fill=(255, 255, 255))
    return img


def render_old():
    """旧：白色方块里放透明鲸尾，文字裸挂在壁纸上。"""
    w, h = 72, 92
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    dd.rounded_rectangle([0, 0, 67, 67], radius=17, fill=(255, 255, 255, 255), outline=(214, 224, 239, 255))
    img.paste(tail, ((68 - TILE) // 2, (68 - TILE) // 2), tail)
    f = font(11.5, True)
    tw = dd.textlength(LABEL, font=f)
    dd.text(((68 - tw) / 2, 74), LABEL, font=f, fill=(96, 110, 132))
    return img


def shadow(canvas, x, y, w, h, radius, alpha=90, blur=10, dy=8):
    sh = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([30, 30 + dy, 30 + w - 1, 30 + dy + h - 1], radius=radius,
                                         fill=(0, 0, 0, alpha))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.paste(sh, (x - 30, y - 30), sh)


# 深色壁纸（渐变 + 两团光斑），模拟装了壁纸插件的桌面
bg = Image.new("RGB", (W, H), (18, 26, 44))
d = ImageDraw.Draw(bg)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(16 + 18 * t), int(24 + 26 * t), int(44 + 34 * t)))
for cx, cy, r, col in [(1010, 140, 260, (46, 78, 138)), (280, 470, 220, (36, 60, 108))]:
    for i in range(r, 0, -6):
        bg = Image.blend(bg, Image.new("RGB", (W, H), col), 0.02 * (1 - i / r))
d = ImageDraw.Draw(bg)

old_img = render_old()
new_img = render_new(True)
new_plain = render_new(False)

# 左：旧 1:1
x0 = 150
shadow(bg, x0, 120, 68, 68, 17, alpha=45)
bg.paste(old_img, (x0, 120), old_img)

# 中：新 1:1
x1 = 430
shadow(bg, x1, 120, CARD_W, CARD_H, 20, alpha=85)
bg.paste(new_img, (x1, 120), new_img)

# 右：新放大 2.5 倍（直接放大那张 1:1 位图，保证一致）
Z = 2.5
big = new_img.resize((int(CARD_W * Z), int(CARD_H * Z)), Image.LANCZOS)
bx, by = 860, 110
shadow(bg, bx, by, big.width, big.height, int(20 * Z), alpha=105, blur=16, dy=12)
bg.paste(big, (bx, by), big)

d = ImageDraw.Draw(bg)
d.text((40, 40), "DSH My Phone 悬浮球：旧 vs 新（左中两个是 1:1 真实像素，右边是 2.5 倍放大）",
       font=font(18, True), fill=(255, 255, 255))
d.text((x0 - 30, 232), "旧：白色方块 + 透明鲸尾，\n文字直接压在壁纸上\n—— 两条都看不清。",
       font=font(13), fill=(158, 176, 204), spacing=8)
d.text((x1 - 40, 232), "新：一张白卡片\n把图标块和文字兜住，\n壁纸再花也读得清。",
       font=font(13), fill=(158, 176, 204), spacing=8)
d.text((bx + 6, by + big.height + 18), "放大 2.5 倍：图标自带天空+海，\n字是深灰粗体；右上红点是未读数。",
       font=font(13), fill=(158, 176, 204), spacing=8)

# 右下角补一个「无红点」的 1:1，说明平时长什么样
px, py = 430, 380
shadow(bg, px, py, CARD_W, CARD_H, 20, alpha=70)
bg.paste(new_plain, (px, py), new_plain)
d.text((px + CARD_W + 16, py + 24), "没有新连接时就是这样（1:1），\n拖到任意一边都会自己贴边。",
       font=font(12.5), fill=(140, 158, 188), spacing=7)

bg.convert("RGB").save("test/mock_fab2.png")
print("test/mock_fab2.png", bg.size)
