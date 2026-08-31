/**
 * DOM applier for appearance settings: owns one stylesheet and one fixed
 * background layer element. Forwards the active token overrides into
 * ctx.theme and exposes live CSS variables the stylesheet consumes. Every
 * write is retracted on dispose, so disabling the plugin restores the stock
 * UI exactly.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.theme Context merge (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AppearanceSettings } from '../appearance-settings.ts'
import { DEFAULT_SETTINGS } from '../appearance-settings.ts'
import { buildTokenOverrides, OVERRIDE_SOURCE } from './tokens.ts'
import { getImage } from './image-store.ts'
import { getVideo } from './video-store.ts'

/** Background layer element id (the stylesheet targets it). */
export const BG_LAYER_ID = 'dsw-appearance-bg'
/** Stylesheet element id owned by this plugin. */
export const STYLE_ID = 'dsw-appearance-styles'

/** Composer-effect body attributes (mirrors the host half's constants). */
export const COMPOSER_ATTRS = {
  aistudio: 'data-dsh-aistudio-composer',
  glass: 'data-dsh-glass-composer',
  glow: 'data-dsh-glow-composer',
} as const

/** CSS variables the applier writes on body, consumed by the stylesheet. */
const BODY_VARIABLES = [
  '--dsw-appearance-bg-image',
  '--dsw-appearance-bg-opacity',
  '--dsw-appearance-blur',
  '--dsw-appearance-scrim',
] as const

/**
 * Static sheet: the background layer is pushed to `z-index: -1` so it paints
 * below all content but above the body background — surfaces painted with
 * translucent tokens still show the image through, and no stacking context is
 * created on #root. `inset: -48px` gives the blur filter room so edges never
 * show transparent bleed.
 *
 * #root is deliberately left untouched: no `position`/`z-index`, no
 * `backdrop-filter`. A non-none backdrop-filter turns #root into the
 * containing block of every fixed-position descendant (menus, tooltips,
 * toasts), and any `z-index` traps those descendants in a stacking context
 * scoped to #root — whose own effective z then sits at the page level. Either
 * would let top-level third-party panels (e.g. dsh-better-sidebar's
 * `position: fixed; z-index: 40` panel) paint over the DSH settings dialog
 * (`position: fixed; z-index: 1000`, a descendant of #root). Pushing the
 * wallpaper layer to -1 instead of lifting #root keeps fixed overlays at the
 * top level, so the dialog always wins. Blurring the wallpaper directly is
 * visually equivalent here — the only thing behind #root is this layer — and
 * leaves fixed positioning alone.
 *
 * The readability scrim rides inside the layer's own background-image stack:
 * a uniform veil whose alpha is `var(--dsw-appearance-scrim)` — the browser
 * re-rasterizes the layer live as the slider moves, no JS wiring needed.
 * The veil hue follows the base theme (white-ish in light mode, near-black in
 * dark mode). Selection and focus rings follow the user's accent through the
 * overridden brand tokens.
 */
