import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { DEFAULT_LOCALE, isValidLocale, LOCALE_COOKIE } from '@/i18n/config';
import { THEME_COLOR } from '@/lib/pwa/manifest';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'PropFlow', template: '%s | PropFlow' },
  description: 'Modern property & tenant management platform',
  robots: { index: false, follow: false }, // Private app — no indexing
  appleWebApp: { capable: true, title: 'PropFlow', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: THEME_COLOR };

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
        <link rel="manifest" href="/api/app/manifest" crossOrigin="use-credentials" />
        {nonce && (
          <meta name="csp-nonce" content={nonce} />
        )}
      </head>
      <body className="min-h-full flex flex-col">
        {/* NextIntlClientProvider (server version) passes locale + messages to
            'use client' components (e.g. PricingTable, PricingToggle) so that
            useTranslations() works without crashing during SSR. In RSC context
            this automatically fetches locale/messages from getRequestConfig(). */}
        <NextIntlClientProvider>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
