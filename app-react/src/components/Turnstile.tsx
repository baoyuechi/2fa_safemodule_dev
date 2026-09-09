// ============================================================================
// Turnstile.tsx —— Cloudflare Turnstile 人机验证 widget（显式渲染模式）
//
// 零依赖：按需注入官方 api.js（单例 promise 防重复加载），render 到本组件容器。
// token 一次性：提交消费后由调用方经 ref.reset() 重置（见各认证页用法）。
// 服务端校验：GoTrue [auth.captcha]（登录/注册/邮箱找回）与 phone/send-otp 内
// siteverify——本组件只负责产出 token，与主站 reference 的嵌入式用法同构。
//
// ── 三档落点（与 CF 后台 widget 模式匹配，勿被字面误导）──
// CF 的 Managed / Non-Interactive / Invisible 是建 widget 时选定的单一模式，
// 本组件只负责渲染细节（appearance/execution）。要达成「后台无感为主、
// 风控怀疑才弹框」，widget 模式必须在 CF 后台设为 Managed——它在无感与
// checkbox 弹框间按风控自动切换；Invisible 永不弹框、Non-Interactive 常显
// spinner，均与目标冲突。前端侧配合显式声明 interaction-only + render 执行。
// ============================================================================
import * as React from 'react';
import Box from '@mui/material/Box';
import { useColorScheme } from '@mui/material/styles';
import { TURNSTILE_SITE_KEY } from '../api/mfaClient';

/** api.js 注入后挂到 window 的 Turnstile 全局对象（仅声明用到的方法） */
interface TurnstileGlobal {
  render: (el: HTMLElement, params: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

const API_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/** 单例加载官方脚本；重复调用共享同一 promise（多页签组件并发安全） */
let scriptPromise: Promise<TurnstileGlobal> | null = null;
function loadTurnstile(): Promise<TurnstileGlobal> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = API_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('turnstile loaded but global missing'));
    s.onerror = () => {
      scriptPromise = null; // 允许下次重试
      reject(new Error('failed to load turnstile api.js'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  /** 清空当前 token 并重新挑战（提交消费后 / 换账号后调用） */
  reset: () => void;
}

interface TurnstileProps {
  /** 挑战成功回调（token 一次性，过期也会先触发 onExpire） */
  onToken: (token: string) => void;
  /** token 过期回调（调用方应清空已保存的 token） */
  onExpire?: () => void;
}

/**
 * 人机验证 widget。渲染期间通过 ref 暴露 reset()；主题跟随应用配色
 * （暗色下 Turnstile 以 dark 外观渲染，切换主题时重建 widget）。
 */
const Turnstile = React.forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { onToken, onExpire },
  ref,
) {
  const { mode, systemMode } = useColorScheme();
  const resolved = mode === 'system' ? (systemMode ?? 'light') : (mode ?? 'light');
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  // error/timeout 自愈：重置 widget 重试挑战（每次渲染重新计数，限 2 次，防死循环）
  const retryCountRef = React.useRef(0);
  const retryChallenge = React.useCallback(() => {
    if (retryCountRef.current >= 2) return;
    retryCountRef.current += 1;
    window.setTimeout(() => {
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    }, 1500);
  }, []);
  // 回调经 ref 转发，避免父组件每次渲染新函数触发 widget 重建
  const onTokenRef = React.useRef(onToken);
  const onExpireRef = React.useRef(onExpire);
  onTokenRef.current = onToken;
  onExpireRef.current = onExpire;

  React.useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    },
  }));

  React.useEffect(() => {
    let cancelled = false;
    retryCountRef.current = 0;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = ts.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: resolved,
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onExpireRef.current?.(),
          // 出错/交互超时：清 token 并自动重试挑战，避免 token 永久缺失卡死提交
          'error-callback': () => {
            onExpireRef.current?.();
            retryChallenge();
          },
          'timeout-callback': () => {
            onExpireRef.current?.();
            retryChallenge();
          },
          'response-field': false, // 不注入隐藏 input（React 受控，不需要）
          // 三档落点：Managed（CF 后台 widget 模式）+ interaction-only（前端外观）。
          // 后台无感为主——页面加载即静默签发 token（execution render）；
          // 仅当 CF 风控怀疑才内联弹出 checkbox 挑战（interaction-only 触发）。
          execution: 'render',
          appearance: 'interaction-only',
        });
      })
      .catch((e) => console.error('[turnstile] render failed:', e));
    return () => {
      cancelled = true;
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [resolved]); // 主题切换 → 移除并重渲染（旧 token 随之失效，符合一次性语义）

  // interaction-only 下常态不可见（token 后台签发）；仅风控要求交互时 widget 撑开显示
  return <Box ref={containerRef} sx={{ minHeight: 0 }} />;
});

export default Turnstile;