const SHEET = `
#${BG_LAYER_ID} {
  position: fixed;
  inset: -48px;
  z-index: -1;
  pointer-events: none;
  background-repeat: no-repeat;
  background-position: center;
  background-size: cover;
  background-image:
    linear-gradient(rgba(255, 255, 255, var(--dsw-appearance-scrim, 0)) 0%, rgba(255, 255, 255, var(--dsw-appearance-scrim, 0)) 100%),
    var(--dsw-appearance-bg-image, none);
  opacity: var(--dsw-appearance-bg-opacity, 1);
  filter: blur(var(--dsw-appearance-blur, 0px));
}
#${BG_LAYER_ID} video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: none;
}
#${BG_LAYER_ID}[data-video] video {
  display: block;
}
#${BG_LAYER_ID}[data-video] {
  background-image: none;
}
body[data-ds-dark-theme] #${BG_LAYER_ID} {
  background-image:
    linear-gradient(rgba(8, 10, 18, var(--dsw-appearance-scrim, 0)) 0%, rgba(8, 10, 18, var(--dsw-appearance-scrim, 0)) 100%),
    var(--dsw-appearance-bg-image, none);
}
#root ::selection {
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
#root :focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
/* Conversation-area glass: when the dedicated toggle is on, the Desktop shell
   columns (advanced/extended mode) drop their opaque fill so the wallpaper
   layer behind them shows through the chat. The readability veil stays in
   the wallpaper layer itself (--dsw-appearance-scrim); surfaces painted with
   translucent tokens (bubbles, composer, code) keep their own alpha from the
   surface/input/code sliders, so text stays readable while the area frosted. */
body[data-dsw-conversation-glass] .dshDesktopConversationSurface,
body[data-dsw-conversation-glass] .dshDesktopDetailsSurface {
  background: transparent !important;
}
body[data-dsw-conversation-glass] .dshDesktopFrame {
  background: transparent !important;
}
/* DSH Desktop shell squeeze fix: the shell's own stylesheet (injected as
   dsh-desktop-settings-styles) declares a full-width rule on html/body/#root
   AFTER dsh-better-sidebar's layout.css (bundle-injected, unstable order),
   so at equal specificity the shell wins and #root stays full-width: the
   better-sidebar margin-right only shifts the visual position and the right
   panel (an absolutely-positioned overlay, never a grid column) floats over
   the conversation (screenshot: overlapping text). !important beats the
   shell regardless of injection order. The grid is left untouched — Desktop
   keeps its own columns (third = its hidden Details column, 0px), and the
   narrowed #root shrinks the flexible 1fr conversation column, so the
   overlay panel gets its space without ever expanding the Details column. */
#root {
  width: calc(100% - var(--dsh-sidebar-width, 0px)) !important;
  margin-right: var(--dsh-sidebar-width, 0px) !important;
  box-sizing: border-box !important;
}
/* Frosted-glass overlays: translucent popovers (model picker menu, better-sidebar
   panel) and the composer input card let the wallpaper through but blur whatever
   sits underneath (chat text), so overlays stay see-through without text showing
   through confusingly. */
[role="menu"],
[role="listbox"] {
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
}
[data-dsh-panel-host] [class*="_panel"] {
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
}
[data-composer-card] {
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
}
/* Nested backdrop-filter conflict: the model menu renders INSIDE the composer
   card, and browsers discard a child's backdrop-filter when an ancestor
   already has one — the menu collapses to its 0.1-alpha background and looks
   fully transparent. While any menu/listbox is open inside the card, suspend
   the card's own blur so the menu's frosted glass applies again. */
[data-composer-card]:has([role="menu"], [role="listbox"]) {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
/* Composer effects (migrated from dsh-glass-composer). Each effect gates on a
   body attribute the host half pre-applies before mount and the applier keeps
   in sync with the settings section. */
[data-phase="hero"] [data-composer-card]{transition:background .3s ease,border-color .3s ease,box-shadow .3s ease}
body[data-dsh-glass-composer] [data-phase="hero"] [data-composer-card]{background:rgba(255,255,255,.45);-webkit-backdrop-filter:blur(28px) saturate(1.8);backdrop-filter:blur(28px) saturate(1.8);border:1px solid rgba(255,255,255,.65);box-shadow:0 12px 40px rgba(70,90,180,.14),inset 0 1px 0 rgba(255,255,255,.85),inset 0 -1px 0 rgba(255,255,255,.28)}
body[data-ds-dark-theme][data-dsh-glass-composer] [data-phase="hero"] [data-composer-card]{background:rgba(26,28,36,.42);border:1px solid rgba(255,255,255,.16);box-shadow:0 14px 48px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.15),inset 0 -1px 0 rgba(255,255,255,.05)}
@property --dshGlowAngle{syntax:"<angle>";initial-value:0deg;inherits:false}
[data-composer-card]{transition:border-color .25s ease}
body[data-dsh-glow-composer] [data-composer-card][data-composer-running]{border-color:transparent}
body[data-dsh-glow-composer] [data-composer-card][data-composer-running]:before,
body[data-dsh-glow-composer] [data-composer-card][data-composer-running]:after{content:"";position:absolute;pointer-events:none;border-radius:24px;background:conic-gradient(from var(--dshGlowAngle),transparent 0deg 240deg,#4D6BFE 275deg,#9E4DFF 310deg,#00C2D8 335deg,#FF5CA8 350deg,transparent 360deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}
body[data-dsh-glow-composer] [data-composer-card][data-composer-running]:before{inset:-1.5px;padding:1.5px}
body[data-dsh-glow-composer] [data-composer-card][data-composer-running]:after{inset:-4px;padding:4px;filter:blur(4px);opacity:.4}
@media (prefers-reduced-motion:no-preference){body[data-dsh-glow-composer] [data-composer-card][data-composer-running]:before,body[data-dsh-glow-composer] [data-composer-card][data-composer-running]:after{animation:dshGlowSpin 3.2s linear infinite}}
@keyframes dshGlowSpin{to{--dshGlowAngle:360deg}}
@property --dshAuroraAngle{syntax:"<angle>";initial-value:0deg;inherits:false}
body[data-dsh-aistudio-composer] [data-phase="hero"] [data-composer-card]{border-color:transparent}
body[data-dsh-aistudio-composer] [data-phase="hero"] [data-composer-card]:before{content:"";position:absolute;pointer-events:none;inset:-2px;padding:2px;border-radius:24px;opacity:.9;background:conic-gradient(from var(--dshAuroraAngle),#4285F4 0deg,#A142F4 90deg,#FF5CA8 160deg,#F9AB00 235deg,#00C2D8 300deg,#4285F4 360deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}
body[data-dsh-aistudio-composer] [data-phase="hero"] [data-composer-card]:after{content:"";position:absolute;pointer-events:none;inset:-70px;border-radius:92px;background:conic-gradient(from var(--dshAuroraAngle),#4285F4 0deg,#A142F4 90deg,#FF5CA8 160deg,#F9AB00 235deg,#00C2D8 300deg,#4285F4 360deg);filter:blur(40px) saturate(1.2);opacity:.2;z-index:-1}
body[data-dsh-aistudio-composer] [data-phase="hero"] [data-composer-card]:hover:before{opacity:1;filter:saturate(1.2) brightness(1.08)}
@media (prefers-reduced-motion:no-preference){body[data-dsh-aistudio-composer] [data-phase="hero"] [data-composer-card]:before{animation:dshAuroraSpin 4s linear infinite}body[data-dsh-aistudio-composer] [data-phase="hero"] [data-composer-card]:after{animation:dshAuroraSpin 10s linear infinite}}
@keyframes dshAuroraSpin{to{--dshAuroraAngle:360deg}}
`

