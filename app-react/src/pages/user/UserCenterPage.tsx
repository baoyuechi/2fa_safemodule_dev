// ============================================================================
// UserCenterPage.tsx —— 用户中心布局（路由级，切换不刷新页面）
//
// 路由契约（见 main.tsx）：
//   /profile  → 个人主页（标签一）
//   /settings → 个人资料（标签二）
//   /security → 安全性与登录（标签三，直接复用 SecurityPage）
//
// 顶部 Tabs 已删除（与左导航完全重复），此处仅保留 UserProfileProvider
// 上下文 + Outlet，子页通过 useUserProfile() 共享档案读写。
// ============================================================================
import { Outlet } from 'react-router-dom';
import { useAccount } from '../../components/AccountLayout';
import { UserProfileProvider } from './userProfileStore';

export default function UserCenterPage() {
  const { user } = useAccount();
  const uid = String((user as { id: string }).id);
  const email = (user as { email?: string }).email as string | undefined;

  return (
    <UserProfileProvider uid={uid} email={email}>
      <Outlet />
    </UserProfileProvider>
  );
}
