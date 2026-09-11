import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { translations, LANGUAGE_CODES, DEFAULT_LANGUAGE } from '@data/translations';
import { fontFamilyFor } from '@theme/fonts';
import { getString, setString } from '@storage/mmkv';

// Ported from the web LanguageContext, then extended for the language-consistency revamp.
//
// Behaviour preserved:
//   - `language` may be null, meaning "not yet chosen" — InitialLanguageModal keys off this
//     to decide whether to prompt on first launch.
//   - `t(key)` is a flat lookup with an English fallback, then the key itself as last resort.
//     No namespaces, no pluralisation. Deliberately NOT swapped for i18next.
//   - localStorage -> MMKV, read SYNCHRONOUSLY in the useState initializer (MMKV getString is
//     JSI-sync) so there is no first-launch flash and no bootstrap gate.
//
// Added for the revamp:
//   - `resolvedLanguage`: `language` with null coalesced to the default. Everything that just
//     needs "the language to render in" should read this instead of doing `language || 'en'`
//     inline (that pattern was copy-pasted across ~5 files, each a place a bug could creep in).
//   - `t(key, vars)`: optional {placeholder} interpolation, so strings like
//     "Register as {role}" localise the whole sentence instead of concatenating a translated
//     role onto a hardcoded English "Register as" (concatenation was a source of mixed-language
//     output).
//   - `fontFor(weight)`: the script-correct bundled font for the CURRENT language. Hindi and
//     Bengali need Noto Sans (Devanagari/Bengali); English needs Inter. Callers rendering t()
//     output should apply this so the glyphs shape correctly regardless of selected language.

const STORAGE_KEY = 'appLanguage';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    const saved = getString(STORAGE_KEY);
    // Guard against a stale/garbage stored value from older builds.
    return saved && LANGUAGE_CODES.includes(saved) ? saved : null;
  });

  const resolvedLanguage = language || DEFAULT_LANGUAGE;

  useEffect(() => {
    if (language) {
      setString(STORAGE_KEY, language);
    }
  }, [language]);

  // Validate on the way in so an unsupported code can never be persisted or rendered.
  const setLanguage = useCallback((code) => {
    if (LANGUAGE_CODES.includes(code)) {
      setLanguageState(code);
    }
  }, []);

  const t = useCallback(
    (key, vars) => {
      const lang = language || DEFAULT_LANGUAGE;
      let str = translations[lang]?.[key] ?? translations[DEFAULT_LANGUAGE][key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        }
      }
      return str;
    },
    [language],
  );

  const fontFor = useCallback(
    (weight = 'regular') => fontFamilyFor(resolvedLanguage, weight),
    [resolvedLanguage],
  );

  const value = useMemo(
    () => ({ language, resolvedLanguage, setLanguage, t, fontFor }),
    [language, resolvedLanguage, setLanguage, t, fontFor],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
