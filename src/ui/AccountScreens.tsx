import { useEffect, useRef, useState } from 'react';
import { api, avatarSrc, type PublicUser, type UserPreferences } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { Btn, Panel } from './Screens';
import { Logo, Mark, Signature } from './Brand';

export function AuthScreen({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [service, setService] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        await api<{ ok: boolean }>('/health');
        if (active) setService('online');
      } catch {
        if (active) setService('offline');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const submit = async () => {
    const ok =
      mode === 'login'
        ? await auth.login(email, password)
        : await auth.register(email, username, password);
    if (ok) onClose();
  };

  return (
    <Panel>
      <Logo size="sm" />
      <div className="mt-4 flex items-center justify-center gap-2 text-[10.5px] font-medium text-slate-500">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            service === 'online' ? 'bg-emerald-400' : service === 'checking' ? 'animate-pulse bg-amber-300' : 'bg-rose-400'
          }`}
        />
        {service === 'online' ? 'Service de compte connecté' : service === 'checking' ? 'Vérification du service…' : 'Service de compte indisponible'}
      </div>
      {service === 'offline' && (
        <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-center text-[11px] leading-relaxed text-amber-200">
          {['localhost', '127.0.0.1'].includes(window.location.hostname)
            ? 'Configure le fichier .env puis lance « node server/index.mjs ». Ouvre ensuite http://localhost:8787.'
            : 'Ce site est hébergé sans API. Le serveur Box doit être déployé avec MongoDB pour activer les comptes.'}
        </p>
      )}
      <div className="hairline mt-5 flex rounded-xl bg-black/25 p-1">
        {(['login', 'register'] as const).map((item) => (
          <button
            key={item}
            onClick={() => {
              setMode(item);
              auth.clearError();
            }}
            className={`flex-1 rounded-lg py-2 text-[12px] font-semibold transition ${
              mode === item ? 'bg-white text-ink-950' : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {item === 'login' ? 'Connexion' : 'Inscription'}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {mode === 'register' && (
          <AuthField
            label="Pseudo"
            value={username}
            onChange={setUsername}
            autoComplete="username"
            placeholder="plag_player"
          />
        )}
        <AuthField
          label="Adresse email"
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
          placeholder="toi@exemple.com"
        />
        <AuthField
          label="Mot de passe"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder="8 caractères minimum"
          onEnter={submit}
        />
      </div>

      {auth.error && (
        <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11.5px] font-medium text-rose-300">
          {auth.error}
        </p>
      )}

      <div className="mt-4">
        <Btn onClick={() => void submit()} disabled={auth.busy}>
          {auth.busy
            ? 'Patiente…'
            : mode === 'login'
              ? 'Se connecter'
              : 'Créer mon compte'}
        </Btn>
      </div>
      <p className="mt-3 text-center text-[10.5px] leading-relaxed text-slate-600">
        Ton compte et tes préférences sont sauvegardés sur Box. Le mot de passe est haché côté serveur.
      </p>

      <button
        onClick={onClose}
        className="mt-4 w-full py-2 text-[11.5px] font-medium text-slate-500 transition hover:text-white"
      >
        Continuer sans compte
      </button>
      <Signature className="mt-3" />
    </Panel>
  );
}

