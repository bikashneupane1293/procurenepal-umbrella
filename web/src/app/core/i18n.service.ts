import { Injectable, signal } from '@angular/core';

/**
 * Nepali / English toggle — a foundation, not full translation. It covers the sidebar module
 * names and the most common screen chrome (Dashboard, Logout, Save, Cancel…). ERP field labels,
 * form help text and reports stay in English for now: getting specialised procurement / construction
 * terms wrong in Nepali would mislead more than help, so those are left for Bikash to review and
 * extend here rather than guessed. © Cuidado Technology Pvt. Ltd.
 */
export type Lang = 'en' | 'ne';
const KEY = 'pn.lang';

const DICT: Record<string, { en: string; ne: string }> = {
  dashboard: { en: 'Dashboard', ne: 'ड्यासबोर्ड' },
  logout: { en: 'Logout', ne: 'लग आउट' },
  save: { en: 'Save', ne: 'सुरक्षित गर्नुहोस्' },
  cancel: { en: 'Cancel', ne: 'रद्द गर्नुहोस्' },
  loading: { en: 'Loading…', ne: 'लोड हुँदैछ…' },
  'mod.companies': { en: 'Companies', ne: 'कम्पनीहरू' },
  'mod.bolpatra': { en: 'Bolpatra eGP System', ne: 'बोलपत्र ई-जिपी प्रणाली' },
  'mod.procurement': { en: 'Procurement & Inventory', ne: 'खरिद तथा मौज्दात व्यवस्थापन' },
  'mod.fleet': { en: 'Vehicle & Fleet', ne: 'सवारी तथा फ्लिट व्यवस्थापन' },
  'mod.hr': { en: 'HR and Operations', ne: 'मानव संसाधन तथा सञ्चालन' },
  'mod.project': { en: 'Project Management', ne: 'आयोजना व्यवस्थापन' },
  'mod.bank': { en: 'Bank System', ne: 'बैंक प्रणाली' },
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  lang = signal<Lang>(this.read());

  private read(): Lang {
    try { return (localStorage.getItem(KEY) as Lang) === 'ne' ? 'ne' : 'en'; } catch { return 'en'; }
  }

  toggle() {
    const next: Lang = this.lang() === 'en' ? 'ne' : 'en';
    this.lang.set(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
  }

  /** Translated text for a known chrome key, or the key itself (so a missing translation never breaks the UI). */
  t(key: string): string {
    return DICT[key]?.[this.lang()] ?? key;
  }

  /** A module's sidebar label by its registry key ('companies', 'bolpatra', …), or its English label if not yet in the dictionary. */
  modLabel(moduleKey: string, englishLabel: string): string {
    return DICT['mod.' + moduleKey]?.[this.lang()] ?? englishLabel;
  }
}
