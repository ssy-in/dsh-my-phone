"""悬浮球三种状态的 1:1 形变对比图（常态 / 悬停 / 按下）。

参数直接抄 src/client.js 的实现：
  FAB_TILE = 60, FAB_INNER = 46, FAB_W = 96, FAB_H = 84
  hover : translateY(-7px) scale(1.14) rotate(-2deg)
  press : translateY(+1px) scale(0.86) rotate(1.5deg)
  label : 半透明白胶囊 rgba(255,255,255,.90), padding 1px 7px, 11px/700
"""

from PIL import Image, ImageDraw, ImageFont

W, H = 1240, 560
BG = (18, 24, 38)
CARD = (32, 42, 62)

ROOT = r"H:\因爱而生的鱼\dsh-my-phone"

FONT_PATHS = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def font(size, bold=True):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def tile(icon, tile_px, inner_px):
    """一个白圆角方块，里面塞图标。返回 RGBA。"""
    ss = 4
    side = tile_px * ss
    box = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    d = ImageDraw.Draw(box)
    d.rounded_rectangle([0, 0, side - 1, side - 1], radius=int(side * 0.24), fill=(255, 255, 255, 255))
    ic = icon.resize((inner_px * ss, inner_px * ss), Image.LANCZOS)
    off = (side - ic.width) // 2
    box.alpha_composite(ic, (off, off))
    return box.resize((tile_px, tile_px), Image.LANCZOS)


def capsule(text, cap_font, color=(51, 64, 92)):
    pad_x, pad_y = 7, 1
    tmp = Image.new("RGBA", (1, 1))
    d = ImageDraw.Draw(tmp)
    tw = d.textlength(text, font=cap_font)
    th = cap_font.size
    w, h = int(tw + pad_x * 2), int(th + pad_y * 2 + 2)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    dd.rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2, fill=(255, 255, 255, 230))
    dd.text((pad_x, pad_y), text, font=cap_font, fill=color + (255,))
    return img


def draw_fab(canvas, cx, base_y, icon, cap_font, scale=1.0, dy=0, rot=0.0):
    tile_px, inner_px = 60, 46
    t = tile(icon, tile_px, inner_px)
    lab = capsule("连接 DSH", cap_font)

    if scale != 1.0:
        t = t.resize((int(tile_px * scale), int(tile_px * scale)), Image.LANCZOS)
        lab = lab.resize((int(lab.width * scale), int(lab.height * scale)), Image.LANCZOS)
    if rot:
        t = t.rotate(rot, resample=Image.BICUBIC, expand=True)
        lab = lab.rotate(rot, resample=Image.BICUBIC, expand=True)

    tray_w = max(t.width, lab.width)
    tray_h = t.height + 4 + lab.height
    tray = Image.new("RGBA", (tray_w, tray_h), (0, 0, 0, 0))
    tray.alpha_composite(t, ((tray_w - t.width) // 2, 0))
    tray.alpha_composite(lab, ((tray_w - lab.width) // 2, t.height + 4))
    canvas.alpha_composite(tray, (int(cx - tray_w / 2), int(base_y + dy)))
    return tray


def main():
    icon = Image.open(f"{ROOT}\\icon.png").convert("RGBA")
    img = Image.new("RGBA", (W, H), BG + (255,))
    d = ImageDraw.Draw(img)
    f_title = font(26)
    f_sub = font(15)
    f_cap = font(22)
    f_note = font(14)

    d.text((36, 30), "悬浮球三态 · 1:1 真实像素", font=f_title, fill=(255, 255, 255))
    d.text((36, 66), "左→右：常态 / 悬停 0.3 秒 / 按下。形变幅度、回弹曲线都按代码里的实际数值画。", font=f_sub, fill=(160, 178, 205))

    cols = [
        (250, 1.0, 0, 0.0, "常态", "60px 方块 + 「连接 DSH」胶囊"),
        (620, 1.14, -7, -2.0, "悬停 / 长按", "抬起 7px · 放大 1.14 · 微转 -2°"),
        (990, 0.86, 1, 1.5, "按下", "压到 0.86 · 下沉 1px · 转 +1.5°"),
    ]
    for cx, sc, dy, rot, title, note in cols:
        d.rounded_rectangle([cx - 150, 120, cx + 150, 470], radius=22, fill=CARD)
        draw_fab(img, cx, 170, icon, f_cap, scale=sc, dy=dy, rot=rot)
        d.text((cx - 132, 400), title, font=font(20), fill=(255, 255, 255))
        d.text((cx - 132, 430), note, font=f_note, fill=(150, 170, 200))

    d.text((36, 500), "回弹曲线 cubic-bezier(.34,1.56,.64,1)：会轻微过冲再收回来，所以看起来是「弹」的不是「移」的。", font=f_note, fill=(140, 160, 190))
    img.save(f"{ROOT}\\test\\mock_fab3.png")
    print("saved test/mock_fab3.png")


if __name__ == "__main__":
    main()
