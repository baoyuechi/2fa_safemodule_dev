// 统一动效：进出场的 fade-up 关键帧 + 缓动曲线（Google 风格：快速起步、柔和减速）
export const EASE_EMPHASIS = 'cubic-bezier(0.2, 0, 0, 1)';

/** sx 片段：在 sx 里注册 @keyframes（emotion 按 key 去重，可安全多处引用） */
export const fadeUpKeyframes = {
  '@keyframes mfaFadeUp': {
    from: { opacity: 0, transform: 'translateY(14px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  '@keyframes mfaFadeIn': {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  '@keyframes mfaToastIn': {
    from: { opacity: 0, transform: 'translateY(-12px) scale(0.96)' },
    to: { opacity: 1, transform: 'translateY(0) scale(1)' },
  },
};

/** 卡片/页面入场：fade-up */
export const enterFadeUp = {
  ...fadeUpKeyframes,
  animation: `mfaFadeUp 0.4s ${EASE_EMPHASIS} both`,
};

/** 页内步骤切换：更快的 fade-up */
export const stepFadeUp = {
  ...fadeUpKeyframes,
  animation: `mfaFadeUp 0.3s ${EASE_EMPHASIS} both`,
};

/** 消息条入场：从上方轻弹入 */
export const toastIn = {
  ...fadeUpKeyframes,
  animation: `mfaToastIn 0.3s ${EASE_EMPHASIS} both`,
};
