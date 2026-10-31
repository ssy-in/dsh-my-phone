import sys
from PIL import Image

src = r"H:\因爱而生的鱼\dsh-my-phone\icon.png"
img = Image.open(src).convert("RGBA")
bbox = img.getchannel("A").getbbox()
print("size", img.size, "bbox", bbox)
w = bbox[2] - bbox[0]
h = bbox[3] - bbox[1]
print("content", w, "x", h, "aspect h/w =", round(h / w, 4))

tight = img.crop(bbox)
# 右侧贴墙时靠的是图片底边，所以底部不能再留透明：先按内容裁死，再只做轻微内缩避免抗锯齿白边
tight.save(r"H:\因爱而生的鱼\dsh-my-phone\icon-tight.png")
# 96px 版（宽度 96，高度按比例）
tw = 192
th = max(1, round(tw * h / w))
tight.resize((tw, th), Image.LANCZOS).save(r"H:\因爱而生的鱼\dsh-my-phone\icon-tight-192.png")
print("wrote icon-tight.png", tight.size, "and icon-tight-192.png", (tw, th))