/**
 * Projects one appearance settings snapshot onto the document. Replaces the
 * token override layer on every apply; retracts everything in dispose.
 */
export class AppearanceApplier {
  private readonly style: HTMLStyleElement
  private readonly layer: HTMLDivElement
  private videoEl: HTMLVideoElement | undefined
  private videoUrl: string | undefined
  private videoKey = ''
  private imageToken = ''
  private imageUrl: string | undefined
  private removeOverrides: (() => void) | undefined
  private runningObserver: MutationObserver | undefined

  /**
   * @param ctx - client context providing the theme service.
   */
  constructor(private readonly ctx: ClientContext) {
    this.style = document.createElement('style')
    this.style.id = STYLE_ID
    this.style.textContent = SHEET
    document.head.append(this.style)
    this.layer = document.createElement('div')
    this.layer.id = BG_LAYER_ID
    document.body.prepend(this.layer)
    this.observeRunning()
  }

  /**
   * Apply a settings snapshot: rebuild the theme override layer and refresh
   * the body CSS variables. Undefined values (settings not yet loaded) apply
   * the stock defaults, which removes the override layer.
   * @param settings - current appearance settings or undefined while loading.
   */
  apply(settings: AppearanceSettings | undefined): void {
    const value = settings ?? DEFAULT_SETTINGS
    this.removeOverrides?.()
    this.removeOverrides = undefined
    const tokens = buildTokenOverrides(value)
    if (Object.keys(tokens).length > 0) {
      this.removeOverrides = this.ctx.theme.overrideTokens(OVERRIDE_SOURCE, tokens)
    }
    const body = document.body
    // The wallpaper rides a CSS variable like every other knob; the value is
    // a record key (or legacy inline data URL) and resolves asynchronously.
    void this.syncImage(value.backgroundImage)
    body.style.setProperty('--dsw-appearance-bg-opacity', String(value.backgroundOpacity))
    // 背景模糊 and 毛玻璃 ride the same wallpaper-layer filter: dragging either
    // slider deepens the blur of the wallpaper that the translucent surfaces
    // reveal. The panels themselves are never touched.
    body.style.setProperty(
      '--dsw-appearance-blur',
      `${value.backgroundBlur + value.glassBlur}px`,
    )
    // 毛玻璃 also drives the host's modal masks: dialogs/dropdowns dim the page
    // through `.mask` elements whose backdrop-filter is `var(--dsw-mask-blur)`
    // (stock: blur(2px)). Writing the token on body wins over the host's
    // stylesheet definitions (body is the closer ancestor), so whatever a mask
    // covers — text included — frosts with the slider. The slider owns the
    // token across its whole range: 0 means blur(0px) (fully clear), NOT the
    // stock 2px. dispose() removes the write so uninstall restores stock.
    body.style.setProperty('--dsw-mask-blur', `blur(${value.glassBlur}px)`)
    body.style.setProperty('--dsw-appearance-scrim', String(value.scrim))
    // Conversation-area glass: the toggle flips a body marker the stylesheet
    // keys on (surfaces go transparent only when enabled), and its own blur
    // rides the same wallpaper-layer filter as the background blur.
    if (value.conversationGlass) {
      body.dataset.dswConversationGlass = ''
      body.style.setProperty(
        '--dsw-appearance-blur',
        `${value.backgroundBlur + value.glassBlur + value.conversationGlassBlur}px`,
      )
    } else {
      delete body.dataset.dswConversationGlass
      body.style.setProperty(
        '--dsw-appearance-blur',
        `${value.backgroundBlur + value.glassBlur}px`,
      )
    }
    // A background video (IndexedDB record key) replaces the image layer;
    // loading is async and only re-runs when the key changes.
    void this.syncVideo(value.backgroundVideo)
    // Composer effects (migrated from dsh-glass-composer): each toggle maps
    // to a body attribute the composer-effect stylesheet gates on. The host
    // half pre-applies the same attributes from localStorage before mount so
    // reloads never flash the wrong composer style; this keeps them in sync
    // with the settings section live.
    body.toggleAttribute(COMPOSER_ATTRS.aistudio, value.aistudioComposer)
    body.toggleAttribute(COMPOSER_ATTRS.glass, value.glassComposer)
    body.toggleAttribute(COMPOSER_ATTRS.glow, value.glowComposer)
  }

