// ============================================================================
// userProfileStore.tsx —— 用户中心 MVP 数据层（不引入新依赖、新数据模型）
//
// - 档案（昵称/签名/年级/班级/头像预览）：localStorage 持久化，key 按用户隔离
//   `uc.profile.<uid>`；保存时 console.log（验收标准 #3），后端先 mock。
// - 内容统计（发帖数/评论数/获赞数）与最近 5 条帖子：优先查真实数据表
//   （posts / comments，若论坛表已建则直接命中）；表不存在/请求失败时
//   降级为空状态（0 / [] + supported=false），绝不虚构数字。
// - 头像上传：仅 FileReader 本地预览 + localStorage，可配额失败时仅放内存。
// ============================================================================
import * as React from 'react';

export interface UserProfile {
  nickname: string;
  bio: string;
  grade: string;
  className: string;
  avatarDataUrl: string | null;
  updatedAt: string | null;
}

export interface ContentStats {
  posts: number;
  comments: number;
  likes: number;
  /** false = posts/comments 表不存在或不可读，数字为降级 0 */
  supported: boolean;
}

export interface RecentPost {
  id: string;
  title: string;
  createdAt: string;
}

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

function profileKey(uid: string): string {
  return `uc.profile.${uid}`;
}

export function defaultNickname(email?: string): string {
  if (!email || !email.includes('@')) return '新用户';
  return email.split('@')[0] ?? '新用户';
}

function loadProfile(uid: string, email?: string): UserProfile {
  const fallback: UserProfile = {
    nickname: defaultNickname(email),
    bio: '',
    grade: '',
    className: '',
    avatarDataUrl: null,
    updatedAt: null,
  };
  try {
    const raw = localStorage.getItem(profileKey(uid));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    return { ...fallback, ...parsed, avatarDataUrl: parsed.avatarDataUrl ?? null };
  } catch {
    return fallback;
  }
}

/** 发帖数等：PostgREST count=head 轻量统计；任意失败 → 降级 0（不抛错） */
async function countRows(
  token: string,
  table: 'posts' | 'comments',
  uid: string,
): Promise<number | null> {
  try {
    // 常见论坛模型：作者列可能是 author_id / user_id，逐个尝试
    for (const col of ['author_id', 'user_id']) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?select=id&${col}=eq.${encodeURIComponent(uid)}&limit=1`,
        {
          method: 'HEAD',
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${token}`,
            Prefer: 'count=exact',
          },
        },
      );
      if (res.ok) {
        const range = res.headers.get('content-range') ?? '';
        const total = range.split('/')[1];
        const n = Number(total);
        if (Number.isFinite(n)) return n;
        return 0;
      }
      // 400（列不存在）则换下一列名；404（表不存在）直接降级
      if (res.status === 404) return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** 真实统计：posts/comments 表存在则命中，否则 supported=false */
export async function fetchUserContentStats(token: string, uid: string): Promise<ContentStats> {
  const [posts, comments] = await Promise.all([countRows(token, 'posts', uid), countRows(token, 'comments', uid)]);
  if (posts === null && comments === null) {
    return { posts: 0, comments: 0, likes: 0, supported: false };
  }
  // 获赞数：MVP 无 likes 表，展示 0 并在 UI 注明口径（不虚构）
  return { posts: posts ?? 0, comments: comments ?? 0, likes: 0, supported: true };
}

/** 最近 5 条帖子摘要：表存在则取真实行，否则 [] */
export async function fetchRecentPosts(token: string, uid: string): Promise<{ posts: RecentPost[]; supported: boolean }> {
  for (const col of ['author_id', 'user_id']) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/posts?select=id,title,created_at&${col}=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=5`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<{ id: unknown; title: unknown; created_at: unknown }>;
        return {
          supported: true,
          posts: rows.map((r) => ({
            id: String(r.id),
            title: String(r.title ?? '(无标题)'),
            createdAt: String(r.created_at ?? ''),
          })),
        };
      }
      if (res.status === 404) return { posts: [], supported: false };
    } catch {
      return { posts: [], supported: false };
    }
  }
  return { posts: [], supported: false };
}

// ---------------------------------------------------------------------------
// Context：档案读写（内存 + localStorage），跨三个 Tab 共享，不引入新依赖
// ---------------------------------------------------------------------------
interface UserProfileCtx {
  profile: UserProfile;
  saveProfile: (patch: Partial<UserProfile>) => void;
}

const Ctx = React.createContext<UserProfileCtx | null>(null);

export function UserProfileProvider({
  uid,
  email,
  children,
}: {
  uid: string;
  email?: string;
  children: React.ReactNode;
}) {
  const [profile, setProfile] = React.useState<UserProfile>(() => loadProfile(uid, email));

  // 切换账号时重载
  React.useEffect(() => {
    setProfile(loadProfile(uid, email));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const saveProfile = React.useCallback(
    (patch: Partial<UserProfile>) => {
      setProfile((prev) => {
        const next: UserProfile = { ...prev, ...patch, updatedAt: new Date().toISOString() };
        // 验收 #3：提交先打印 console；localStorage 即 mock 后端
        console.log('[user-center] saveProfile', next);
        try {
          localStorage.setItem(profileKey(uid), JSON.stringify(next));
        } catch (e) {
          // 头像 dataURL 可能超配额：退化为仅内存（去掉头像再存一次）
          console.warn('[user-center] profile persist failed, keep in memory', e);
          try {
            const { avatarDataUrl: _drop, ...rest } = next;
            localStorage.setItem(profileKey(uid), JSON.stringify({ ...rest, avatarDataUrl: null }));
          } catch {
            /* 忽略 */
          }
        }
        return next;
      });
    },
    [uid],
  );

  const value = React.useMemo(() => ({ profile, saveProfile }), [profile, saveProfile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserProfile(): UserProfileCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useUserProfile must be used within UserProfileProvider');
  return ctx;
}
