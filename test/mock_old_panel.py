from PIL import Image, ImageDraw, ImageFont
import random

# 图纸：旧界面（React 版）按 src/client.js 的样式常量 1:1 复刻；
# 悬浮球与气泡按「现在这版」（widget.js：TILE 135×121 + 信笺气泡）。非截图。
S = 2
W, H = 1400, 1060
BG = (11, 22, 32)


def f(size, bold=False):
    return ImageFont.truetype("C:/Windows/Fonts/" + ("msyhbd.ttc" if bold else "msyh.ttc"), int(size * S))


INK = (13, 36, 54)
TEXT = (16, 26, 43)
SUB = (95, 123, 147)
FAINT = (124, 141, 160)
LINE = (219, 228, 240)
SOFT = (246, 250, 253)
CARD = (255, 255, 255)
ACCENT = (31, 111, 235)
GREEN = (10, 122, 75)
ORANGE = (224, 108, 0)
RED = (192, 27, 27)
WHALE = (24, 120, 160)

img = Image.new("RGB", (W * S, H * S), BG)
d = ImageDraw.Draw(img)


def px(v):
    return int(round(v * S))


def text(x, y, s, size=13, bold=False, color=TEXT, anchor="la"):
    d.text((px(x), px(y)), s, font=f(size, bold), fill=color, anchor=anchor)


def rr(x, y, w, h, r, fill=None, outline=None, width=1):
    d.rounded_rectangle([px(x), px(y), px(x + w), px(y + h)], radius=px(r), fill=fill, outline=outline, width=max(1, px(width)))


def card(x, y, w, h):
    for i in range(4):
        rr(x - 2, y - 1 + i * 1.2, w + 4, h + 3, 22, fill=(6 + i, 12 + i, 20 + i))
    rr(x, y, w, h, 22, fill=CARD)


def tab(x, y, w, label, active):
    if active:
        rr(x, y, w, 30, 15, fill=(223, 243, 249))
        text(x + w / 2, y + 15, label, 13.5, True, (10, 95, 117), "mm")
    else:
        text(x + w / 2, y + 15, label, 13.5, False, SUB, "mm")


CX, CY, CW, CH = 56, 50, 400, 800
AX = CX + CW + 56
pad = 20

# ---------------- 左：连接页 ----------------
card(CX, CY, CW, CH)
text(CX + pad, CY + 22, "手机连到这台电脑", 15.5, True, INK)
rr(CX + CW - pad - 24, CY + 18, 24, 24, 12, fill=(240, 244, 250))
text(CX + CW - pad - 12, CY + 30, "×", 13, False, SUB, "mm")
ty = CY + 58
tab(CX + pad, ty, 56, "连接", True)
tab(CX + pad + 62, ty, 56, "高级", False)
d.line([px(CX + pad), px(ty + 40), px(CX + CW - pad), px(ty + 40)], fill=LINE, width=px(1))
text(CX + pad, ty + 58, "相机或者浏览器扫码连接", 14.5, True, INK)
text(CX + pad, ty + 82, "扫码连接 DeepSeek Harness", 13, False, SUB)

qx, qy, qs = CX + (CW - 208) / 2, ty + 108, 208
rr(qx - 8, qy - 8, qs + 16, qs + 16, 12, fill=(250, 253, 255), outline=LINE)
random.seed(7)
n = 25
cell = qs / n
for r in range(n):
    for c in range(n):
        if random.random() < 0.46:
            d.rectangle(
                [px(qx + c * cell), px(qy + r * cell), px(qx + (c + 1) * cell - 1), px(qy + (r + 1) * cell - 1)],
                fill=(16, 26, 43),
            )
for ox, oy in [(0, 0), (n - 7, 0), (0, n - 7)]:
    d.rectangle([px(qx + ox * cell), px(qy + oy * cell), px(qx + (ox + 7) * cell), px(qy + (oy + 7) * cell)], fill=(255, 255, 255))
    d.rectangle([px(qx + (ox + 1) * cell), px(qy + (oy + 1) * cell), px(qx + (ox + 6) * cell), px(qy + (oy + 6) * cell)], fill=(16, 26, 43))
    d.rectangle([px(qx + (ox + 2) * cell), px(qy + (oy + 2) * cell), px(qx + (ox + 5) * cell), px(qy + (oy + 5) * cell)], fill=(255, 255, 255))

