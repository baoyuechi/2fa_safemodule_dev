// ============================================================================
// ProfileHomeTab.tsx —— 标签一：个人主页（MVP，只读展示）
// - 身份：头像/昵称/年级·班级（有则展示，无则隐藏，不虚构）
// - 统计：发帖数/评论数/获赞数（真实表命中，否则降级 0 + 口径说明）
// - 最近 5 条帖子摘要（标题 + 发布时间；无表/无帖子时空状态）
// ============================================================================
import * as React from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAccount } from '../../components/AccountLayout';
import { useI18n } from '../../i18n/LocaleContext';
import {
  fetchRecentPosts,
  fetchUserContentStats,
  useUserProfile,
  type ContentStats,
  type RecentPost,
} from './userProfileStore';
import { getSession } from '../../api/mfaClient';

function formatTime(iso: string, locale: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

export default function ProfileHomeTab() {
  const { user } = useAccount();
  const { locale } = useI18n();
  const { profile } = useUserProfile();
  const [stats, setStats] = React.useState<ContentStats | null>(null);
  const [recent, setRecent] = React.useState<RecentPost[] | null>(null);
  const [postsSupported, setPostsSupported] = React.useState(true);

  const uid = String((user as { id: string }).id);
  const email = String((user as { email?: string }).email ?? '');
  const createdAt = String((user as { created_at?: string }).created_at ?? '');
  const initial = (profile.nickname || email || '?').slice(0, 1).toUpperCase();
  const gradeClass = [profile.grade, profile.className].filter(Boolean).join(' · ');

  React.useEffect(() => {
    const session = getSession();
    if (!session?.access_token) {
      setStats({ posts: 0, comments: 0, likes: 0, supported: false });
      setRecent([]);
      setPostsSupported(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [s, r] = await Promise.all([
        fetchUserContentStats(session.access_token as string, uid),
        fetchRecentPosts(session.access_token as string, uid),
      ]);
      if (cancelled) return;
      setStats(s);
      setRecent(r.posts);
      setPostsSupported(r.supported);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const zh = locale === 'zh';
  const statItems = [
    { label: zh ? '发帖' : 'Posts', value: stats?.posts },
    { label: zh ? '评论' : 'Comments', value: stats?.comments },
    { label: zh ? '获赞' : 'Likes', value: stats?.likes },
  ];

  return (
    <>
      <Typography variant="h1">{zh ? '个人主页' : 'Profile'}</Typography>

      {/* 身份卡：头像 + 昵称 + 年级/班级（有则展示） */}
      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3.5 }}>
        <Stack direction="row" spacing={3} alignItems="center">
          <Avatar src={profile.avatarDataUrl ?? undefined} sx={{ width: 80, height: 80, bgcolor: 'primary.main', fontSize: 28 }}>
            {initial}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h2" noWrap>
              {profile.nickname}
            </Typography>
            {gradeClass && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                {gradeClass}
              </Typography>
            )}
            <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere', mt: 0.5 }}>
              {email}
            </Typography>
            {createdAt && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                {zh ? `注册于 ${formatTime(createdAt, locale)}` : `Joined ${formatTime(createdAt, locale)}`}
              </Typography>
            )}
          </Box>
        </Stack>
        {profile.bio && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2.5, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            {profile.bio}
          </Typography>
        )}
      </Card>

      {/* 统计卡 */}
      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3.5 }}>
        <Stack direction="row" spacing={0} sx={{ textAlign: 'center' }}>
          {statItems.map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 && <Divider orientation="vertical" flexItem sx={{ mx: { xs: 2, sm: 3.5 } }} />}
              <Box sx={{ flex: 1 }}>
                <Typography variant="h1" sx={{ fontSize: '1.75rem', lineHeight: 1.4 }}>
                  {item.value === undefined ? '—' : item.value}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {item.label}
                </Typography>
              </Box>
            </React.Fragment>
          ))}
        </Stack>
        {stats && !stats.supported && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
            {zh
              ? '内容表尚未接入，当前为降级展示（0）。帖子表就绪后自动显示真实统计。'
              : 'Content tables are not connected yet; showing fallback zeros.'}
          </Typography>
        )}
      </Card>

      {/* 最近帖子 */}
      <Box sx={{ mt: 1 }}>
        <Typography variant="h2">{zh ? '最近发布' : 'Recent posts'}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {zh ? '该用户最近发布的 5 条帖子摘要' : 'Latest 5 posts by this user'}
        </Typography>
      </Box>
      <Card variant="outlined" sx={{ overflow: 'hidden' }}>
        {recent === null ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : recent.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', px: { xs: 2.5, sm: 4 }, py: 3 }}>
            {postsSupported ? (zh ? '还没有发布过帖子。' : 'No posts yet.') : zh ? '帖子表尚未接入，暂无可展示的内容。' : 'Post table not connected yet.'}
          </Typography>
        ) : (
          recent.map((p, i) => (
            <React.Fragment key={p.id}>
              {i > 0 && <Divider />}
              <Box sx={{ py: 2, px: { xs: 2.5, sm: 4 } }}>
                <Typography noWrap>{p.title}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {formatTime(p.createdAt, locale)}
                </Typography>
              </Box>
            </React.Fragment>
          ))
        )}
      </Card>
    </>
  );
}
