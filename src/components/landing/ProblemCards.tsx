import { useTranslations } from 'next-intl';

// Icons for each problem card
function BlindSpotIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
      <circle cx="12" cy="12" r="3"/>
      <line x1="2" y1="2" x2="22" y2="22"/>
    </svg>
  );
}

function TurnoverIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.29 7 12 12 20.71 7"/>
      <line x1="12" y1="22" x2="12" y2="12"/>
    </svg>
  );
}

function FragmentedIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="7" height="7" x="3" y="3" rx="1"/>
      <rect width="7" height="7" x="14" y="3" rx="1"/>
      <rect width="7" height="7" x="14" y="14" rx="1"/>
      <rect width="7" height="7" x="3" y="14" rx="1"/>
    </svg>
  );
}

function OperationalIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
      <path d="M12 9v4"/>
      <path d="M12 17h.01"/>
    </svg>
  );
}

const CARD_ICONS = [BlindSpotIcon, TurnoverIcon, FragmentedIcon, OperationalIcon];

export function ProblemCards() {
  const t = useTranslations('landing.problems');

  const cards = [
    { icon: CARD_ICONS[0], titleKey: 'card1.title' as const, bodyKey: 'card1.body' as const },
    { icon: CARD_ICONS[1], titleKey: 'card2.title' as const, bodyKey: 'card2.body' as const },
    { icon: CARD_ICONS[2], titleKey: 'card3.title' as const, bodyKey: 'card3.body' as const },
    { icon: CARD_ICONS[3], titleKey: 'card4.title' as const, bodyKey: 'card4.body' as const },
  ];

  return (
    <section
      className="py-20 sm:py-28 bg-slate-950"
      id="problems"
      aria-labelledby="problems-heading"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2
            id="problems-heading"
            className="text-3xl sm:text-4xl font-bold text-white mb-4"
          >
            {t('sectionTitle')}
          </h2>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            {t('sectionSubtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {cards.map(({ icon: Icon, titleKey, bodyKey }) => (
            <div
              key={titleKey}
              className="relative bg-slate-900 border border-slate-800 rounded-2xl p-7 hover:border-violet-700/50 transition-colors duration-200"
              data-testid="problem-card"
            >
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-violet-900/40 text-violet-400 mb-5">
                <Icon />
              </div>
              <h3 className="text-base font-semibold text-white mb-3">
                {t(titleKey)}
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {t(bodyKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
