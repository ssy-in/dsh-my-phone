# -*- coding: utf-8 -*-
"""把「现状」和三种信笺排版按 1:1 真实像素画出来，方便肉眼对比。
   A 信笺式 / B 便签式 / C 明信片式
   实现在 src/client.js 的 bubbleBox 里，这里只画样子，不改代码。
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1240, 780
BG = (27, 36, 48)          # 跟 DSH 深色界面接近
PANEL = (33, 44, 58)
WHITE = (255, 255, 255)
CYAN = (64, 208, 208)
INK = (18, 32, 47)         # 正文墨色
INK2 = (15, 143, 150)      # 现有主行青绿
INK3 = (63, 155, 161)      # 现有副行浅青
GREY = (122, 138, 158)
GREY2 = (90, 105, 124)
TAG = (110, 126, 146)

F = "C:/Windows/Fonts/"
def font(size, bold=False):
    name = (F + "msyhbd.ttc") if bold else (F + "msyh.ttc")
    return ImageFont.truetype(name, size)

def text(d, xy, s, f, fill, anchor="la", spacing=0):
    if spacing:
        x, y = xy
        for ch in s:
            d.text((x, y), ch, font=f, fill=fill, anchor=anchor)
            x += f.getlength(ch) + spacing
        return
    d.text(xy, s, font=f, fill=fill, anchor=anchor)

def measure(f, s, spacing=0):
    if spacing:
        return sum(f.getlength(c) + spacing for c in s) - spacing
    return f.getlength(s)

def shadow_card(size, radius=14):
    """白卡片 + 柔和投影，模仿 client.js 的 boxShadow。"""
    w, h = size
    pad = 26
    img = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [pad - 2, pad + 2, pad + w + 2, pad + h + 8], radius, fill=(6, 24, 36, 70)
    )
    from PIL import ImageFilter
    sh = sh.filter(ImageFilter.GaussianBlur(9))
    img.alpha_composite(sh)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([pad, pad, pad + w, pad + h], radius, fill=WHITE,
                        outline=(153, 224, 224), width=1)
    return img, pad

# ---------- 现状：两行都居中、都加粗 ----------
def bubble_now(img):
    body = "IS（iPhone）刚连进来 · 03:44"
    sig = "设置中可以手动断开"
    f1, f2 = font(15, True), font(13, True)
    inner = 250
    lines = []
    # 手写折行：模拟 300px 里必然折行的效果
    lines.append("IS（iPhone）刚连进来 ·")
    lines.append("03:44")
    w = inner + 28
    h = 11 * 2 + 15 * 1.5 * 2 + 6 + 13 * 1.5
    card, pad = shadow_card((int(w), int(h)), 14)
    d = ImageDraw.Draw(card)
    y = pad + 11
    for ln in lines:
        d.text((pad + w / 2, y + 11), ln, font=f1, fill=INK2, anchor="ma")
        y += 15 * 1.5
    d.text((pad + w / 2, y + 3), sig, font=f2, fill=INK3, anchor="ma")
    return card

# ---------- A 信笺式 ----------
def bubble_a(img):
    w = 232
    card, pad = shadow_card((w, 78), 14)
    d = ImageDraw.Draw(card)
    x = pad + 14
    y = pad + 12
    text(d, (x, y), "新连接", font(10), TAG, spacing=1.2)
    tw = measure(font(10), "03:44", 0)
    text(d, (x + w - 28 - tw, y), "03:44", font(10), TAG)
    y += 20
    text(d, (x, y), "IS（iPhone）刚连进来", font(14, True), INK)
    y += 24
    text(d, (x + w - 28, y), "—— 设置中可以手动断开", font(11), GREY, anchor="ra")
    return card

# ---------- B 便签式 ----------
def bubble_b(img):
    w = 232
    card, pad = shadow_card((w, 78), 14)
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([pad + 1, pad + 12, pad + 3, pad + 66], 2, fill=CYAN)
    x = pad + 14
    y = pad + 12
    text(d, (x, y), "新连接 · 03:44", font(10), TAG, spacing=1.0)
    y += 20
    text(d, (x, y), "IS（iPhone）刚连进来", font(14, True), INK)
    y += 24
    text(d, (x, y), "设置中可以手动断开", font(11), GREY)
    return card

# ---------- C 明信片式 ----------
def bubble_c(img):
    w = 232
    card, pad = shadow_card((w, 78), 14)
    d = ImageDraw.Draw(card)
    x = pad + 14
    y = pad + 12
    f = font(10)
    pw = int(measure(f, "新连接") + 14)
    d.rounded_rectangle([x, y, x + pw, y + 16], 8, fill=(232, 248, 250))
    d.text((x + pw / 2, y + 8), "新连接", font=f, fill=(35, 120, 128), anchor="mm")
    tw = measure(f, "03:44")
    text(d, (x + w - 28 - tw, y + 1), "03:44", f, TAG)
    y += 22
    text(d, (x, y), "IS（iPhone）刚连进来", font(14, True), INK)
    y += 24
    text(d, (x, y), "设置中可以手动断开", font(11), GREY)
    return card

# ---------- 授权气泡（A 骨架） ----------
def bubble_auth(img):
    w = 232
    card, pad = shadow_card((w, 78), 14)
    d = ImageDraw.Draw(card)
    x = pad + 14
    y = pad + 12
    text(d, (x, y), "请求授权", font(10), TAG, spacing=1.2)
    tw = measure(font(10), "00:12")
    text(d, (x + w - 28 - tw, y), "00:12", font(10), TAG)
    y += 20
    parts = [("[\u5609\u7136]", (224, 110, 20)), ("\u7b49\u4f60\u70b9\u4e00\u4e0b", INK)]
    cx = x
    for s, c in parts:
        f = font(14, True)
        d.text((cx, y), s, font=f, fill=c)
        cx += f.getlength(s)
    y += 24
    text(d, (x + w - 28, y), "—— \u70b9\u5f00 DSH \u5904\u7406", font(11), GREY, anchor="ra")
    return card

panels = [
    ("现状（居中 · 两行都粗）", bubble_now),
    ("A 信笺式（推荐）", bubble_a),
    ("B 便签式", bubble_b),
    ("C 明信片式", bubble_c),
]

img = Image.new("RGB", (W, 1160), BG)
d = ImageDraw.Draw(img)
colw, rowh = W // 2, 470
for i, (title, fn) in enumerate(panels):
    cx = (i % 2) * colw
    cy = (i // 2) * rowh
    d.rounded_rectangle([cx + 12, cy + 12, cx + colw - 12, cy + rowh - 12], 16, fill=PANEL)
    d.text((cx + 30, cy + 26), title, font=font(15, True), fill=(224, 236, 248))
    card = fn(img)
    img.paste(card, (cx + 30, cy + 56), card)
    d.text((cx + 34, cy + 56 + card.size[1] - 16), "1:1 真实大小", font=font(10), fill=GREY2)
    z = 1.5
    big = card.resize((int(card.width * z), int(card.height * z)), Image.LANCZOS)
    img.paste(big, (cx + 30, cy + 214), big)
    d.text((cx + 34, cy + 214 + big.size[1] - 16), "1.5x 放大看字形", font=font(10), fill=GREY2)

# 底部：授权气泡也套同一套骨架
d.rounded_rectangle([12, 948, W - 12, 1148], 16, fill=PANEL)
d.text((30, 962), "授权气泡（套 A 骨架）—— 同一套字体层级，只换标签文字", font=font(15, True), fill=(224, 236, 248))
auth = bubble_auth(img)
img.paste(auth, (30, 992), auth)
big = auth.resize((int(auth.width * 1.5), int(auth.height * 1.5)), Image.LANCZOS)
img.paste(big, (360, 986), big)
d.text((812, 998), "· 标签：请求授权 / 正文：[会话名] 保持橙色重点 + 说明", font=font(12), fill=GREY)
d.text((812, 1024), "· 落款：点开 DSH 处理（右对齐，跟连接气泡的落款同一位置）", font=font(12), fill=GREY)
d.text((812, 1050), "· 不放时间：授权有时效但不显示秒，跟「03:44」那种信头日期区分开", font=font(12), fill=GREY)

img.save("test/mock_letter.png")
print("ok", img.size)
