# 消息卡（信笺格式）设计稿：v1.8.21 的「P0/P1/P2 三级配色 + NEW 徽标 + 时间倒序 + 滚动条」
# 只用来给用户看版面，不进产品。
from PIL import Image, ImageDraw, ImageFont
import os

PW, PH = 430, 900  # 手机宽度的面板（1x 的 2.2 倍放大画）
S = 2
W, H = PW * S, PH * S
img = Image.new("RGB", (W, H), (245, 249, 251))
d = ImageDraw.Draw(img)


def font(sz, bold=False):
    for name in (
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyh.ttf",
        "C:/Windows/Fonts/simhei.ttf",
    ):
        if os.path.exists(name):
            try:
                return ImageFont.truetype(name, sz * S)
            except Exception:
                pass
    return ImageFont.load_default()


def px(v):
    return int(v * S)


CARD = [
    # (级别, 是否 NEW, 文案, 时间)
    (0, True, "【重建产物】 正在请求授权 · Write", "03:12"),
    (1, True, "IS（iPhone） 刚连进来", "03:09"),
    (2, False, "【整理插件的悬浮球】 完成了一轮", "03:04"),
    (2, False, "【整理插件的悬浮球】 正在用 Read", "02:58"),
    (1, False, "外网通道断了（quick），正在第 2 次重连…", "02:41"),
    (2, False, "【绘图脚本】 完成了一轮", "02:20"),
]

STYLE = {
    0: dict(bg=(255, 252, 242), bd=(240, 224, 184), new=(200, 138, 0)),
    1: dict(bg=(255, 248, 242), bd=(246, 216, 192), new=(224, 108, 0)),
    2: dict(bg=(248, 251, 254), bd=(218, 234, 246), new=(26, 111, 224)),
}
INK = (18, 48, 63)
INK3 = (123, 143, 161)

# 面板外框
PAD = px(16)
TOPY = px(16)
d.rounded_rectangle([PAD, TOPY, W - PAD, px(860)], px(22), fill=(255, 255, 255), outline=(227, 238, 244), width=S)

# 头部 tab
f_tab = font(13.5, True)
d.text((PAD + px(16), TOPY + px(18)), "连接", font=f_tab, fill=(92, 114, 132))
d.text((PAD + px(76), TOPY + px(18)), "高级", font=f_tab, fill=(10, 95, 117))
d.line([PAD + px(74), TOPY + px(44), PAD + px(114), TOPY + px(44)], fill=(64, 208, 208), width=px(2))

# 区块标题
f_h = font(11.5, True)
d.text((PAD + px(18), TOPY + px(64)), "消息", font=f_h, fill=(70, 96, 116))

# 卡片区（可滚：底部渐隐）
CY = TOPY + px(84)
CW = W - PAD * 2 - px(24)
f_tx = font(12.5, True)
f_tm = font(10.5)
f_new = font(9, True)

for i, (lv, isnew, text, tm) in enumerate(CARD):
    st = STYLE[lv]
    ch = px(74) if isnew else px(58)
    x0, x1 = PAD + px(12), PAD + px(12) + CW
    # 最后一张画一半，暗示还有更多（滚动）
    cut = i == len(CARD) - 1
    box = [x0, CY, x1, CY + (px(34) if cut else ch)]
    d.rounded_rectangle(box, px(12), fill=st["bg"], outline=st["bd"], width=S)
    ty = CY + px(9)
    if isnew:
        nw = px(40)
        d.rounded_rectangle([x0 + px(12), ty, x0 + px(12) + nw, ty + px(15)], px(8), fill=st["new"])
        d.text((x0 + px(12) + px(6), ty + px(3)), "NEW", font=f_new, fill=(255, 255, 255))
        ty += px(21)
    d.text((x0 + px(12), ty), text, font=f_tx, fill=INK)
    if not cut:
        tw = d.textlength(tm, font=f_tm)
        d.text((x1 - px(12) - tw, CY + ch - px(19)), tm, font=f_tm, fill=INK3)
    CY += ch + px(8)

# 滚动条
sb_x = W - PAD - px(9)
d.rounded_rectangle([sb_x, TOPY + px(84), sb_x + px(3), TOPY + px(330)], px(2), fill=(190, 210, 222))

# 说明
f_note = font(11)
notes = [
    "· 超过四五条就出滚动条（面板里是 max-height 322px）",
    "· P0 金 / P1 橙 / P2 蓝，三级都上底色",
    "· 左上 NEW（未读才有），点开「高级」就消失",
    "· 中间文案，右下角时间，按时间倒序",
]
ny = px(700)
for n in notes:
    d.text((PAD + px(18), ny), n, font=f_note, fill=(110, 130, 146))
    ny += px(20)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock_feed_cards.png")
img.resize((PW, PH), Image.LANCZOS).save(out)
print(out)