  /**
   * Load or clear the wallpaper for a background token. Legacy records still
   * carry an inline data URL (applied directly); current records hold an
   * IndexedDB key resolved through an object URL. Reuses the object URL when
   * the token is unchanged, so repeated applies never re-read IndexedDB.
   * @param token - record key, legacy data URL, or '' to clear.
   */
  private async syncImage(token: string): Promise<void> {
    if (token === this.imageToken) return
    this.imageToken = token
    this.teardownImage()
    const body = document.body
    if (token === '') {
      body.style.setProperty('--dsw-appearance-bg-image', 'none')
      return
    }
    if (token.startsWith('data:')) {
      body.style.setProperty('--dsw-appearance-bg-image', `url("${token}")`)
      return
    }
    const blob = await getImage(token)
    if (this.imageToken !== token) {
      // Superseded by a newer apply; the newer syncImage owns the variable.
      return
    }
    if (blob === undefined) {
      // Deleted while loading: fall back to no wallpaper.
      this.imageToken = ''
      body.style.setProperty('--dsw-appearance-bg-image', 'none')
      return
    }
    this.imageUrl = URL.createObjectURL(blob)
    body.style.setProperty('--dsw-appearance-bg-image', `url("${this.imageUrl}")`)
  }

  /** Revoke the wallpaper object URL, if any. */
  private teardownImage(): void {
    if (this.imageUrl !== undefined) {
      URL.revokeObjectURL(this.imageUrl)
      this.imageUrl = undefined
    }
  }

