// ============================================================================
// ProfileEditTab.tsx —— 标签二：个人资料（MVP）
// - 可编辑：昵称/个性签名/年级/班级 → 存 localStorage（mock 后端）+ console.log
// - 只读：注册邮箱/注册时间
// - 头像上传：UI 占位（按钮 + 预览），FileReader 本地预览，不对接存储
// ============================================================================
import * as React from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useAccount } from '../../components/AccountLayout';
import { useI18n } from '../../i18n/LocaleContext';
import { toast } from '../../api/mfaClient';
import { useUserProfile } from './userProfileStore';

export default function ProfileEditTab() {
  const { user } = useAccount();
  const { locale } = useI18n();
  const { profile, saveProfile } = useUserProfile();
  const zh = locale === 'zh';

  const email = String((user as { email?: string }).email ?? '');
  const createdAt = String((user as { created_at?: string }).created_at ?? '');
  const [nickname, setNickname] = React.useState(profile.nickname);
  const [bio, setBio] = React.useState(profile.bio);
  const [grade, setGrade] = React.useState(profile.grade);
  const [className, setClassName] = React.useState(profile.className);
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(profile.avatarDataUrl);
  const [saved, setSaved] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  // 切换账号/外部更新时同步表单
  React.useEffect(() => {
    setNickname(profile.nickname);
    setBio(profile.bio);
    setGrade(profile.grade);
    setClassName(profile.className);
    setAvatarPreview(profile.avatarDataUrl);
  }, [profile]);

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast(zh ? '请选择图片文件' : 'Please choose an image file', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // UI 占位：仅本地预览，不上传存储
      setAvatarPreview(String(reader.result));
      setSaved(false);
    };
    reader.readAsDataURL(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) {
      toast(zh ? '昵称不能为空' : 'Nickname is required', 'error');
      return;
    }
    saveProfile({ nickname: name, bio: bio.trim(), grade: grade.trim(), className: className.trim(), avatarDataUrl: avatarPreview });
    setSaved(true);
    toast(zh ? '已保存' : 'Saved', 'success');
  }

  const initial = (nickname || email || '?').slice(0, 1).toUpperCase();

  return (
    <>
      <Typography variant="h1">{zh ? '个人资料' : 'Settings'}</Typography>

      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Stack direction="row" spacing={3} alignItems="center">
          <Avatar src={avatarPreview ?? undefined} sx={{ width: 80, height: 80, bgcolor: 'primary.main', fontSize: 28 }}>
            {initial}
          </Avatar>
          <Box>
            <Typography variant="h2">{zh ? '头像' : 'Avatar'}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
              {zh ? 'MVP 占位：仅本地预览，不上传存储。' : 'MVP placeholder: local preview only, no upload.'}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Button variant="outlined" size="small" sx={{ borderRadius: 999 }} onClick={() => fileRef.current?.click()}>
                {zh ? '上传头像' : 'Upload'}
              </Button>
              {avatarPreview && (
                <Button variant="text" size="small" sx={{ borderRadius: 999 }} onClick={() => { setAvatarPreview(null); setSaved(false); }}>
                  {zh ? '移除' : 'Remove'}
                </Button>
              )}
            </Stack>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handlePickFile} aria-label={zh ? '上传头像' : 'Upload avatar'} />
          </Box>
        </Stack>
      </Card>

      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Box component="form" onSubmit={handleSubmit}>
          <Stack spacing={3}>
            <TextField
              label={zh ? '昵称' : 'Nickname'}
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setSaved(false); }}
              inputProps={{ maxLength: 24 }}
              required
            />
            <TextField
              label={zh ? '个性签名' : 'Bio'}
              value={bio}
              onChange={(e) => { setBio(e.target.value); setSaved(false); }}
              inputProps={{ maxLength: 120 }}
              multiline
              minRows={2}
              placeholder={zh ? '一句话介绍自己（可选）' : 'A short intro (optional)'}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <TextField
                label={zh ? '年级' : 'Grade'}
                value={grade}
                onChange={(e) => { setGrade(e.target.value); setSaved(false); }}
                inputProps={{ maxLength: 16 }}
                placeholder={zh ? '如：高一' : 'e.g. Grade 10'}
              />
              <TextField
                label={zh ? '班级' : 'Class'}
                value={className}
                onChange={(e) => { setClassName(e.target.value); setSaved(false); }}
                inputProps={{ maxLength: 16 }}
                placeholder={zh ? '如：3 班' : 'e.g. Class 3'}
              />
            </Stack>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ pt: 1 }}>
              <Button type="submit" variant="contained" sx={{ borderRadius: 999, px: 3 }}>
                {zh ? '保存' : 'Save'}
              </Button>
              {saved && (
                <Typography variant="body2" sx={{ color: 'success.main' }}>
                  {zh ? '已保存到本地（mock 后端，详见 console）。' : 'Saved locally (mock backend, see console).'}
                </Typography>
              )}
            </Stack>
          </Stack>
        </Box>
      </Card>

      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Typography variant="h2">{zh ? '账号信息（只读）' : 'Account (read-only)'}</Typography>
        <Stack spacing={2.5} sx={{ mt: 2.5 }}>
          <TextField label={zh ? '注册邮箱' : 'Email'} value={email} InputProps={{ readOnly: true }} />
          <TextField
            label={zh ? '注册时间' : 'Joined'}
            value={createdAt ? new Date(createdAt).toLocaleString() : '-'}
            InputProps={{ readOnly: true }}
          />
        </Stack>
      </Card>
    </>
  );
}
