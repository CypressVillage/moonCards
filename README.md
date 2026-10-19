## 《月圆之夜》卡牌图鉴

这个仓库收集了《月圆之夜》游戏中经典模式和小红帽日记模式下的绝大部分卡牌，用于线上浏览和实体打印。同时提供了一个 web 页面用于查看、下载卡牌，以及编辑卡牌元数据（编辑功能需后端）

## 文件说明

**提取脚本说明：**

- `card_capture.py`：用于自动化从游戏图鉴中提取卡牌贴图
- `cap1CardinGame.py`：用于手动从游戏内截取卡牌贴图

**`assets` 资源文件夹说明：**

- `assets_extract`：从游戏中提取的部分 unity 贴图资源
- `bookCover`：根据 tb 店铺的卡册尺寸重新排版的卡册封面
- `card_base`：经典模式图鉴中“全部”选项收录的卡牌
- `card_base_extra`：经典模式图鉴中未出现且游戏中能遇到的部分卡牌
- `card_ce`：通过 CE 修改出的部分废稿卡牌
- `card_ce_41`：官方愚人节动态中发布的 7 张卡牌，没想到真的做到了游戏里，通过 CE 获得
- `card_ce_ok`：卡面完整、效果完整的 CE 卡牌
- `card_diary`：小红帽日记模式图鉴中“全部”选项收录的卡牌
- `card_diary_extra`：小红帽日记模式中可以获得的 14 张初始怪物卡牌，图鉴中未出现
- `card_monster`：经典模式/小红帽日记图鉴中“怪物”选项收录的卡牌
- `card_skill`：部分角色的局内技能卡牌，共 17 张
- `excel`：群友通过逆向整理的卡牌信息 Excel 文件
- `kra_prjs`：使用 krita 制作的牌背文件
- `paints`：游戏中的 DLC 立绘

## 实体打印

月圆之夜的卡牌长宽比为3:2，适合使用 87x57mm 的卡牌尺寸；

经过测试，使用300g铜版纸，正面覆亮膜、背面覆哑膜的工艺效果和性价比较好

## 本地部署服务

本地部署服务可以在网页内方便地对卡牌元数据进行编辑。

需要 Node.js 22.18+ 或 24+。

```bash
npm install
npm run dev
```
其他操作

```bash
npm run validate  # 只检查元数据和源图片
npm test          # 检索、合并和校验逻辑测试
npm run build    # 校验、生成资源、类型检查、构建
npm run preview  # 预览构建结果
```

## 卡牌元数据说明

卡牌元数据存放在data文件夹下，每个JSON代表一个卡组，JSON 中的每条记录代表一张卡。例如 `base.json` 中的一条记录：

```json
{
  "name": "示例卡",
  "group": "base",
  "level": 1,
  "classes": ["职业A", "职业B"],
  "type": "攻击",
  "cost": 1,
  "image": "assets/card_base/示例卡1.png",
  "relatedCards": []
}
```

- `name`：卡牌名称。可重复，同组内名称相同的卡牌会合并展示。
- `group`：卡组类别，必须与所在 JSON 文件名一致，例如 `base`、`base_extra`、`diary`。
- `level`：卡牌星级，正整数；没有星级时填 `null`。
- `classes`：统一职业值数组（如 `女骑士`、`游侠`）；
- `type`：卡牌类型，例如“攻击”“装备”“法力”“咒术”。
- `cost`：卡牌消耗，非负整数或 `null`。`0` 为明确零费，`null` 表示无消耗
- `image`：当前组的 `assets/card_<group>/` 目录下的真实图片相对路径。
- `relatedCards`：相关卡牌，填写卡牌名称
- `hidden`：可选，默认 `false`。设为 `true` 时不出现在图鉴列表和名称搜索中，仍可通过关联按钮访问。