ly = qy + qs + 26
text(CX + pad, ly, "链接（3 分钟内有效）", 12, False, SUB)
rr(CX + pad, ly + 20, CW - pad * 2 - 62, 34, 10, fill=SOFT, outline=LINE)
text(CX + pad + 10, ly + 37, "https://pale-labs-frozen.trycloudflare…", 11.5, False, TEXT, "lm")
rr(CX + CW - pad - 54, ly + 20, 54, 34, 10, fill=(255, 255, 255), outline=LINE)
text(CX + CW - pad - 27, ly + 37, "复制", 12, False, SUB, "mm")

by = ly + 74
rr(CX + pad, by, CW - pad * 2, 46, 12, fill=ACCENT)
text(CX + CW / 2, by + 23, "换一个二维码", 14.5, True, (255, 255, 255), "mm")
text(CX + CW / 2, by + 60, "2:47 后失效，到点需要手动再点一次", 11.5, False, FAINT, "ma")
text(CX + CW / 2, CY + CH - 26, "默认位置", 12, False, FAINT, "ma")

# ---------------- 中：高级页 ----------------
card(AX, CY, CW, CH)
text(AX + pad, CY + 22, "手机连到这台电脑", 15.5, True, INK)
rr(AX + CW - pad - 24, CY + 18, 24, 24, 12, fill=(240, 244, 250))
text(AX + CW - pad - 12, CY + 30, "×", 13, False, SUB, "mm")
tab(AX + pad, ty, 56, "连接", False)
tab(AX + pad + 62, ty, 56, "高级", True)
d.line([px(AX + pad), px(ty + 40), px(AX + CW - pad), px(ty + 40)], fill=LINE, width=px(1))

y = ty + 56


def section(title, gap=24):
    global y
    text(AX + pad, y, title, 14.5, True, INK)
    y += gap


# 入口 + 两个开关
section("入口")
text(AX + pad, y, "局域网访问", 14, True, INK)
rr(AX + CW - pad - 92, y - 2, 92, 30, 15, fill=(241, 245, 249))
text(AX + CW - pad - 46, y + 13, "关着 · 开", 12, False, SUB, "mm")
y += 20
text(AX + pad, y + 2, "默认只用外网，一个码到处都能用", 12, False, SUB)
y += 26
text(AX + pad, y, "外网访问", 14, True, INK)
rr(AX + CW - pad - 92, y - 2, 92, 30, 15, fill=GREEN)
text(AX + CW - pad - 46, y + 13, "已开启 · 关", 12, True, (255, 255, 255), "mm")
y += 20
text(AX + pad, y + 2, "经 Cloudflare 中继，在外面也能连回来", 12, False, SUB)
y += 34

# 自动关闭入口
section("自动关闭入口")
text(AX + pad, y, "外网通道", 12.5, False, SUB)
y += 22
sx = AX + pad
for i, lab in enumerate(["不自动关", "15 分钟", "30 分钟", "60 分钟", "120 分钟"]):
    w = [68, 64, 64, 64, 72][i]
    on = i == 0
    rr(sx, y, w, 30, 9, fill=(223, 243, 249) if on else (255, 255, 255), outline=(159, 216, 232) if on else LINE)
    text(sx + w / 2, y + 15, lab, 11.5, on, (10, 95, 117) if on else SUB, "mm")
    sx += w + 6
y += 48

# 消息
section("消息")
rr(AX + pad, y, CW - pad * 2, 92, 12, fill=(255, 253, 247), outline=(246, 220, 189))
text(AX + pad + 12, y + 14, "【整理插件的悬浮球】正在请求授权…", 13, True, INK)
text(AX + pad + 12, y + 36, "新设备「isis（iPhone）」连入", 12.5, False, ORANGE)
text(AX + pad + 12, y + 58, "02:41 · 点这段文字就进「高级 · 消息」", 11.5, False, FAINT)
text(AX + CW - pad - 12, y + 14, "3", 12, True, ORANGE, "ra")
y += 104

# 已配对设备
section("已配对设备  1/8")
rr(AX + pad, y, CW - pad * 2, 52, 12, fill=(251, 253, 255), outline=LINE)
text(AX + pad + 12, y + 14, "isis（iPhone）", 13, True, TEXT)
rr(AX + pad + 118, y + 12, 52, 18, 9, fill=(226, 246, 236))
text(AX + pad + 144, y + 21, "已信任", 10.5, True, GREEN, "mm")
for i, lab in enumerate(["备注", "断开", "删除"]):
    x = AX + CW - pad - 174 + i * 56
    rr(x, y + 12, 50, 26, 9, fill=(255, 255, 255), outline=LINE)
    text(x + 25, y + 25, lab, 11.5, False, SUB, "mm")
