import * as React from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { messages, type Locale, type MessageKey } from './messages';

const LOCALE_KEY = 'mfa.locale';
const HTML_LANG: Record<Locale, string> = { zh: 'zh-CN', en: 'en-US' };

let currentLocale: Locale = 'zh';
try {
  const stored = window.localStorage.getItem(LOCALE_KEY);
  if (stored === 'zh' || stored === 'en') currentLocale = stored;
} catch {
  /* storage 不可用时保持默认 zh */
}

const listeners = new Set<(locale: Locale) => void>();

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  const next = messages[locale] ? locale : 'zh';
  if (currentLocale === next) return;
  currentLocale = next;
  try {
    window.localStorage.setItem(LOCALE_KEY, next);
  } catch {
    /* 忽略持久化失败 */
  }
  listeners.forEach((listener) => listener(next));
}

/** 模块级翻译（随当前 locale，供非 React 层如 mfaClient 使用） */
export function tKey(key: MessageKey, vars?: Record<string, string | number>): string {
  const table = messages[currentLocale] ?? messages.en;
  return interpolate(table[key] ?? messages.en[key], vars);
}

function subscribeLocale(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<I18nValue | null>(null);

/**
 * 全局语言环境：中文 / 美式英文。切换后更新 document.lang 与 document.title。
 * 所有消费 useI18n().t 的组件会在 locale 变化时自动重渲染。
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  // 响应模块级 setLocale（页面通过 useI18n().setLocale，走的就是模块级函数）
  useEffect(() => subscribeLocale((next) => setLocaleState(next)), []);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
    document.title = tKey('meta.title');
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => interpolate(messages[locale][key], vars),
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useI18n must be used within LocaleProvider');
  return ctx;
}