from PIL import Image

imgDir = "assets/assets_extract/"
# 打开图片
img = Image.open(f"{imgDir}jd.png")

# 放大倍数，比如3倍
scale = 3

# 新尺寸
new_width = int(img.width * scale)
new_height = int(img.height * scale)

# 使用高质量Lanczos插值进行放大
resized_img = img.resize((new_width, new_height), Image.LANCZOS)

# 保存结果
resized_img.save(f"{imgDir}jd_3.png")
    