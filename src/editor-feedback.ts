export function isTransientMessage(message: string): boolean {
  return /^(已保存到本地|已导出 JSON|操作完成：|已收录到当前编辑列表|已撤销本次收录|已删除当前收录记录)/.test(message) && !isErrorMessage(message);
}

export function isErrorMessage(message: string): boolean {
  return /^(读取失败|保存失败|操作失败|上传失败|收录失败|删除失败|Error:|请先保存|元数据已保存，但扫描刷新失败)/.test(message);
}