function AuthField({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  placeholder,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block pl-0.5 text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="hairline w-full rounded-xl bg-black/30 px-3.5 py-2.5 text-[13px] font-medium text-white outline-none transition placeholder:text-slate-700 focus:border-brand-400/60"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */

type DashboardTab = 'overview' | 'friends' | 'settings';

export function UserDashboard({
  onClose,
  onPlayOnline,
  onInvite,
}: {
  onClose: () => void;
  onPlayOnline: () => void;
  onInvite: (username: string) => void;
}) {
  const auth = useAuth();
  const user = auth.user!;
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const incoming = auth.friendships.filter(
    (f) => f.status === 'pending' && f.direction === 'incoming',
  );

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setResults(await auth.searchUsers(query));
    setSearching(false);
  };

  const navigation: Array<{ key: DashboardTab; label: string; detail: string }> = [
    { key: 'overview', label: 'Vue d’ensemble', detail: 'Activité et progression' },
    {
      key: 'friends',
      label: 'Amis',
      detail: incoming.length ? `${incoming.length} demande${incoming.length > 1 ? 's' : ''}` : 'Réseau de joueurs',
    },
    { key: 'settings', label: 'Paramètres', detail: 'Profil et préférences' },
  ];
  const page = navigation.find((item) => item.key === tab)!;

  return (
    <div className="panel-scroll absolute inset-0 z-40 overflow-y-auto bg-[#05070f]">
      <div className="mx-auto flex min-h-full w-full max-w-[88rem]">
        {/* Desktop workspace sidebar */}
        <aside className="sticky top-0 hidden h-[100dvh] w-[264px] shrink-0 flex-col border-r border-white/[0.07] bg-[#070a13] px-4 py-5 md:flex">
          <button onClick={onClose} className="flex items-center gap-2.5 px-2" aria-label="Retour au jeu">
            <Mark size={27} />
            <span className="font-display text-[22px] font-bold tracking-[-0.04em] text-white">BOX</span>
            <span className="ml-auto rounded-md border border-white/[0.07] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Plag
            </span>
          </button>

          <div className="mt-8 flex items-center gap-3 px-2">
            <div className="relative shrink-0">
              <Avatar user={user} />
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#070a13] bg-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-white">{user.displayName}</p>
              <p className="truncate text-[10.5px] text-slate-600">@{user.username}</p>
            </div>
          </div>

          <p className="eyebrow mb-2 mt-8 px-3 text-slate-700">Espace joueur</p>
          <nav className="space-y-1">
            {navigation.map((item) => (
              <DashboardNavButton
                key={item.key}
                item={item}
                active={tab === item.key}
                count={item.key === 'friends' ? incoming.length : 0}
                onClick={() => setTab(item.key)}
              />
            ))}
          </nav>

          <div className="mt-auto space-y-2">
            <button
              onClick={onPlayOnline}
              className="font-display w-full rounded-xl bg-brand-400 px-3 py-2.5 text-[12.5px] font-bold text-ink-950 shadow-[0_10px_28px_-14px_rgba(56,224,216,.8)] transition hover:brightness-110 active:scale-[.98]"
            >
              Nouvelle partie
            </button>
            <button
              onClick={onClose}
              className="w-full rounded-xl px-3 py-2.5 text-[11.5px] font-medium text-slate-500 transition hover:bg-white/[0.04] hover:text-white"
            >
              Retour au jeu
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Compact mobile header */}
          <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 md:hidden">
            <button onClick={onClose} className="flex items-center gap-2.5" aria-label="Retour">
              <Mark size={24} />
              <span className="font-display text-[20px] font-bold tracking-[-0.04em] text-white">BOX</span>
            </button>
            <button
              onClick={onClose}
              className="hairline flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.03] text-[17px] text-slate-400"
              aria-label="Fermer"
            >
              ×
            </button>
          </header>

          {/* Mobile tab bar */}
          <nav className="grid grid-cols-3 border-b border-white/[0.07] bg-[#070a13] px-2 md:hidden">
            {navigation.map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`relative py-3 text-[11.5px] font-semibold transition ${
                  tab === item.key ? 'text-white' : 'text-slate-600'
                }`}
              >
                {item.label}
                {item.key === 'friends' && incoming.length > 0 && (
                  <span className="ml-1 rounded-full bg-brand-400 px-1.5 py-0.5 text-[8px] text-ink-950">
                    {incoming.length}
                  </span>
                )}
                {tab === item.key && <span className="absolute inset-x-5 bottom-0 h-0.5 bg-brand-400" />}
              </button>
            ))}
          </nav>

          <div className="px-4 py-5 sm:px-7 sm:py-7 lg:px-10 lg:py-9">
            <header className="flex flex-col gap-4 border-b border-white/[0.07] pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="eyebrow text-brand-400/70">Dashboard joueur</p>
                <h1 className="font-display mt-1 text-[25px] font-bold tracking-tight text-white sm:text-[31px]">
                  {page.label}
                </h1>
                <p className="mt-1 text-[11.5px] text-slate-600">{page.detail}</p>
              </div>
              <div className="flex items-center gap-2">
                {tab === 'overview' && (
                  <button
                    onClick={onPlayOnline}
                    className="font-display rounded-xl bg-brand-400 px-4 py-2.5 text-[12.5px] font-bold text-ink-950 transition hover:brightness-110 active:scale-95"
                  >
                    Jouer en ligne
                  </button>
                )}
                <button
                  onClick={() => void auth.refreshSocial()}
                  className="hairline rounded-xl bg-white/[0.025] px-3 py-2.5 text-[11.5px] font-medium text-slate-400 transition hover:text-white"
                >
                  Actualiser
                </button>
              </div>
            </header>

            {tab === 'overview' && (
              <section className="mt-6 flex items-center gap-4 rounded-2xl border border-brand-400/15 bg-gradient-to-r from-brand-400/[0.07] via-white/[0.02] to-indigo-500/[0.04] p-4 sm:p-5">
                <div className="relative shrink-0">
                  <Avatar user={user} size="large" />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-xl border-2 border-ink-950 bg-brand-400 text-ink-950 shadow-lg transition hover:brightness-110 active:scale-90"
                    aria-label="Changer la photo"
                  >
                    <CameraIcon />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display truncate text-[20px] font-bold tracking-tight text-white sm:text-[25px]">
                    {user.displayName}
                  </h2>
                  <p className="truncate text-[11px] text-slate-500">@{user.username} · {user.email}</p>
                  <p className="mt-2 text-[10.5px] text-slate-600">
                    Membre depuis {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </section>
            )}

            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void auth.uploadAvatar(file);
                e.target.value = '';
              }}
            />

            <main key={tab} className="animate-rise py-6">
          {tab === 'overview' && (
            <Overview user={user} matches={auth.cloudMatches} onFriends={() => setTab('friends')} />
          )}
          {tab === 'friends' && (
            <FriendsTab
              friendships={auth.friendships}
              incoming={incoming}
              results={results}
              query={query}
              searching={searching}
              onQuery={setQuery}
              onSearch={() => void search()}
              onAdd={(id) => void auth.addFriend(id)}
              onAccept={(id) => void auth.acceptFriend(id)}
              onRemove={(id) => void auth.removeFriend(id)}
              onInvite={onInvite}
            />
          )}
          {tab === 'settings' && <SettingsTab />}
            </main>
          </div>
        </div>

        {auth.error && (
          <p className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-rose-400/20 bg-rose-950/90 px-4 py-2 text-[11.5px] text-rose-200 shadow-xl">
            {auth.error}
          </p>
        )}
      </div>
    </div>
  );
}

