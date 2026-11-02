export function formatDuration(value: number | null | undefined): string {
  if (value == null) return '—';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatPace(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.floor(value / 60)}′${String(Math.round(value % 60)).padStart(2, '0')}″`;
}

export const milestones = [
  { count: 1, title: '初心跑者', reward: '保存首次跑步纪念' },
  { count: 5, title: '起步者', reward: '一双舒适的跑步袜' },
  { count: 10, title: '习惯萌芽', reward: '一顿喜欢的健康餐' },
  { count: 25, title: '稳定跑者', reward: '制作个人跑步纪念卡' },
  { count: 50, title: '半百跑者', reward: '一件喜欢的运动装备' },
  { count: 100, title: '百跑达人', reward: '第一张百跑电子奖状' },
  { count: 200, title: '持久跑者', reward: '安排一次特别的风景跑' },
  { count: 365, title: '岁月跑者', reward: '制作个人跑步纪念册' },
  { count: 500, title: '五百跑者', reward: '一件有纪念意义的物品' },
  { count: 1000, title: '千跑传奇', reward: '一枚专属千跑纪念奖章' },
];
