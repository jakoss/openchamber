import { describe, expect, test } from 'bun:test';
import { referencesSettingsI18n } from './references.settings.i18n';

describe('reference translations', () => {
  test('all locales carry the same nonempty keys and interpolation placeholders', () => {
    const english = Object.entries(referencesSettingsI18n.en);
    for (const dictionary of Object.values(referencesSettingsI18n)) {
      expect(Object.keys(dictionary).sort()).toEqual(english.map(([key]) => key).sort());
      const translated = new Map(Object.entries(dictionary));
      for (const [key, value] of english) {
        const translation = translated.get(key);
        expect(translation).toBeTruthy();
        expect(translation?.match(/\{\w+\}/g) ?? []).toEqual(value.match(/\{\w+\}/g) ?? []);
      }
    }
  });
});