function DashboardNavButton({
  item,
  active,
  count,
  onClick,
}: {
  item: { key: DashboardTab; label: string; detail: string };
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        active
          ? 'bg-brand-400/[0.09] text-brand-300 shadow-[inset_0_0_0_1px_rgba(56,224,216,.12)]'
          : 'text-slate-500 hover:bg-white/[0.035] hover:text-slate-200'
      }`}
    >
      <DashboardIcon type={item.key} active={active} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold">{item.label}</span>
        <span className="block truncate text-[9.5px] opacity-55">{item.detail}</span>
      </span>
      {count > 0 && (
        <span className="num flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-400 px-1 text-[9px] font-bold text-ink-950">
          {count}
        </span>
      )}
    </button>
  );
}

function DashboardIcon({ type, active }: { type: DashboardTab; active: boolean }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    friends: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06L7.04 4.3l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2h4v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9c.12.37.18.75.18 1.14" /></>,
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[type]}
    </svg>
  );
}

function Avatar({ user, size = 'small' }: { user: { avatarUrl: string; displayName: string }; size?: 'small' | 'large' }) {
  const cls = size === 'large' ? 'h-24 w-24 text-[30px]' : 'h-9 w-9 text-[13px]';
  const url = avatarSrc(user.avatarUrl);
  return (
    <span
      className={`font-display flex shrink-0 items-center justify-center overflow-hidden rounded-[28%] border border-white/10 bg-gradient-to-br from-brand-400/25 to-indigo-500/25 font-bold text-brand-300 shadow-[0_14px_38px_-16px_rgba(56,224,216,.7)] ${cls}`}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        user.displayName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function Overview({
  user,
  matches,
  onFriends,
}: {
  user: ReturnType<typeof useAuth>['user'] & {};
  matches: ReturnType<typeof useAuth>['cloudMatches'];
  onFriends: () => void;
}) {
  const winRate = user.stats.games ? Math.round((user.stats.wins / user.stats.games) * 100) : 0;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <div>
        <div className="grid grid-cols-3 gap-2.5">
          {[
            ['Parties', user.stats.games],
            ['Victoires', user.stats.wins],
            ['Taux de victoire', `${winRate}%`],
          ].map(([label, value]) => (
            <div key={label} className="hairline rounded-2xl bg-white/[0.025] p-3.5 sm:p-5">
              <p className="eyebrow text-slate-600">{label}</p>
              <p className="num mt-2 text-[23px] font-extrabold text-white sm:text-[30px]">{value}</p>
            </div>
          ))}
        </div>
        <div className="hairline mt-3 rounded-2xl bg-gradient-to-r from-brand-400/[0.08] to-indigo-500/[0.06] p-4">
          <p className="eyebrow text-brand-400/80">Progression</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <p className="num text-[26px] font-extrabold text-white">{user.stats.boxes}</p>
              <p className="text-[11.5px] text-slate-500">carrés capturés au total</p>
            </div>
            <button onClick={onFriends} className="text-[11.5px] font-semibold text-brand-300 hover:text-white">
              Voir mes amis →
            </button>
          </div>
        </div>
      </div>
      <div className="hairline rounded-2xl bg-white/[0.025] p-4">
        <p className="eyebrow mb-3 text-slate-500">Parties récentes</p>
        {matches.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-slate-600">Tes prochaines parties apparaîtront ici.</p>
        ) : (
          <ul className="space-y-1">
            {matches.slice(0, 6).map((m) => (
              <li key={m._id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]">
                <span className={`h-2 w-2 rounded-full ${m.won ? 'bg-brand-400' : 'bg-slate-600'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-slate-200">{m.names.join(' · ')}</p>
                  <p className="text-[10px] text-slate-600">
                    {m.mode === 'online' ? 'En ligne' : 'Local'} · {m.size}×{m.size}
                  </p>
                </div>
                <span className="num text-[12px] font-bold text-slate-400">{m.scores.join('–')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FriendsTab({
  friendships,
  incoming,
  results,
  query,
  searching,
  onQuery,
  onSearch,
  onAdd,
  onAccept,
  onRemove,
  onInvite,
}: {
  friendships: ReturnType<typeof useAuth>['friendships'];
  incoming: ReturnType<typeof useAuth>['friendships'];
  results: PublicUser[];
  query: string;
  searching: boolean;
  onQuery: (v: string) => void;
  onSearch: () => void;
  onAdd: (id: string) => void;
  onAccept: (id: string) => void;
  onRemove: (id: string) => void;
  onInvite: (username: string) => void;
}) {
  const accepted = friendships.filter((f) => f.status === 'accepted');
  const known = new Set(friendships.map((f) => f.user.id));
  return (
    <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <section>
        <p className="eyebrow mb-2 text-slate-500">Trouver un joueur</p>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Rechercher par pseudo"
            className="hairline min-w-0 flex-1 rounded-xl bg-black/25 px-3.5 py-2.5 text-[13px] font-medium text-white outline-none placeholder:text-slate-700 focus:border-brand-400/50"
          />
          <button
            onClick={onSearch}
            className="rounded-xl bg-white/[0.07] px-4 text-[12px] font-semibold text-white transition hover:bg-brand-400 hover:text-ink-950"
          >
            {searching ? '…' : 'Chercher'}
          </button>
        </div>
        <ul className="mt-2 space-y-1">
          {results.map((person) => (
            <li key={person.id} className="hairline flex items-center gap-2.5 rounded-xl bg-white/[0.025] p-2.5">
              <Avatar user={person} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-white">{person.displayName}</p>
                <p className="text-[10.5px] text-slate-600">@{person.username}</p>
              </div>
              <button
                disabled={known.has(person.id)}
                onClick={() => onAdd(person.id)}
                className="rounded-lg bg-brand-400 px-2.5 py-1.5 text-[10.5px] font-bold text-ink-950 disabled:bg-white/5 disabled:text-slate-600"
              >
                {known.has(person.id) ? 'envoyé' : 'Ajouter'}
              </button>
            </li>
          ))}
        </ul>

        {incoming.length > 0 && (
          <div className="mt-5">
            <p className="eyebrow mb-2 text-amber-300/80">Demandes reçues · {incoming.length}</p>
            <ul className="space-y-1">
              {incoming.map((f) => (
                <li key={f.id} className="hairline flex items-center gap-2.5 rounded-xl bg-amber-300/[0.04] p-2.5">
                  <Avatar user={f.user} />
                  <span className="flex-1 truncate text-[12.5px] font-semibold text-white">{f.user.displayName}</span>
                  <button
                    onClick={() => onAccept(f.id)}
                    className="rounded-lg bg-brand-400 px-2.5 py-1.5 text-[10.5px] font-bold text-ink-950"
                  >
                    Accepter
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="hairline rounded-2xl bg-white/[0.025] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="eyebrow text-slate-500">Mes amis · {accepted.length}</p>
        </div>
        {accepted.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-slate-600">Ajoute un joueur pour l’inviter à ta prochaine salle.</p>
        ) : (
          <ul className="space-y-1">
            {accepted.map((f) => (
              <li key={f.id} className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.035]">
                <Avatar user={f.user} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-white">{f.user.displayName}</p>
                  <p className="text-[10.5px] text-slate-600">@{f.user.username}</p>
                </div>
                <button
                  onClick={() => onInvite(f.user.username)}
                  className="rounded-lg border border-brand-400/25 bg-brand-400/[0.08] px-2.5 py-1.5 text-[10.5px] font-semibold text-brand-300 transition hover:bg-brand-400 hover:text-ink-950"
                >
                  Inviter
                </button>
                <button
                  onClick={() => onRemove(f.id)}
                  className="px-1.5 text-[15px] text-slate-700 transition hover:text-rose-400"
                  aria-label="Retirer cet ami"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SettingsTab() {
  const auth = useAuth();
  const user = auth.user!;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const updatePref = (patch: Partial<UserPreferences>) => {
    void auth.updateProfile({ preferences: { ...user.preferences, ...patch } });
  };
  return (
    <div className="mx-auto grid max-w-3xl gap-5 md:grid-cols-2">
      <section className="hairline rounded-2xl bg-white/[0.025] p-4">
        <p className="eyebrow mb-4 text-slate-500">Identité</p>
        <div className="space-y-3">
          <AuthField label="Nom affiché" value={displayName} onChange={setDisplayName} />
          <AuthField label="Pseudo" value={username} onChange={setUsername} />
          <button
            onClick={() => void auth.updateProfile({ displayName, username })}
            className="w-full rounded-xl bg-white/[0.08] py-2.5 text-[12px] font-semibold text-white transition hover:bg-brand-400 hover:text-ink-950"
          >
            Enregistrer
          </button>
        </div>
      </section>

      <section className="hairline rounded-2xl bg-white/[0.025] p-4">
        <p className="eyebrow mb-4 text-slate-500">Préférences</p>
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-medium text-slate-400">Langue</span>
          <select
            value={user.preferences.language}
            onChange={(e) => updatePref({ language: e.target.value as UserPreferences['language'] })}
            className="hairline w-full rounded-xl bg-ink-900 px-3 py-2.5 text-[12.5px] text-white outline-none"
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="de">Deutsch</option>
            <option value="pt">Português</option>
          </select>
        </label>
        <div className="mt-3 divide-y divide-white/[0.06]">
          <Toggle
            label="Effets sonores"
            checked={user.preferences.sound}
            onChange={(v) => updatePref({ sound: v })}
          />
          <Toggle
            label="Réduire les animations"
            checked={user.preferences.reducedMotion}
            onChange={(v) => updatePref({ reducedMotion: v })}
          />
          <Toggle
            label="Demandes d’amis"
            checked={user.preferences.friendRequests}
            onChange={(v) => updatePref({ friendRequests: v })}
          />
        </div>
      </section>

      <section className="hairline rounded-2xl bg-white/[0.025] p-4 md:col-span-2">
        <p className="eyebrow mb-2 text-slate-500">Sécurité du compte</p>
        <p className="mb-4 text-[11.5px] leading-relaxed text-slate-500">
          {user.hasPassword
            ? 'Change ton mot de passe. Il est haché et enregistré dans MongoDB.'
            : 'Ton ancien compte n’a pas de mot de passe. Définis-en un maintenant pour pouvoir te connecter avec ton email.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {user.hasPassword && (
            <AuthField label="Mot de passe actuel" value={currentPassword} onChange={setCurrentPassword} type="password" autoComplete="current-password" />
          )}
          <AuthField label="Nouveau mot de passe" value={newPassword} onChange={setNewPassword} type="password" autoComplete="new-password" placeholder="8 caractères minimum" />
        </div>
        <button
          disabled={auth.busy || newPassword.length < 8 || (user.hasPassword && !currentPassword)}
          onClick={() => {
            void auth.setPassword(newPassword, currentPassword).then((ok) => {
              if (ok) {
                setCurrentPassword('');
                setNewPassword('');
                setPasswordSaved(true);
              }
            });
          }}
          className="mt-3 rounded-xl bg-white/[0.08] px-4 py-2.5 text-[12px] font-semibold text-white transition hover:bg-brand-400 hover:text-ink-950 disabled:opacity-40"
        >
          Enregistrer le mot de passe
        </button>
        {passwordSaved && <p className="mt-2 text-[11px] text-brand-300">Mot de passe mis à jour.</p>}
      </section>

      <section className="hairline rounded-2xl bg-white/[0.025] p-4 md:col-span-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold text-white">Session</p>
            <p className="mt-0.5 text-[10.5px] text-slate-600">Connecté avec {user.email}</p>
          </div>
          <button
            onClick={() => void auth.logout()}
            className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[11.5px] font-semibold text-rose-300 transition hover:bg-rose-400 hover:text-white"
          >
            Se déconnecter
          </button>
        </div>
      </section>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-3">
      <span className="text-[11.5px] font-medium text-slate-300">{label}</span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-5 w-9 rounded-full bg-white/10 transition peer-checked:bg-brand-400 after:absolute after:left-[3px] after:top-[3px] after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
    </label>
  );
}

function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M14.5 5 13 3h-2L9.5 5H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3Z" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}