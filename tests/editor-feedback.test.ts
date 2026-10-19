import test from 'node:test';
import assert from 'node:assert/strict';
import { isErrorMessage, isTransientMessage } from '../src/editor-feedback.ts';

test('成功反馈可临时显示，不将报错当成可自动消失的成功提示', () => {
  for (const message of ['已保存到本地 data/cards/base.json，其他组文件未修改', '已导出 JSON；尚未写入项目文件。', '操作完成：\n移动图片', '操作完成：\n移动 assets/card_base/失败.png', '已收录到当前编辑列表，尚未保存 JSON', '已撤销本次收录，源图片未删除']) {
    assert.equal(isTransientMessage(message), true);
    assert.equal(isErrorMessage(message), false);
  }
  for (const message of ['读取失败：Error: 网络错误', '保存失败：Error: 文件已变更', '操作失败：Error: 关联冲突', '上传失败：图片过大', '收录失败：重复图片', '元数据已保存，但扫描刷新失败', '请先保存当前元数据修改，再执行图片文件操作', 'Error: 卡牌名称不能为空']) {
    assert.equal(isTransientMessage(message), false);
    assert.equal(isErrorMessage(message), true);
  }
  assert.equal(isTransientMessage('请选择卡牌类型并核对元数据'), false);
});
