import dayjs from 'dayjs'
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
// English is the fallback language and is the only locale bundled into the
// initial chunk, so first paint is always fully translated with no extra
// network/parse cost. Every other locale is a dynamic import() below — Vite
// emits one chunk per language, fetched only when that language is selected.
import en from './locales/en'

type LocaleModule = { default: { translation: Record<string, unknown> } }

// Lazy loaders for every non-English locale. Keep this in sync with the names
// map below and with the locale files in ./locales.
const lazyLocales: Record<string, () => Promise<LocaleModule>> = {
  ar: () => import('./locales/ar'),
  de: () => import('./locales/de'),
  es: () => import('./locales/es'),
  fa: () => import('./locales/fa'),
  fr: () => import('./locales/fr'),
  hi: () => import('./locales/hi'),
  hu: () => import('./locales/hu'),
  it: () => import('./locales/it'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
  pl: () => import('./locales/pl'),
  'pt-BR': () => import('./locales/pt-BR'),
  'pt-PT': () => import('./locales/pt-PT'),
  ru: () => import('./locales/ru'),
  th: () => import('./locales/th'),
  tr: () => import('./locales/tr'),
  zh: () => import('./locales/zh'),
  'zh-TW': () => import('./locales/zh-TW')
}

// Display names are static strings (no locale payload), so they stay in the
// initial bundle — the language picker needs them all up front.
const languageNames = {
  ar: 'العربية',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fa: 'فارسی',
  fr: 'Français',
  hi: 'हिन्दी',
  hu: 'Magyar',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  pl: 'Polski',
  'pt-BR': 'Português (Brasil)',
  'pt-PT': 'Português (Portugal)',
  ru: 'Русский',
  th: 'ไทย',
  tr: 'Türkçe',
  zh: '简体中文',
  'zh-TW': '繁體中文'
} as const

export type TLanguage = keyof typeof languageNames
export const LocalizedLanguageNames: { [key in TLanguage]?: string } = { ...languageNames }
const supportedLanguages = Object.keys(languageNames) as TLanguage[]

const RTL_LANGUAGES: readonly TLanguage[] = ['ar', 'fa']

export function isRTL(lang: string | undefined | null): boolean {
  if (!lang) return false
  const base = lang.split('-')[0]
  return (RTL_LANGUAGES as readonly string[]).includes(base)
}

function applyDocumentDirection(lang: string | undefined) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dir = isRTL(lang) ? 'rtl' : 'ltr'
  if (lang) root.lang = lang
}

const loadedLanguages = new Set<string>(['en'])

/**
 * Ensures the resource bundle for `lang` is loaded into i18next. No-op for
 * English (always present) or already-loaded languages. Fetches the locale's
 * dynamic chunk on first use and registers it.
 */
export async function loadLanguage(lang: string | undefined | null): Promise<void> {
  if (!lang || loadedLanguages.has(lang)) return
  const loader = lazyLocales[lang]
  if (!loader) return
  const mod = await loader()
  i18n.addResourceBundle(lang, 'translation', mod.default.translation, true, true)
  loadedLanguages.add(lang)
}

/**
 * Switches the active UI language, loading its lazy chunk first so the new
 * strings are present before React re-renders (no flash of fallback English).
 */
export async function setLanguage(lang: string): Promise<void> {
  await loadLanguage(lang)
  await i18n.changeLanguage(lang)
}

/**
 * Resolves once i18next is initialised AND the detected language's resource
 * bundle is loaded. main.tsx awaits this before the first render so non-English
 * users never see a flash of untranslated keys.
 */
export const i18nReady: Promise<void> = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    resources: { en },
    interpolation: {
      escapeValue: false // react already safes from xss
    },
    detection: {
      convertDetectedLanguage: (lng) => {
        console.log('Detected language:', lng)
        if (lng.startsWith('zh')) {
          return ['zh', 'zh-CN', 'zh-SG'].includes(lng) ? 'zh' : 'zh-TW'
        }
        const supported = supportedLanguages.find((supported) => lng.startsWith(supported))
        return supported || 'en'
      }
    }
  })
  .then(async () => {
    // i18n.language is the (normalised) detected language even when its bundle
    // isn't loaded yet; load it before applying direction so the first paint is
    // in the right language.
    await loadLanguage(i18n.language)
    applyDocumentDirection(i18n.resolvedLanguage ?? i18n.language)
  })

// Defensive: if anything switches language directly via i18n.changeLanguage
// (bypassing setLanguage), still fetch the bundle so strings resolve.
i18n.on('languageChanged', (lang) => {
  void loadLanguage(lang)
  applyDocumentDirection(lang)
})

i18n.services.formatter?.add('date', (timestamp, lng) => {
  switch (lng) {
    case 'zh':
    case 'zh-TW':
    case 'ja':
      return dayjs(timestamp).format('YYYY年MM月DD日')
    case 'pl':
    case 'de':
    case 'ru':
    case 'tr':
      return dayjs(timestamp).format('DD.MM.YYYY')
    case 'fa':
    case 'hu':
      return dayjs(timestamp).format('YYYY/MM/DD')
    case 'it':
    case 'es':
    case 'fr':
    case 'pt-BR':
    case 'pt-PT':
    case 'ar':
    case 'hi':
    case 'th':
      return dayjs(timestamp).format('DD/MM/YYYY')
    case 'ko':
      return dayjs(timestamp).format('YYYY년 MM월 DD일')
    default:
      return dayjs(timestamp).format('MMM D, YYYY')
  }
})

i18n.services.formatter?.add('date_short', (timestamp, lng) => {
  switch (lng) {
    case 'zh':
    case 'zh-TW':
    case 'ja':
      return dayjs(timestamp).format('MM月DD日')
    case 'pl':
    case 'de':
    case 'ru':
    case 'tr':
      return dayjs(timestamp).format('DD.MM')
    case 'fa':
    case 'hu':
      return dayjs(timestamp).format('MM/DD')
    case 'it':
    case 'es':
    case 'fr':
    case 'pt-BR':
    case 'pt-PT':
    case 'ar':
    case 'hi':
    case 'th':
      return dayjs(timestamp).format('DD/MM')
    case 'ko':
      return dayjs(timestamp).format('MM월 DD일')
    default:
      return dayjs(timestamp).format('MMM D')
  }
})

export default i18n
