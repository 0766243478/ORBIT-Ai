import type { User } from 'firebase/auth';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import type { Translations } from '../i18n/translations';

export type ActiveScreen =
  | 'onboarding'
  | 'assistant'
  | 'privacy'
  | 'intelligence'
  | 'settings';

interface TopNavProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  user: User | null;
  authLoading: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  t: Translations;
}

export function TopNav({
  activeScreen,
  onNavigate,
  user,
  authLoading,
  onSignIn,
  onSignOut,
  t,
}: TopNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: Array<{ id: ActiveScreen; label: string }> = [
    { id: 'assistant', label: t.nav.assistant },
    { id: 'privacy', label: t.nav.privacy },
    { id: 'intelligence', label: t.nav.intelligence },
    { id: 'settings', label: t.nav.settings },
    { id: 'onboarding', label: t.nav.overview },
  ];

  const handleSelect = (screen: ActiveScreen) => {
    onNavigate(screen);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 bg-[#0B0F17]/95 backdrop-blur-sm border-b border-slate-800/80">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleSelect('assistant')}
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 hover:text-sky-400 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 rounded-sm"
        >
          {t.brand}
        </button>

        {/* Zone 2: Single-line Text Navigation Links */}
        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-6 text-sm font-medium"
        >
          {navItems.map((item) => {
            const isActive = activeScreen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`py-1.5 whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                  isActive
                    ? 'border-sky-400 text-slate-100'
                    : 'border-transparent text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <button
              type="button"
              onClick={onSignOut}
              disabled={authLoading}
              className="hidden sm:inline-flex items-center px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-[#151D2B] border border-slate-700/80 rounded-md hover:border-slate-500 transition-colors whitespace-nowrap shrink-0 max-w-[200px] truncate"
              title={user.email || user.displayName || undefined}
            >
              {t.auth.signOut} · {user.displayName?.split(' ')[0] || 'Account'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              disabled={authLoading}
              className="hidden sm:inline-flex items-center px-4 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 rounded-md hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {authLoading ? t.auth.signingIn : t.auth.signIn}
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden p-2 text-slate-300 hover:text-slate-100 rounded-md border border-slate-800"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-800/80 bg-[#0E141F] px-4 py-3 space-y-2">
          <div className="flex flex-col space-y-1">
            {navItems.map((item) => {
              const isActive = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  className={`text-start px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-[#151D2B] text-sky-400'
                      : 'text-slate-300 hover:bg-[#151D2B]/60'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="pt-2 border-t border-slate-800/80">
            {user ? (
              <button
                type="button"
                onClick={onSignOut}
                disabled={authLoading}
                className="w-full px-3 py-2.5 text-xs font-medium text-slate-200 bg-[#151D2B] border border-slate-700 rounded-md text-center"
              >
                {t.auth.signOut} · {user.email || user.displayName}
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                disabled={authLoading}
                className="w-full px-3 py-2.5 text-xs font-semibold text-slate-950 bg-sky-400 rounded-md"
              >
                {authLoading ? t.auth.signingIn : t.auth.signIn}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
