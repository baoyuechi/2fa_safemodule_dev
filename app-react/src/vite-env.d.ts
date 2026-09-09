/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 项目 base URL（本地默认 127.0.0.1:54321，生产指向托管项目） */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon / publishable key */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Cloudflare Turnstile site key（前端公开值；本地默认 CF 测试 key） */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
