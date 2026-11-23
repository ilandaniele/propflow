import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

export async function BookingSummary({ label, guestCount, comment }: {
  label: ReactNode;
  guestCount: number | null;
  comment: string | null;
}) {
  const t = await getTranslations('amenities');

  return (
    <span className="flex flex-col">
      <span>{label}{guestCount !== null && <> · {t('guests', { count: guestCount })}</>}</span>
      {comment && <span className="text-xs text-slate-500 break-words">{comment}</span>}
    </span>
  );
}
