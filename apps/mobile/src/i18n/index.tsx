import React, { createContext, useContext, useEffect, useState } from 'react';
import { meta } from '../db';

export type Lang = 'en' | 'ur';

/** Minimal string table. Urdu entries are placeholders pending professional translation. */
const STRINGS = {
  today: { en: 'Today', ur: 'آج' },
  orchards: { en: 'Orchards', ur: 'باغات' },
  spray: { en: 'Spray', ur: 'سپرے' },
  field: { en: 'Field', ur: 'کھیت' },
  more: { en: 'More', ur: 'مزید' },
  tasks: { en: 'Tasks', ur: 'کام' },
  login: { en: 'Log in', ur: 'لاگ ان' },
  signup: { en: 'Create account', ur: 'اکاؤنٹ بنائیں' },
  phone: { en: 'Phone', ur: 'فون' },
  password: { en: 'Password', ur: 'پاس ورڈ' },
  name: { en: 'Name', ur: 'نام' },
  save: { en: 'Save', ur: 'محفوظ کریں' },
  cancel: { en: 'Cancel', ur: 'منسوخ' },
  alerts: { en: 'Alerts', ur: 'انتباہات' },
  weather: { en: 'Weather', ur: 'موسم' },
  stage: { en: 'Stage', ur: 'مرحلہ' },
  scouting: { en: 'Scouting', ur: 'معائنہ' },
  harvest: { en: 'Harvest', ur: 'فصل کی کٹائی' },
  inventory: { en: 'Inventory', ur: 'ذخیرہ' },
  safety: { en: 'Safety', ur: 'حفاظت' },
  settings: { en: 'Settings', ur: 'ترتیبات' },
  tank: { en: 'Tank calculator', ur: 'ٹینک کیلکولیٹر' },
  logout: { en: 'Log out', ur: 'لاگ آؤٹ' },
  sync: { en: 'Sync now', ur: 'ہم آہنگ کریں' },
  blocks: { en: 'Blocks', ur: 'بلاک' },
  record: { en: 'Record', ur: 'درج کریں' },
  users: { en: 'Team', ur: 'ٹیم' },
} as const;

export type StrKey = keyof typeof STRINGS;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: StrKey) => string }>({
  lang: 'en',
  setLang: () => {},
  t: (k) => STRINGS[k].en,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  useEffect(() => {
    void meta.get<Lang>('lang').then((l) => l && setLangState(l));
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    void meta.set('lang', l);
  };
  return <Ctx.Provider value={{ lang, setLang, t: (k) => STRINGS[k][lang] }}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);
