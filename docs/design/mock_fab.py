# -*- coding: utf-8 -*-
"""画出悬浮球的三种「带文字」方案效果图，供讨论用。"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON = os.path.join(BASE, "icon-transparent.png")

W, H = 1240, 720
BG = (244, 247, 251)
CARD = (255, 255, 255)
FG = (16, 26, 44)
DIM = (110, 124, 146)
ACCENT = (31, 111, 235)
OK = (10, 122, 75)
RED = (226, 58, 46)

FONT = r"C:\Windows\Fonts\msyh.ttc"
FONTB = r"C:\Windows\Fonts\msyhbd.ttc"


def f(size, bold=False):
    try:
        return ImageFont.truetype(FONTB if bold else FONT, size)
    except Exception:
        return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img, "RGBA")
icon = Image.open(ICON).convert("RGBA")


def panel(x, y, w, h, title, sub):
    d.rounded_rectangle([x, y, x + w, y + h], 20, fill=CARD, outline=(224, 232, 242), width=2)
    d.text((x + 22, y + 18), title, font=f(21, True), fill=FG)
    d.text((x + 22, y + 50), sub, font=f(15), fill=DIM)


def paste_icon(cx, cy, size):
    im = icon.resize((size, size), Image.LANCZOS)
    img.paste(im, (int(cx - size / 2), int(cy - size / 2)), im)


def red_dot(cx, cy, r=7):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED, outline=(255, 255, 255), width=3)


d.text((28, 26), "悬浮球「带文字」三种做法 · 1:1 实尺寸", font=f(28, True), fill=FG)
d.text((28, 66), "下面所有球/方块都是真实像素大小（56~68px），你可以直接感受占屏和可读性", font=f(15), fill=DIM)

# ---- A 方案：app 图标形态（方块 + 下方 DOM 文字）
ax, ay, aw, ah = 28, 108, 380, 560
panel(ax, ay, aw, ah, "A. 应用图标形态（推荐）", "方块 68px + 下方 12px 文字（DOM 绘制）")
tile_x, tile_y, tile = ax + 150, ay + 190, 68
d.rounded_rectangle([tile_x, tile_y, tile_x + tile, tile_y + tile], 18,
                    fill=(255, 255, 255), outline=(219, 231, 247), width=2)
paste_icon(tile_x + tile / 2, tile_y + tile / 2, 48)
red_dot(tile_x + tile - 6, tile_y + 6)
label = "手机连 DSH"
tw = d.textlength(label, font=f(12))
d.text((tile_x + tile / 2 - tw / 2, tile_y + tile + 6), label, font=f(12), fill=DIM)

d.text((ax + 22, ay + 330), "优点", font=f(16, True), fill=OK)
for i, t in enumerate([
    "文字清晰不糊，跟随系统缩放",
    "状态可以变：已连接 → 绿字",
    "改文案不用重新出图",
]):
    d.text((ax + 22, ay + 360 + i * 26), "· " + t, font=f(15), fill=FG)

d.text((ax + 22, ay + 452), "缺点", font=f(16, True), fill=RED)
for i, t in enumerate([
    "整体高度约 90px（比裸球大 34px）",
    "贴边时文字会挤到屏幕角",
]):
    d.text((ax + 22, ay + 482 + i * 26), "· " + t, font=f(15), fill=FG)

# ---- B 方案：裸球 + 悬停气泡
bx, by, bw, bh = 428, 108, 400, 560
panel(bx, by, bw, bh, "B. 裸球 + 悬停气泡（你选的）", "平时只有一个球，鼠标停 300ms／长按 500ms 冒气泡")
sx, sy, ss = bx + 150, by + 200, 56
d.rounded_rectangle([sx, sy, sx + ss, sy + ss], 999,
                    fill=(255, 255, 255), outline=(219, 231, 247), width=2)
paste_icon(sx + ss / 2, sy + ss / 2, 40)
red_dot(sx + ss - 4, sy + 4)

# 气泡（球左上方）
bub_w, bub_h = 214, 86
bub_x, bub_y = sx - bub_w + 26, sy - bub_h - 18
d.rounded_rectangle([bub_x, bub_y, bub_x + bub_w, bub_y + bub_h], 12,
                    fill=(23, 33, 51), outline=(23, 33, 51))
d.text((bub_x + 14, bub_y + 13), "手机连 DSH", font=f(16, True), fill=(255, 255, 255))
d.text((bub_x + 14, bub_y + 42), "点一下扫码 / 复制链接", font=f(13), fill=(178, 195, 220))
d.text((bub_x + 14, bub_y + 62), "3 分钟内有效", font=f(12), fill=(120, 200, 255))
# 小尖角
d.polygon([(sx + 12, sy - 2), (sx + 30, sy - 2), (sx + 21, sy + 11)], fill=(23, 33, 51))

d.text((bx + 22, by + 330), "优点", font=f(16, True), fill=OK)
for i, t in enumerate([
    "不占地方，屏上永远只有 56px",
    "可以塞两行字 + 有效期",
    "红点点一下就知有新请求",
]):
    d.text((bx + 22, by + 360 + i * 26), "· " + t, font=f(15), fill=FG)

d.text((bx + 22, by + 452), "缺点", font=f(16, True), fill=RED)
for i, t in enumerate([
    "要先知道「那里有个球」才会去悬停",
    "手机长按出气泡后松手就收，按钮点不到",
]):
    d.text((bx + 22, by + 482 + i * 26), "· " + t, font=f(15), fill=FG)

# ---- C 方案：文字烧进图里
cx0, cy0, cw, chh = 848, 108, 364, 560
panel(cx0, cy0, cw, chh, "C. 文字烧进图里", "把「手机连 DSH」直接画进图片本身")
tile = 68
tx, ty = cx0 + 150, cy0 + 190
# 模拟：把图标压扁塞进上半，文字用极小字体塞进下半
d.rounded_rectangle([tx, ty, tx + tile, ty + tile], 18, fill=(255, 255, 255), outline=(219, 231, 247), width=2)
paste_icon(tx + tile / 2, ty + 26, 34)
small = f(8)
t1, t2 = "手机连", "DSH"
for j, t in enumerate((t1, t2)):
    tw = d.textlength(t, font=small)
    d.text((tx + tile / 2 - tw / 2, ty + 46 + j * 10), t, font=small, fill=(90, 104, 124))

d.text((cx0 + 22, cy0 + 330), "结论", font=f(16, True), fill=FG)
for i, t in enumerate([
    "68px 里塞两行 8px 字，",
    "在实际屏幕上会糊成一团，",
    "而且改不了字、改不了颜色。",
    "",
    "→ 不推荐，除非你把球做到 96px",
]):
    d.text((cx0 + 22, cy0 + 360 + i * 26), t, font=f(15), fill=FG if i < 3 else DIM)

# ---- 底部：红点 + 事件气泡示意
dx, dy = 28, 686
d.text((dx, dy - 2), "红点＋事件气泡（第 3 条）：气泡只放信息，两个按钮放弹窗顶部 —— 手机上才点得到", font=f(15), fill=DIM)

img.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock_fab.png"))
print("saved", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock_fab.png"))
