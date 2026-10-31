from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1240, 470
img = Image.new("RGB", (W, H), (233, 240, 245))
d = ImageDraw.Draw(img)


def font(sz, bold=False):
    for name in (
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyh.ttf",
        "C:/Windows/Fonts/simhei.ttf",
    ):
        if os.path.exists(name):
            try:
                return ImageFont.truetype(name, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def bubble(x, y, tag, tagc, part, partc, rest, sign, note):
    w, h = 366, 132
    d.rounded_rectangle([x, y, x + w, y + h], 14, fill=(255, 255, 255), outline=(64, 208, 208), width=1)
    # tag
    f_tag = font(13, True)
    d.text((x + 18, y + 16), tag, font=f_tag, fill=tagc)
    # main line
    f_part = font(19, True)
    f_rest = font(19)
    tx = x + 18
    ty = y + 42
    d.text((tx, ty), part, font=f_part, fill=partc)
    pw = d.textlength(part, font=f_part)
    d.text((tx + pw + 6, ty), rest, font=f_rest, fill=(51, 64, 92))
    # sign
    d.text((x + 18, y + 76), sign, font=font(13), fill=(92, 109, 132))
    # caption
    d.text((x + 18, y + h + 10), note, font=font(13), fill=(70, 90, 110))


TAG = (11, 127, 140)
AMBER = (200, 138, 0)
AMBER_L = (168, 121, 0)
ORANGE = (224, 108, 0)
TEAL = (11, 127, 140)

# 标题
d.text((28, 20), "优先级配色：P0 琥珀黄（白底可读） / P1 橙 / P2 蓝绿", font=font(20, True), fill=(16, 26, 44))

bubble(
    28, 70, "等授权", AMBER, "【整理插件的悬浮球】", AMBER, "正在请求授权...",
    "工作区权限 · 点「知道了」或回 DSH 处理", "P0 · 需要你决定 → 琥珀黄 #C88A00",
)
bubble(
    437, 70, "等回答", AMBER, "【整理插件的悬浮球】", AMBER, "正在等你回答...",
    "选择题 · 在 DSH 里选完自动消失", "P0 · 同上，措辞换成「等回答」",
)
bubble(
    846, 70, "注意", ORANGE, "【整理插件的悬浮球】", (200, 107, 0), "这一轮出错了",
    "看 DSH 里的报错", "P1 · 出状况 → 橙 #E06C00",
)

bubble(
    28, 250, "新连接", TEAL, "嘉然（iPhone）", (10, 122, 75), "刚连进来",
    "设置中可以手动断开", "P2 · 普通动态 → 蓝绿（现状不变）",
)
bubble(
    437, 250, "手机连接", TAG, "点一下 ·", (51, 64, 92), "手机扫码连 DSH",
    "3 分钟内有效", "P2 · 默认气泡",
)
bubble(
    846, 250, "版本", (122, 140, 163), "不知道名字的会话", (51, 64, 92), "会显示这个",
    "【未命名会话】 而不是 sessio…", "回退名（已修）",
)

# 左侧色条方案示意
d.text((28, 418), "备选：列表里给每行加 3px 左侧色条（P0 琥珀 / P1 橙 / P2 透明），扫一眼就知道哪条要处理", font=font(13), fill=(70, 90, 110))
for i, c in enumerate([AMBER, ORANGE, None]):
    x = 40 + i * 60
    d.rounded_rectangle([x, 440, x + 44, 452], 4, fill=(251, 254, 255), outline=(230, 242, 247))
    if c:
        d.rounded_rectangle([x, 440, x + 3, 452], 2, fill=c)

img.save(r"H:\因爱而生的鱼\dsh-my-phone\test\mock_priority.png")
print("ok")
