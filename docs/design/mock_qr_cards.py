# v1.8.34 设计稿：连接页「局域网 / 外出」两张可切换的二维码卡片
# 只用来给用户看版面与文案，不进产品。
from PIL import Image, ImageDraw, ImageFont
import os
import random

PW, PH = 420, 620
S = 2
GAP = 26
W, H = (PW * 2 + GAP + 40) * S, (PH + 40) * S
img = Image.new("RGB", (W, H), (236, 243, 247))
d = ImageDraw.Draw(img)


def font(sz, bold=False):
    for name in (
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyh.ttf",
        "C:/Windows/Fonts/simhei.ttf",
    ):
        if os.path.exists(name):
            try:
                return ImageFont.truetype(name, int(sz * S))
            except Exception:
                pass
    return ImageFont.load_default()


def px(v):
    return int(v * S)


INK = (18, 48, 63)
INK3 = (90, 116, 132)
TEAL = (11, 127, 140)
TEAL_SOFT = (241, 248, 251)
GREEN = (10, 122, 75)
LINE = (227, 238, 244)

rng = random.Random(7)


def draw_qr(x, y, size):
    d.rounded_rectangle([x, y, x + size, y + size], px(14), fill=(255, 255, 255), outline=(219, 234, 241), width=S)
    pad = px(14)
    x0, y0, sz = x + pad, y + pad, size - pad * 2
    n = 25
    cell = sz / n
    grid = [[rng.random() < 0.46 for _ in range(n)] for _ in range(n)]

    def eye(ix, iy):
        for a in range(7):
            for b in range(7):
                if 0 <= iy + b < n and 0 <= ix + a < n:
                    edge = a in (0, 6) or b in (0, 6)
                    inner = 2 <= a <= 4 and 2 <= b <= 4
                    grid[iy + b][ix + a] = edge or inner

    eye(0, 0)
    eye(n - 7, 0)
    eye(0, n - 7)
    for iy in range(n):
        for ix in range(n):
            if not grid[iy][ix]:
                continue
            bx = x0 + ix * cell
            by = y0 + iy * cell
            d.rectangle([bx, by, bx + cell + 0.7 * S, by + cell + 0.7 * S], fill=(11, 18, 32))


def draw_panel(ox, oy, side):
    d.rounded_rectangle([ox, oy, ox + px(PW), oy + px(PH)], px(22), fill=(255, 255, 255), outline=LINE, width=S)
    d.ellipse([ox + px(18), oy + px(16), ox + px(30), oy + px(28)], fill=(20, 130, 170))
    d.text((ox + px(38), oy + px(15)), "DSH My Phone", font=font(13, True), fill=INK)
    tabs = [("消息/日志", False), ("连接", True), ("高级", False)]
    tx = ox + px(24)
    for label, on in tabs:
        f = font(12.5, on)
        tw = d.textlength(label, font=f)
        d.text((tx, oy + px(44)), label, font=f, fill=TEAL if on else INK3)
        if on:
            d.rounded_rectangle([tx, oy + px(64), tx + tw, oy + px(67)], px(2), fill=TEAL)
        tx += tw + px(30)
    d.line([ox + px(16), oy + px(74), ox + px(PW) - px(16), oy + px(74)], fill=(238, 245, 249), width=S)

    # 切换条：两个页签，选中的实心填色（v1.8.34）
    y = oy + px(88)
    boxw = px(270)
    bx = ox + px(PW / 2) - boxw // 2
    d.rounded_rectangle([bx, y, bx + boxw, y + px(38)], px(12), fill=TEAL_SOFT, outline=(207, 227, 238), width=S)
    half = boxw // 2
    labels = [("局域网连接", side == "lan"), ("外出连接", side == "tun")]
    for i, (label, on) in enumerate(labels):
        x0 = bx + px(3) + i * (half - px(3))
        x1 = x0 + half - px(6)
        f = font(12.5, True)
        tw = d.textlength(label, font=f)
        if on:
            d.rounded_rectangle([x0, y + px(3), x1, y + px(35)], px(9), fill=TEAL)
            d.text((x0 + (x1 - x0 - tw) / 2, y + px(11)), label, font=f, fill=(255, 255, 255))
        else:
            d.text((x0 + (x1 - x0 - tw) / 2, y + px(11)), label, font=f, fill=INK3)

    # 二维码
    qsz = px(206)
    qx = ox + px(PW / 2) - qsz // 2
    qy = y + px(54)
    draw_qr(qx, qy, qsz)

    # 倒计时单独一行（v1.8.34：时间从长句里挪出来）
    fttl = font(12, True)
    ttl = "1:36 后失效"
    tw = d.textlength(ttl, font=fttl)
    d.text((ox + px(PW / 2) - tw / 2, qy + qsz + px(9)), ttl, font=fttl, fill=GREEN)

    # 主文案
    fmain = font(15.5, True)
    main = "相机或浏览器扫码连接 DSH 桌面版"
    tw = d.textlength(main, font=fmain)
    d.text((ox + px(PW / 2) - tw / 2, qy + qsz + px(36)), main, font=fmain, fill=INK)

    # 适用条件（短句）
    note = "只有手机和电脑在同一个网络才能连接" if side == "lan" else "任何时间都能连接（速度低于局域网）"
    fnote = font(11.5, True)
    tw = d.textlength(note, font=fnote)
    d.text((ox + px(PW / 2) - tw / 2, qy + qsz + px(62)), note, font=fnote, fill=INK3)

    # 地址行
    ly = qy + qsz + px(86)
    d.rounded_rectangle(
        [ox + px(18), ly, ox + px(PW) - px(18), ly + px(38)],
        px(11),
        fill=(238, 245, 249),
        outline=(220, 234, 241),
        width=S,
    )
    url = "http://192.168.1.107:18391/…" if side == "lan" else "https://strict-women-mysql-lovely.trycloudflare.com/…"
    d.text((ox + px(30), ly + px(11)), url, font=font(10.5), fill=(38, 72, 92))
    d.rounded_rectangle(
        [ox + px(PW) - px(78), ly + px(6), ox + px(PW) - px(30), ly + px(32)],
        px(8),
        fill=(255, 255, 255),
        outline=(207, 228, 236),
        width=S,
    )
    d.text((ox + px(PW) - px(68), ly + px(11)), "复制", font=font(11, True), fill=(10, 95, 117))

    # 主按钮
    by = ly + px(56)
    d.rounded_rectangle([ox + px(18), by, ox + px(PW) - px(18), by + px(42)], px(12), fill=(13, 122, 140))
    t = "换一个二维码"
    tw = d.textlength(t, font=font(14, True))
    d.text((ox + px(PW / 2) - tw / 2, by + px(11)), t, font=font(14, True), fill=(255, 255, 255))
    fg = font(11)
    g = "默认位置"
    tw = d.textlength(g, font=fg)
    d.text((ox + px(PW / 2) - tw / 2, by + px(56)), g, font=fg, fill=INK3)


draw_panel(px(20), px(20), "lan")
draw_panel(px(20 + PW + GAP), px(20), "tun")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock_qr_cards.png")
img = img.resize((W // S, H // S), Image.LANCZOS)
img.save(out)
print("saved", out, img.size)
