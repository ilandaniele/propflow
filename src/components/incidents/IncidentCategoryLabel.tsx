import { getTranslations } from 'next-intl/server';

export async function IncidentCategoryLabel({ category }: { category: string }) {
  const t = await getTranslations('incidents');
  const key = `categories.${category}`;
  return <>{t.has(key) ? t(key) : category}</>;
}
