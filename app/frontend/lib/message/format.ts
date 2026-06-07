export function formatToolName(name: string | undefined): string {
  if (!name) return "未知";

  const labels: Record<string, string> = {
    read: "读取",
    write: "写入",
    edit: "编辑",
    ls: "列出目录",
    glob: "通配匹配",
    grep: "内容搜索",
    bash: "执行命令",
    list_notebooks: "列出笔记本",
    get_notebook_detail: "笔记本详情",
  };

  if (labels[name]) return labels[name];

  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function truncateStart(path: string, maxChars: number = 20): string {
  if (path.length <= maxChars) return path;
  return "..." + path.slice(-maxChars);
}

/**
 * 从路径中提取精简的文件名（用于工具消息的 summary 展示）
 * - 只返回文件名，不返回路径
 * - 去掉末尾的 memo id（-m_xxxxxx 格式）
 * - 去掉文件扩展名（仅当扩展名明显是扩展名时才去除，避免误伤日期中的点）
 */
export function extractFileName(path: string): string {
  // 获取文件名（不含路径）
  const fileName = path.split("/").pop() ?? path.split("\\").pop() ?? path;

  // 去掉末尾的 memo id（-m_xxxxxx，6位随机字符）
  const memoIdPattern = /-m_[a-zA-Z0-9]{6}$/;
  const withoutMemoId = fileName.replace(memoIdPattern, "");

  // 去掉文件扩展名：仅当扩展名明显是扩展名时才去除
  // 逻辑：如果点后面的内容看起来像扩展名（短且只含字母）才去除，避免误伤日期中的点
  const lastDot = withoutMemoId.lastIndexOf(".");
  const afterDot = lastDot >= 0 ? withoutMemoId.slice(lastDot + 1) : "";
  const hasProperExtension =
    lastDot > 0 && /^[a-zA-Z]{1,5}$/.test(afterDot) && afterDot.length <= 5;

  const withoutExt = hasProperExtension ? withoutMemoId.slice(0, lastDot) : withoutMemoId;

  return withoutExt || fileName;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}
