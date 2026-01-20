# 实时输出当前鼠标位置坐标，便于获取截图区域坐标
import pyautogui
import time

pyautogui.scroll(-1400)

try:
    while True:
        x, y = pyautogui.position()
        print(f"当前鼠标位置坐标: ({x}, {y})", end="\r")
        time.sleep(0.1)
except KeyboardInterrupt:
    print("\n程序已停止。")