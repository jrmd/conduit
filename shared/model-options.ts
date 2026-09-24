import type { ModelOption, ProviderId } from './api';
export interface ModelVariant { id: string; effort: string; context: string; fast: boolean; }
export interface ModelFamily extends ModelOption { variants: ModelVariant[]; }
/** Only strip known trailing controls; never merge provider namespaces or model versions. */
export function modelFamilies(provider: ProviderId, options: ModelOption[]): ModelFamily[] {
  const families = new Map<string, ModelFamily>();
  for (const option of options) {
    let key = option.id, label = option.label;
    const variant: ModelVariant = { id: option.id, effort: '', context: '', fast: false };
    if (provider === 'cursor') {
      let match: RegExpMatchArray | null;
      while ((match = key.match(/-(none|minimal|low|medium|high|xhigh|max|ultra|thinking|fast|\d+[km])$/i))) {
        const value = match[1].toLowerCase();
        if (value === 'fast') variant.fast = true;
        else if (/^\d+[km]$/.test(value)) variant.context = value;
        else variant.effort = value;
        key = key.slice(0, -match[0].length);
      }
      label = label.replace(/(?:[\s(]+(?:none|minimal|low|medium|high|xhigh|max|ultra|thinking|fast|\d+[km])\)?)+$/i, '').trim();
    } else if (provider === 'claude') {
      const match = key.match(/\[(\d+[km])\]$/i);
      if (match) { variant.context = match[1].toLowerCase(); key = key.slice(0, -match[0].length); }
    }
    const family = families.get(key);
    if (family) family.variants.push(variant);
    else families.set(key, {...option, label, variants: [variant]});
  }
  return [...families.values()];
}
export function familyForModel(families: ModelFamily[], id: string) {
  return families.find(family => family.variants.some(variant => variant.id === id));
}
