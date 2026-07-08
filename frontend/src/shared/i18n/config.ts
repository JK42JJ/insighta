import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ko from './locales/ko.json';
import en from './locales/en.json';

// Visitors physically in Korea default to Korean even if their device UI
// language is English — timezone is a reliable proxy for location. A user's
// explicit choice (localStorage) still wins because it is checked first.
const languageDetector = new LanguageDetector();
languageDetector.addDetector({
  name: 'koreaTimezone',
  lookup() {
    try {
      if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Seoul') return 'ko';
    } catch {
      /* Intl unavailable — fall through to navigator */
    }
    return undefined;
  },
});

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'koreaTimezone', 'navigator'],
      lookupLocalStorage: 'i18n-language',
      caches: ['localStorage'],
    },
  });

export default i18n;
