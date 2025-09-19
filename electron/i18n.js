(function () {
  const translations = {
    en: {},
    zh: {}
  };

  const languageAliases = {
    en: 'en',
    'en-us': 'en',
    english: 'en',
    zh: 'zh',
    'zh-cn': 'zh',
    'zh-hans': 'zh',
    'zh-sg': 'zh',
    chinese: 'zh'
  };

  const defaultLanguage = 'en';
  let currentLanguage = defaultLanguage;
  const listeners = new Set();

  function normalizeLanguage(input) {
    if (!input) return defaultLanguage;
    const lower = String(input).trim().toLowerCase();
    return languageAliases[lower] || (translations[lower] ? lower : defaultLanguage);
  }

  function camelToKebab(value) {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/_/g, '-')
      .toLowerCase();
  }

  function applyValue(element, key, mode) {
    const text = t(key);
    switch (mode) {
      case 'html':
        element.innerHTML = text;
        break;
      case 'text':
      default:
        element.textContent = text;
        break;
    }
  }

  function applyTranslations(root = document) {
    if (!root || !root.querySelectorAll) return;

    const elements = root.querySelectorAll('[data-i18n]');
    elements.forEach((el) => {
      const key = el.dataset.i18n;
      const mode = el.dataset.i18nMode || 'text';
      if (key) {
        applyValue(el, key, mode);
      }
    });

    const attrElements = root.querySelectorAll('[data-i18n-title], [data-i18n-placeholder], [data-i18n-ariaLabel], [data-i18n-tooltip]');
    attrElements.forEach((el) => {
      Object.keys(el.dataset).forEach((datasetKey) => {
        if (!datasetKey.startsWith('i18n') || datasetKey === 'i18n' || datasetKey === 'i18nMode') {
          return;
        }
        const value = el.dataset[datasetKey];
        if (!value) return;
        const attrName = camelToKebab(datasetKey.slice(4));
        if (!attrName) return;
        if (attrName === 'html') {
          el.innerHTML = t(value);
        } else if (attrName === 'text') {
          el.textContent = t(value);
        } else {
          el.setAttribute(attrName, t(value));
        }
      });
    });
  }

  function updateDocumentLanguage() {
    const lang = currentLanguage === 'zh' ? 'zh-CN' : 'en';
    if (document && document.documentElement) {
      document.documentElement.lang = lang;
    }
  }

  function setLanguage(lang) {
    const normalized = normalizeLanguage(lang);
    const changed = normalized !== currentLanguage;
    currentLanguage = normalized;
    updateDocumentLanguage();
    applyTranslations();
    if (changed) {
      listeners.forEach((listener) => {
        try {
          listener(currentLanguage);
        } catch (error) {
          console.warn('[i18n] listener error:', error);
        }
      });
    }
    return currentLanguage;
  }

  function getLanguage() {
    return currentLanguage;
  }

  function t(key) {
    if (!key) return '';
    const langTable = translations[currentLanguage] || {};
    if (Object.prototype.hasOwnProperty.call(langTable, key)) {
      return langTable[key];
    }
    const fallbackTable = translations[defaultLanguage] || {};
    if (Object.prototype.hasOwnProperty.call(fallbackTable, key)) {
      return fallbackTable[key];
    }
    return key;
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function extend(newTranslations) {
    if (!newTranslations || typeof newTranslations !== 'object') return;
    Object.entries(newTranslations).forEach(([lang, table]) => {
      if (!translations[lang]) {
        translations[lang] = {};
      }
      Object.assign(translations[lang], table);
    });
  }

  window.appI18n = {
    setLanguage,
    getLanguage,
    t,
    onChange,
    apply: applyTranslations,
    extend,
    translations
  };
})();
