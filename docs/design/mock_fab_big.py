# 临时预览脚本：把放大 2.5 倍后的悬浮球（150px 透明底鲸鱼）+ 悬停/按下的形变画成 1:1 真像素图，
# 供用户重启前先看一眼比例和动效幅度。用完可删。
import sys
from PIL import Image, ImageDraw, ImageFont

ICON = r"H:\因爱而生的鱼\dsh-my-phone\icon.png"
OUT = r"H:\因爱而生的鱼\dsh-my-phone\test\mock_fab_big.png"

TILE = 150   # 与 client.js 的 FAB_TILE 一致
INNER = 116  # FAB_INNER

W, H = 1280, 620
img = Image.new("RGB", (W, H), (238, 244, 250))
d = ImageDraw.Draw(img)

# 背景：左边浅色、右边深色（壁纸两种极端都看一眼）
d.rectangle([0, 0, W // 2, H], fill=(240, 246, 252))
d.rectangle([W // 2, 0, W, H], fill=(28, 41, 56))

def font(sz, bold=False):
    for p in (
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
    ):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()

F_T = font(26, True)
F_S = font(15)
F_L = font(12, True)

whale = Image.open(ICON).convert("RGBA")
# 按 INNER 缩放（保持原始宽高比里取正方形内容）
whale = whale.resize((INNER, INNER), Image.LANCZOS)


def draw_ball(cx, cy, sx, sy, rot, label, caption, dark=False):
    """在 (cx,cy) 画一个「鲸鱼 + 文字胶囊」，sx/sy 是横竖缩放，rot 是角度。"""
    t = whale.resize((max(1, int(INNER * sx)), max(1, int(INNER * sy))), Image.LANCZOS)
    t = t.rotate(rot, expand=True, resample=Image.BICUBIC)
    x = cx - t.width // 2
    y = cy - t.height // 2
    img.paste(t, (x, y), t)
    # 文字胶囊（半透明白，跟实现一致）
    tw = d.textlength(label, font=F_L)
    pw = int(tw) + 22
    px0 = cx - pw // 2
    py0 = cy + TILE // 2 + 8
    pill = Image.new("RGBA", (pw, 22), (255, 255, 255, 232))
    img.paste(pill, (px0, py0), pill)
    d.text((cx - tw / 2, py0 + 3), label, font=F_L, fill=(51, 64, 92))
    d.text((cx - d.textlength(caption, font=F_S) / 2, py0 + 34), caption, font=F_S,
           fill=(120, 136, 158) if not dark else (150, 168, 190))


d.text((26, 20), "DSH My Phone 悬浮球：放大 2.5 倍（150px）+ 鲸鱼式形变 · 1:1 真实像素", font=F_T,
       fill=(13, 38, 60))
d.text((26, 56), "左：浅色壁纸　右：深色壁纸　（图标透明底，没有白方块/描边/投影）", font=F_S, fill=(95, 115, 138))

frames = [
    (1.00, 1.00, 0, "连接 DSH", "静止 / 鼠标移开"),
    (1.14, 1.20, 2, "连接 DSH", "悬停 25%：上摆"),
    (1.20, 1.12, 5, "连接 DSH", "悬停 50%：下摆"),
    (1.16, 0.76, 3, "连接 DSH", "按下：压扁回弹"),
]

# 浅色区：4 帧横排
x0 = 120
for i, (sx, sy, rot, lab, cap) in enumerate(frames):
    draw_ball(x0 + i * 150, 250, sx, sy, rot, lab, cap, dark=False)

# 深色区：静止 + 悬停两帧
x0 = W // 2 + 140
for i, (sx, sy, rot, lab, cap) in enumerate(frames[:3]):
    draw_ball(x0 + i * 150, 250, sx, sy, rot, lab, cap, dark=True)

d.text((26, 560), "旧的 60px 版本做对比：", font=F_S, fill=(95, 115, 138))
old = whale.resize((46, 46), Image.LANCZOS)
img.paste(old, (200, 552), old)

img.save(OUT)
print("saved", OUT, img.size)