  /**
   * Load or clear the background video for a record key. Reuses the element
   * and object URL when the key is unchanged, so repeated applies never
   * re-read IndexedDB.
   * @param key - video record key, or '' to clear.
   */
  private async syncVideo(key: string): Promise<void> {
    if (key === this.videoKey) return
    this.videoKey = key
    this.teardownVideo()
    if (key === '') {
      this.layer.removeAttribute('data-video')
      return
    }
    const record = await getVideo(key)
    if (record === undefined || this.videoKey !== key) {
      // Deleted while loading, or superseded by a newer apply.
      this.videoKey = ''
      this.layer.removeAttribute('data-video')
      return
    }
    const video = this.ensureVideo()
    this.videoUrl = URL.createObjectURL(record)
    video.src = this.videoUrl
    video.play().catch(() => {
      // Autoplay policy or unsupported codec: keep the layer fallback silent.
    })
    // Unsupported codec (e.g. HEVC in an mp4): drop the video layer so the
    // wallpaper fallback (if any) shows instead of a black frame.
    video.onerror = (): void => {
      this.videoKey = ''
      this.layer.removeAttribute('data-video')
      this.teardownVideo()
    }
    this.layer.setAttribute('data-video', '')
  }

  /** Create the background video element once. */
  private ensureVideo(): HTMLVideoElement {
    if (this.videoEl === undefined) {
      const video = document.createElement('video')
      video.muted = true
      video.loop = true
      video.playsInline = true
      video.autoplay = true
      this.layer.append(video)
      this.videoEl = video
    }
    return this.videoEl
  }

  /** Remove the video element and revoke its object URL. */
  private teardownVideo(): void {
    this.videoEl?.remove()
    this.videoEl = undefined
    if (this.videoUrl !== undefined) {
      URL.revokeObjectURL(this.videoUrl)
      this.videoUrl = undefined
    }
  }

  /**
   * Composer running-state mirror (migrated from dsh-glass-composer): the
   * glow ring needs to know when the agent is running. The harness exposes no
   * DOM signal on the composer card, so the running state is inferred from
   * the primary button's stop-vs-send icon shape (svg > rect 10x10 = stop)
   * and mirrored onto [data-composer-card] as data-composer-running. A
   * MutationObserver reschedules a throttled scan on any DOM change; the CSS
   * gates the ring on body[data-dsh-glow-composer] so the observer runs even
   * when the effect is off (cheap, keeps the signal fresh for instant toggle).
   */
  private observeRunning(): void {
    const root = document.documentElement ?? document.body
    if (!root || typeof MutationObserver === 'undefined') return
    const schedule = (): void => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => this.scanRunning())
      else setTimeout(() => this.scanRunning(), 120)
    }
    this.runningObserver = new MutationObserver(schedule)
    this.runningObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-composer-running'],
    })
    schedule()
  }

  private scanRunning(): void {
    const cards = document.querySelectorAll<HTMLElement>('[data-composer-card]')
    for (let i = 0; i < cards.length; i++) this.syncRunning(cards[i])
  }

  private syncRunning(card: HTMLElement): void {
    let running = false
    const buttons = card.querySelectorAll('button[type="button"]')
    for (let i = 0; i < buttons.length; i++) {
      const svg = buttons[i].querySelector('svg')
      if (svg !== null && svg.querySelector('rect[width="10"][height="10"]') !== null) {
        running = true
        break
      }
    }
    if (running) card.setAttribute('data-composer-running', '')
    else card.removeAttribute('data-composer-running')
  }

  /** Retract the override layer, the stylesheet, the layer element, and body variables. */
  dispose(): void {
    this.removeOverrides?.()
    this.removeOverrides = undefined
    this.runningObserver?.disconnect()
    this.runningObserver = undefined
    // Drop the keys BEFORE tearing down: a getVideo()/getImage() still in
    // flight resolves after dispose, and the key comparison is what stops it
    // from recreating media on the removed layer.
    this.videoKey = ''
    this.teardownVideo()
    this.imageToken = ''
    this.teardownImage()
    this.style.remove()
    this.layer.remove()
    const body = document.body
    for (const name of BODY_VARIABLES) body.style.removeProperty(name)
    body.style.removeProperty('--dsw-mask-blur')
    delete body.dataset.dswConversationGlass
    // Retract the composer-effect body attributes (the stylesheet gates on them).
    for (const attr of Object.values(COMPOSER_ATTRS)) body.removeAttribute(attr)
  }
}
