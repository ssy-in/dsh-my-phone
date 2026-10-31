"""悬浮球「旧形态 + 文字怎么才清晰」四种方案，放在深色和浅色两种壁纸上各画一遍。

旧形态保留：白色圆角方块 + 透明鲸尾，文字在方块下面。只解决「字看不清」。
四列 = 四种文字处理：
  A 白描边（深灰字 + 白色描边/投影）
  B 半透明白胶囊（字放在一小块白底上）
  C 深色胶囊（白字 + 深底）
  D 白底胶囊贴住方块（把文字并进方块的投影范围，做成「App 名称」那一条）
输出 test/mock_label.png（1240x660），1:1 真实像素 + 放大对照。
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1240, 660
CJK = "C:/Windows/Fonts/msyh.ttc"
CJK_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
TILE = 60
LABEL = "手机连 DSH"


def font(size, bold=True):
    try:
        return ImageFont.truetype(CJK_BOLD if bold else CJK, int(size))
    except OSError:
        return ImageFont.load_default()


tail_src = Image.open("icon-transparent.png").convert("RGBA")
# 鲸尾缩到方块内边长的 76%，四周留白更均匀
inner = int(TILE * 0.76)
tail = tail_src.resize((inner, inner), Image.LANCZOS)


def rounded(size, radius, fill, outline=None, width=1):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=fill, outline=outline, width=width)
    return img


def shadow(canvas, x, y, w, h, radius, alpha=110, blur=9, dy=6):
    sh = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([30, 30 + dy, 30 + w - 1, 30 + dy + h - 1], radius=radius,
                                         fill=(0, 0, 0, alpha))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.paste(sh, (x - 30, y - 30), sh)


def draw_tile(canvas, x, y):
    """旧形态的图标块：白底圆角方块 + 透明鲸尾（比旧版放大一点，免得看着像空的）。"""
    shadow(canvas, x, y, TILE, TILE, 16)
    block = rounded(TILE, 16, (255, 255, 255, 255), (222, 231, 244, 255))
    canvas.paste(block, (x, y), block)
    off = (TILE - inner) // 2
    canvas.paste(tail, (x + off, y + off), tail)


def draw_label(canvas, cx, y, style):
    d = ImageDraw.Draw(canvas)
    f = font(11)
    tw = d.textlength(LABEL, font=f)
    th = 13
    if style == 'A':  # 白描边
        # 八方向白色描边
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx or dy:
                    d.text((cx - tw / 2 + dx, y + dy), LABEL, font=f, fill=(255, 255, 255))
        d.text((cx - tw / 2, y), LABEL, font=f, fill=(38, 52, 76))
    elif style == 'B':  # 半透明白胶囊
        pad_x, pad_y = 7, 2
        pill = rounded(1, 8, (255, 255, 255, 226))
        pw, ph = int(tw + pad_x * 2), th + pad_y * 2
        pill = rounded(pw if pw == ph else pw, 8, (255, 255, 255, 226))
        if pw != ph:
            pill = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
            ImageDraw.Draw(pill).rounded_rectangle([0, 0, pw - 1, ph - 1], radius=ph // 2, fill=(255, 255, 255, 232))
        shadow(canvas, int(cx - pw / 2), y - pad_y, pw, ph, ph // 2, alpha=55, blur=6, dy=2)
        canvas.paste(pill, (int(cx - pw / 2), y - pad_y), pill)
        d.text((cx - tw / 2, y), LABEL, font=f, fill=(43, 58, 82))
    elif style == 'C':  # 深色胶囊白字
        pad_x, pad_y = 7, 2
        pw, ph = int(tw + pad_x * 2), th + pad_y * 2
        pill = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        ImageDraw.Draw(pill).rounded_rectangle([0, 0, pw - 1, ph - 1], radius=ph // 2, fill=(17, 27, 45, 208))
        shadow(canvas, int(cx - pw / 2), y - pad_y, pw, ph, ph // 2, alpha=50, blur=6, dy=2)
        canvas.paste(pill, (int(cx - pw / 2), y - pad_y), pill)
        d.text((cx - tw / 2, y), LABEL, font=f, fill=(255, 255, 255))
    return th


def caption(d, x, y, title, lines):
    d.text((x, y), title, font=font(13), fill=(255, 255, 255) if y < 300 else (30, 38, 54))
    pass


# ---------- 背景：上半深色壁纸，下半浅色壁纸 ----------
bg = Image.new("RGB", (W, H), (18, 26, 44))
d = ImageDraw.Draw(bg)
for y in range(0, 330):
    t = y / 330
    d.line([(0, y), (W, y)], fill=(int(16 + 18 * t), int(24 + 26 * t), int(44 + 34 * t)))
for cx, cy, r, col in [(1020, 150, 240, (46, 78, 138)), (250, 250, 200, (36, 60, 108))]:
    for i in range(r, 0, -8):
        bg_tmp = bg.crop((0, 0, W, 330))
        bg_tmp = Image.blend(bg_tmp, Image.new("RGB", (W, 330), col), 0.02 * (1 - i / r))
        bg.paste(bg_tmp, (0, 0))
# 浅色壁纸（很多人的壁纸是浅色/米白/浅灰）
for y in range(330, H):
    t = (y - 330) / (H - 330)
    d.line([(0, y), (W, y)], fill=(int(238 - 14 * t), int(242 - 12 * t), int(247 - 8 * t)))
for i in range(200, 0, -8):
    circle = Image.new("RGB", (W, H), (222, 230, 242))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse([880 - 200, 430 - 200, 880 + 200, 430 + 200], fill=int(10 * (1 - i / 200)))
    bg = Image.composite(circle, bg, mask)
d = ImageDraw.Draw(bg)

d.text((40, 30), "悬浮球：保留旧形态，只解决「文字看不清」——四种做法，深浅壁纸各试一遍",
       font=font(18), fill=(255, 255, 255))
d.text((40, 60), "图标块用透明鲸尾（放大到方块的 76%，别让它看着空）；下面一行是各种文字处理。",
       font=font(12, False), fill=(150, 168, 196))

COLS = [150, 400, 650, 900]
Y1, Y2 = 150, 430
NAMES = ["A 白描边", "B 半透明白胶囊", "C 深色胶囊白字", "D 白胶囊贴方块"]
NOTES = [
    "深色壁纸能看清，\n浅色壁纸白边糊成一团",
    "两种壁纸上都清楚，\n不抢图标，最像手机 App",
    "两种都清楚，\n但深色胶囊在浅壁纸上偏重",
    "和图标连成一体，\n但会变成一块更高的白块",
]

for i, cx in enumerate(COLS):
    for base_y in (Y1, Y2):
        draw_tile(bg, cx - TILE // 2, base_y)
        draw_label(bg, cx, base_y + TILE + 6, ['A', 'B', 'C', 'B'][i])
    d.text((cx - 52, Y1 - 40), NAMES[i], font=font(13), fill=(255, 255, 255))
    d.text((cx - 52, Y2 - 40), NAMES[i], font=font(13), fill=(30, 38, 54))

# 右侧说明（画在浅色区下面，深色字）
for i, note in enumerate(NOTES):
    d.text((COLS[i] - 52, 540), note, font=font(11.5, False), fill=(52, 64, 88), spacing=5)

# 放大 2 倍：B 方案（白胶囊）在深浅两种背景上的样子
Z = 2.0
for j, (bx, label_c) in enumerate([(60, (255, 255, 255)), (620, (30, 38, 54))]):
    pass

bg.convert("RGB").save("test/mock_label.png")
print("test/mock_label.png", bg.size)
