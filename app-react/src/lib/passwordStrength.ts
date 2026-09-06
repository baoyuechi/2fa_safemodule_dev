/**
 * 密码强度打分（zxcvbn-ts）。
 * 三包体积大，全部动态 import：首次打分时才加载（Vite 拆独立 chunk，不进主包）。
 * 每个 locale 缓存一个 ZxcvbnFactory 实例；语言切换时按需再建（建议文案随 locale）。
 */
import type { Locale } from '../i18n/messages';
import { zxcvbnTranslationsZh } from '../i18n/zxcvbnTranslations';

export interface PasswordStrengthResult {
  /** 0 很弱 → 4 很强（zxcvbn 标准五档） */
  score: number;
  warning: string | null;
  suggestions: string[];
}

interface ZxcvbnFactoryLike {
  check(
    password: string,
    userInputs?: (string | number)[],
  ): { score: number; feedback: { warning: string; suggestions: string[] } };
}

const factories = new Map<Locale, ZxcvbnFactoryLike>();
let loadingPromise: Promise<ZxcvbnFactoryLike> | null = null;
let pendingLocale: Locale | null = null;

async function loadZxcvbn(locale: Locale): Promise<ZxcvbnFactoryLike> {
  const cached = factories.get(locale);
  if (cached) return cached;
  if (loadingPromise && pendingLocale === locale) return loadingPromise;
  pendingLocale = locale;
  loadingPromise = (async () => {
    const [{ ZxcvbnFactory }, common, en] = await Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
    ]);
    const factory = new ZxcvbnFactory({
      translations: locale === 'zh' ? zxcvbnTranslationsZh : en.translations,
      graphs: common.adjacencyGraphs,
      dictionary: { ...common.dictionary, ...en.dictionary },
    }) as unknown as ZxcvbnFactoryLike;
    factories.set(locale, factory);
    return factory;
  })();
  return loadingPromise;
}

/** 异步打分（供强度条实时展示；内部已确保 zxcvbn 加载完成） */
export async function scorePassword(
  password: string,
  locale: Locale,
  userInputs: (string | number)[] = [],
): Promise<PasswordStrengthResult | null> {
  if (!password) return null;
  const factory = await loadZxcvbn(locale);
  const res = factory.check(password, userInputs);
  return { score: res.score, warning: res.feedback.warning || null, suggestions: res.feedback.suggestions };
}

/** 同步打分（供提交门槛取最新值，无防抖竞态）；库未加载完返回 null */
export function scorePasswordSync(
  password: string,
  locale: Locale,
  userInputs: (string | number)[] = [],
): number | null {
  const factory = factories.get(locale);
  if (!factory || !password) return null;
  return factory.check(password, userInputs).score;
}
