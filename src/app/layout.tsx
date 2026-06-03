import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, isValidLocale, LOCALE_COOKIE } from '@/i18n/config';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'PropFlow', template: '%s | PropFlow' },
  description: 'Modern property & tenant management platform',
  robots: { index: false, follow: false }, // Private app — no indexing
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const nonce = headersList.get('x-nonce') ?? undefined;
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const lang = cookieLocale && isValidLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {nonce && (
          <meta name="csp-nonce" content={nonce} />
        )}
      </head>
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
