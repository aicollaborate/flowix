export function tauriErrorMessage(error: unknown): string {
  return String(error ?? '');
}

export function hasTauriErrorCode(error: unknown, code: string): boolean {
  return tauriErrorMessage(error).includes(code);
}

export function notebookCreateErrorMessage(error: unknown): string {
  if (hasTauriErrorCode(error, 'PATH_ALREADY_REGISTERED')) return '该文件夹已作为笔记本添加';
  if (hasTauriErrorCode(error, 'PATH_MISSING')) return '文件夹不存在';
  if (hasTauriErrorCode(error, 'INVALID_NAME')) return '请输入笔记本名称';
  if (hasTauriErrorCode(error, 'INVALID_PATH')) return '请选择文件夹';
  if (hasTauriErrorCode(error, 'INDEX_WRITE_FAILED')) return '创建失败，索引写入失败';
  return '创建失败';
}

export function notebookDeleteErrorMessage(error: unknown): string {
  if (hasTauriErrorCode(error, 'DEFAULT_NOTEBOOK_CANNOT_DELETE')) return '默认笔记本不可删除';
  if (hasTauriErrorCode(error, 'NOTEBOOK_NOT_FOUND')) return '笔记本不存在';
  if (hasTauriErrorCode(error, 'INDEX_WRITE_FAILED')) return '删除失败，索引写入失败';
  return '删除失败';
}
