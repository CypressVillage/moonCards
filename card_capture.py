# 用于自动化截取游戏内卡牌图鉴中的卡牌图片
# 使用2k显示器
# 没有对最后一行做处理，需要单独将卡牌中心点高度设置为1200

import pyautogui
import time
import os

# ==== 用户须填写并根据实际需要调整以下参数 ====
# 每一行卡牌的6个中心点坐标 (x, y)
card_positions = [
    (550, 600),
    (900, 600),
    (1250, 600),
    (1600, 600),
    (1950, 600),
    (2300, 600),
]
# 卡牌预览的关闭按钮坐标
preview_close_position = (730, 1000)
# 截图区域 (left, top, width, height)
capture_region_big = (1019, 10, 517, 780)
# 保存图片的文件夹名
save_dir = "assets/card_last"
# 卡牌总数量（按实际填写）
total_cards = 85
# 操作间隙（秒，根据电脑反应速度适度调整）
delay_between = 0.3

# ==== 以下为自动化流程主逻辑，无需修改 ====
if not os.path.exists(save_dir):
    os.makedirs(save_dir)

card_counter = 1
for i in range(total_cards):
    row = i // 6
    col = i % 6

    if col == 0 and i != 0:
        # 每截完6张进行一次鼠标向下拖动翻页
        drag_start = (730, 1000)
        drag_end = (730, 509)
        pyautogui.moveTo(*drag_start)
        pyautogui.mouseDown()
        pyautogui.moveTo(*drag_end, duration=0.5)
        time.sleep(0.5)
        pyautogui.mouseUp()
        # time.sleep(1)

    # 点击指定卡牌坐标
    x, y = card_positions[col]
    pyautogui.moveTo(x, y)
    pyautogui.click()
    time.sleep(0.5)

    # 截取指定区域并保存图片
    img = pyautogui.screenshot(region=capture_region_big)
    img.save(f"{save_dir}/card_{card_counter:03d}.png")
    card_counter += 1
    time.sleep(0.2)

    # 点击关闭按钮
    pyautogui.moveTo(*preview_close_position)
    pyautogui.click()
    time.sleep(delay_between)

print(f"完成截图，共保存 {total_cards} 张卡牌图片于目录: {save_dir}")

# ==== 提示 ====
# (1) 鼠标坐标及截屏区域请用 pyautogui.mouseInfo 工具实时测量
# (2) scroll_step 请多次试验，直到刚好一行切换
# (3) 批量截图请先用少量卡牌验证再正式大量运行
