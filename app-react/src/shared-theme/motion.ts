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

/** 瀑布式级联入场：按延迟依次向下铺开（文档页各节用递增 delay） */
export const cascadeUp = (delaySeconds: number) => ({
  ...fadeUpKeyframes,
  animation: `mfaFadeUp 0.55s ${EASE_EMPHASIS} both`,
  animationDelay: `${delaySeconds}s`,
});

/** 消息条入场：从上方轻弹入 */
export const toastIn = {
  ...fadeUpKeyframes,
  animation: `mfaToastIn 0.3s ${EASE_EMPHASIS} both`,
};

/** 加速缓动（先慢后快）：程序化滚动动画用 ease-in */
export const easeInCubic = (p: number) => p * p * p;

/** 先慢后快再慢：滚动动画用 ease-in-out */
export const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

let activeScrollRaf = 0;

/** 变速滚动：从当前位置滚到目标 Y（默认回到顶部）。
 *  ease-in-out 曲线 → 起步慢、中段快、结尾慢；减弱动效偏好时直接跳到目标。 */
export function animatedScrollTo(targetY = 0, durationMs = 750) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    window.scrollTo(0, targetY);
    return;
  }
  const startY = window.scrollY;
  const distance = targetY - startY;
  if (distance === 0) return;
  cancelAnimationFrame(activeScrollRaf);
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min((now - start) / durationMs, 1);
    window.scrollTo(0, startY + distance * easeInOutCubic(p));
    if (p < 1) activeScrollRaf = requestAnimationFrame(step);
  };
  activeScrollRaf = requestAnimationFrame(step);
}
