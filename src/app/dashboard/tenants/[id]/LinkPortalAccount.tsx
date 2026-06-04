'use client';

/**
 * LinkPortalAccount — Admin UI panel to link a tenant row to a portal account.
 *
 * Flow:
 * 1. Admin enters the email address of the existing auth user.
 * 2. Clicking "Search" calls searchAuthUserByEmail Server Action — shows matched user.
 * 3. Admin confirms by clicking "Link account" — calls linkTenantPortalAccount.
 * 4. On success, the page is revalidated showing "Portal Active" badge.
 *
 * Security: all reads/writes go through Server Actions guarded by requireAdmin().
 * The component itself holds no auth logic — it is display-only.
 */

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { searchAuthUserByEmail, linkTenantPortalAccount } from '@/app/actions/tenants';
import type { ActionResult } from '@/lib/errors';

interface Props {
  tenantId: string;
  tenantEmail?: string | null;
}

type SearchResult = {
  profileId: string;
  email: string;
  fullName: string | null;
};

function SearchButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-lg transition-colors"
    >
      {pending ? 'Searching…' : 'Search'}
    </button>
  );
}

function LinkButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition-colors"
    >
      {pending ? 'Linking…' : 'Confirm & Link'}
    </button>
  );
}

export function LinkPortalAccount({ tenantId, tenantEmail }: Props) {
  const [searchMatches, setSearchMatches] = useState<SearchResult[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<SearchResult | null>(null);
  const [searchDone, setSearchDone] = useState(false);

  // Search action state
  const [searchState, searchAction] = useActionState<ActionResult<{ matches: SearchResult[] }>, FormData>(
    async (_prev, formData) => {
      const result = await searchAuthUserByEmail(_prev as ActionResult, formData);
      if (result.data?.matches) {
        setSearchMatches(result.data.matches);
        setSelectedMatch(result.data.matches.length === 1 ? result.data.matches[0] : null);
        setSearchDone(true);
      } else {
        setSearchMatches([]);
        setSelectedMatch(null);
        setSearchDone(true);
      }
      return result as ActionResult<{ matches: SearchResult[] }>;
    },
    {}
  );

  // Link action state
  const [linkState, linkAction] = useActionState<ActionResult<{ profileId: string }>, FormData>(
    async (_prev, formData) => {
      const result = await linkTenantPortalAccount(_prev as ActionResult, formData);
      if (result.data?.profileId) {
        setSearchMatches([]);
        setSelectedMatch(null);
        setSearchDone(false);
      }
      return result as ActionResult<{ profileId: string }>;
    },
    {}
  );

  return (
    <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Link portal account</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Search for an existing auth user by email and link them to this tenant record.
        </p>
      </div>

      {/* Link success */}
      {linkState.data?.profileId && (
        <div role="alert" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          Portal account linked successfully.
        </div>
      )}

      {/* Link error */}
      {linkState.error && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {linkState.error.message}
        </div>
      )}

      {/* Step 1: search form */}
      <form action={searchAction} className="flex gap-2 items-end">
        <div className="flex-1">
          <label htmlFor="email-search" className="block text-xs font-medium text-slate-700 mb-1">
            Email address
          </label>
          <input
            id="email-search"
            name="email"
            type="email"
            defaultValue={tenantEmail ?? ''}
            required
            placeholder="user@example.com"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <SearchButton />
      </form>

      {/* Search errors */}
      {searchState.error && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {searchState.error.message}
        </div>
      )}

      {/* Step 2: results */}
      {searchDone && searchMatches.length === 0 && (
        <p className="text-xs text-slate-500">No auth users found with that email address.</p>
      )}

      {searchMatches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-700">Select the user to link:</p>
          {searchMatches.map((match) => (
            <button
              key={match.profileId}
              type="button"
              onClick={() => setSelectedMatch(match)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                selectedMatch?.profileId === match.profileId
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-slate-200 bg-white hover:border-brand-300'
              }`}
            >
              <span className="font-medium text-slate-900">{match.fullName ?? '(no name)'}</span>
              <span className="text-slate-500 ml-2">{match.email}</span>
            </button>
          ))}
        </div>
      )}

      {/* Step 3: confirm link */}
      {selectedMatch && !linkState.data?.profileId && (
        <form action={linkAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="profileEmail" value={selectedMatch.email} />
          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 mb-3">
            <div>
              <p className="text-xs text-slate-500">Selected user</p>
              <p className="text-sm font-medium text-slate-900">{selectedMatch.fullName ?? selectedMatch.email}</p>
              <p className="text-xs text-slate-500">{selectedMatch.email}</p>
            </div>
            <button
              type="button"
              onClick={() => { setSelectedMatch(null); }}
              className="text-xs text-slate-400 hover:text-slate-600"
              aria-label="Deselect user"
            >
              ✕
            </button>
          </div>
          <LinkButton />
        </form>
      )}
    </div>
  );
}
