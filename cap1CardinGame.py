# 截取游戏内卡组栏的卡牌详细说明

import pyautogui
import time
import os

# ==== 用户须填写并根据实际需要调整以下参数 ====
# 每一行卡牌的6个中心点坐标 (x, y)
card_position = [
    (550, 600)
]
# 截图区域 (left, top, width, height)
capture_region = (1091, 214, 372, 560)
# 卡牌名称
card_name = "card_001"
# 保存图片的文件夹名
save_dir = "assets/card_ce"
# 操作间隙（秒，根据电脑反应速度适度调整）
delay_between = 0.3

# ==== 以下为自动化流程主逻辑，无需修改 ====
if not os.path.exists(save_dir):
    os.makedirs(save_dir)

img = pyautogui.screenshot(region=capture_region)
img.save(f"{save_dir}/{card_name}.png")

print(f"完成截图，共保存 1 张卡牌图片于目录: {save_dir}")
