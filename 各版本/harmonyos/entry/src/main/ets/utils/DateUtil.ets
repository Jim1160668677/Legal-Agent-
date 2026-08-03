/**
 * 日期格式化工具
 */

/**
 * 格式化日期时间为字符串
 * @param timestamp 时间戳(ms)
 * @param format 格式模板，默认 'YYYY-MM-DD HH:mm'
 */
export function formatDateTime(timestamp: number, format: string = 'YYYY-MM-DD HH:mm'): string {
  const date = new Date(timestamp);
  return format
    .replace('YYYY', date.getFullYear().toString())
    .replace('MM', padZero(date.getMonth() + 1))
    .replace('DD', padZero(date.getDate()))
    .replace('HH', padZero(date.getHours()))
    .replace('mm', padZero(date.getMinutes()))
    .replace('ss', padZero(date.getSeconds()));
}

/**
 * 格式化相对时间（如：刚刚、5分钟前、2小时前）
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60 * 1000) {
    return '刚刚';
  } else if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}分钟前`;
  } else if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}小时前`;
  } else if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}天前`;
  } else {
    return formatDateTime(timestamp, 'MM-DD');
  }
}

/**
 * 格式化日期（仅日期部分）
 */
export function formatDate(timestamp: number): string {
  return formatDateTime(timestamp, 'YYYY-MM-DD');
}

/**
 * 格式化时间（仅时间部分）
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${padZero(date.getHours())}:${padZero(date.getMinutes())}`;
}

/**
 * 格式化日期范围显示
 */
export function formatSessionDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) {
    return formatTime(timestamp);
  } else if (diffDays === 1) {
    return '昨天';
  } else if (diffDays < 7) {
    return `${diffDays}天前`;
  } else if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)}周前`;
  } else {
    return formatDateTime(timestamp, 'YYYY-MM-DD');
  }
}

/**
 * 获取会话分组标题
 */
export function getSessionGroupTitle(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) {
    return '今天';
  } else if (diffDays === 1) {
    return '昨天';
  } else if (diffDays < 7) {
    return '近7天';
  } else if (diffDays < 30) {
    return '近30天';
  } else {
    return '更早';
  }
}

function padZero(num: number): string {
  return num.toString().padStart(2, '0');
}