y += 62

# 音效
section("音效")
text(AX + pad, y + 4, "音量", 13, False, TEXT)
rr(AX + pad + 42, y + 6, 132, 8, 4, fill=(226, 232, 240))
d.ellipse([px(AX + pad + 42 + 104 - 7), px(y), px(AX + pad + 42 + 104 + 7), px(y + 14)], fill=ACCENT)
text(AX + pad + 186, y + 12, "80%", 12, False, SUB, "lm")
rr(AX + CW - pad - 96, y - 2, 96, 30, 9, fill=(255, 255, 255), outline=LINE)
text(AX + CW - pad - 62, y + 13, "马林巴 ▼", 12, False, TEXT, "mm")
y += 44

# 排查日志
text(AX + pad, y, "排查日志", 14.5, True, INK)
rr(AX + CW - pad - 150, y - 3, 46, 24, 8, fill=(255, 255, 255), outline=LINE)
text(AX + CW - pad - 127, y + 9, "展开", 11.5, False, SUB, "mm")
rr(AX + CW - pad - 98, y - 3, 46, 24, 8, fill=(255, 255, 255), outline=LINE)
text(AX + CW - pad - 75, y + 9, "清空", 11.5, False, SUB, "mm")
rr(AX + CW - pad - 46, y - 3, 46, 24, 8, fill=(255, 255, 255), outline=LINE)
text(AX + CW - pad - 23, y + 9, "复制", 11.5, False, SUB, "mm")
y += 26
text(AX + pad, y, "08:47 · 入口地址已变更：旧 → 新（手机重新扫一次就行）", 11.5, False, SUB)
y += 18
text(AX + pad, y, "08:41 · 新设备连入 isis（iPhone）· 方式=二维码", 11.5, False, SUB)

# ---------------- 右：现在的球 + 信笺气泡 ----------------
BX = AX + CW + 60
text(BX + 6, CY + 4, "悬浮球（现在这版 135×121·贴边会转向）", 12.5, True, (150, 175, 200))
rr(BX + 18, CY + 34, 135, 121, 30, fill=(255, 255, 255))
d.ellipse([px(BX + 40), px(CY + 62), px(BX + 128), px(CY + 140)], fill=WHALE)
d.polygon([(px(BX + 118), px(CY + 74)), (px(BX + 142), px(CY + 58)), (px(BX + 138), px(CY + 90))], fill=WHALE)
d.ellipse([px(BX + 56), px(CY + 88), px(BX + 68), px(CY + 100)], fill=(255, 255, 255))
d.ellipse([px(BX + 60), px(CY + 92), px(BX + 65), px(CY + 97)], fill=(16, 26, 43))
d.ellipse([px(BX + 138), px(CY + 28), px(BX + 156), px(CY + 46)], fill=RED)

# 信笺气泡
LX, LY, LW = BX - 30, CY + 176, 292
rr(LX, LY, LW, 132, 14, fill=(255, 255, 255), outline=(227, 236, 245))
text(LX + 14, LY + 14, "【整理插件的悬浮球】正在请求授权…", 13, True, ORANGE)
d.line([px(LX + 14), px(LY + 40), px(LX + LW - 14), px(LY + 40)], fill=(238, 244, 250), width=px(1))
text(LX + 14, LY + 52, "isis（iPhone）刚连进来", 12.5, False, TEXT)
text(LX + 14, LY + 74, "点一下进「高级 · 消息」，点掉就消失", 11.5, False, SUB)
text(LX + 14, LY + 96, "02:41", 11, False, FAINT)
d.polygon([(px(LX + 118), px(LY)), (px(LX + 132), px(LY - 13)), (px(LX + 146), px(LY))], fill=(255, 255, 255))
d.rectangle([px(LX + 119), px(LY - 2), px(LX + 145), px(LY - 1)], fill=(255, 255, 255))

text(56, H - 34, "图纸：React 版按代码常量 1:1 复刻；球与气泡按现在这版（widget.js）。非截图。", 12.5, False, (138, 160, 182))

img.resize((W, H), Image.LANCZOS).save(r"H:\因爱而生的鱼\dsh-my-phone\docs\design\mock_old_panel.png")
print("saved")
