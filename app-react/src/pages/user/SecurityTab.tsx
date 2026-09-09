// ============================================================================
// SecurityTab.tsx —— 标签三：安全性与登录
// 设计原则 #2「安全功能只搬迁，不改动」：直接复用现有 SecurityPage 的全部
// 功能模块（设备管理/恢复码/指纹绑定/登录记录等入口），零后端逻辑改动，
// 仅由父级 UserCenterPage 提供 Tabs 外壳实现 UI 整合。
// ============================================================================
import SecurityPage from '../SecurityPage';

export default function SecurityTab() {
  return <SecurityPage />;
}
