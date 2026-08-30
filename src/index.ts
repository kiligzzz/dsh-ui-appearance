/**
 * Host registration for the appearance plugin.
 *
 * Two responsibilities:
 * 1. No-op host body: settings persist in browser localStorage (the harness
 *    settings gateway exposes only its hard-coded product namespaces to
 *    browser clients, so a third-party settings namespace cannot be written
 *    through the settings RPC).
 * 2. Composer-effect bootstrap (migrated from dsh-glass-composer): injects a
 *    tiny inline script right after <body> that reads the three composer
 *    toggles from localStorage and flips their body attributes BEFORE the web
 *    shell mounts, so the effects never flash the wrong style on reload.
 *    The client half keeps the same localStorage keys and attribute names.
 */
import type { Context } from '@deepseek-ai/cordis'

export {
  APPEARANCE_SETTINGS_NAMESPACE, APPEARANCE_ROLES, DEFAULT_SETTINGS,
  type AppearanceRole, type AppearanceSettings,
} from './appearance-settings.ts'

/** localStorage keys (kept from dsh-glass-composer so existing preferences survive). */
export const COMPOSER_KEYS = {
  aistudio: 'dsh.aistudioComposer',
  glass: 'dsh.glassComposer',
  glow: 'dsh.glowComposer',
} as const

/** Body attributes the client half gates its composer-effect CSS on. */
export const COMPOSER_ATTRS = {
  aistudio: 'data-dsh-aistudio-composer',
  glass: 'data-dsh-glass-composer',
  glow: 'data-dsh-glow-composer',
} as const

/** Defaults mirroring the client settings (aistudio ON, glass OFF, glow ON). */
export const COMPOSER_DEFAULTS = {
  aistudio: '1',
  glass: '0',
  glow: '1',
} as const

/** localStorage key holding the whole appearance section (mirrors client). */
const STORAGE_KEY = 'dsh-ui-appearance.settings'

/**
 * Composer-effect bootstrap script. Reads the appearance section from
 * localStorage (single source of truth after the dsh-glass-composer merge)
 * and flips the three body attributes BEFORE the web shell mounts, so the
 * effects never flash the wrong composer style on reload. Each field
 * resolves: merged section boolean → legacy per-key ('1'/'0') → default.
 */
function bootstrapScript(): string {
  const lines = (['aistudio', 'glass', 'glow'] as const).map((fx) => {
    const key = COMPOSER_KEYS[fx]
    const attr = COMPOSER_ATTRS[fx]
    const field = `${fx}Composer`
    const fallback = COMPOSER_DEFAULTS[fx]
    const expr =
      `(()=>{try{const s=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"null");` +
      `if(s&&typeof s[${JSON.stringify(field)}]==="boolean")return s[${JSON.stringify(field)}]}catch(e){}` +
      `const v=localStorage.getItem(${JSON.stringify(key)});return v===null?${fallback}:v==="1"})()`
    return `document.body.toggleAttribute(${JSON.stringify(attr)},${expr})`
  })
  return `<script>${lines.join(';')}<\/script>`
}

function tapIndex(html: string): string {
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  const script = bootstrapScript()
  if (body === null) return `${html}${script}`
  const at = body.index + body[0].length
  return `${html.slice(0, at)}${script}${html.slice(at)}`
}

/**
 * Host-side work: compose the composer-effect bootstrap into the served index.
 * Everything else runs in the browser half.
 * @param ctx - Host context; may acquire the webServer service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(tapIndex),
      'ui-appearance: composer-fx bootstrap',
    )
  })
}
