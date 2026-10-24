import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { MouseEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  ArrowRight, Bookmark, CalendarDays, Check, ChevronRight, Clock3, MapPin,
  Menu, Search, Ticket, Users, Video, X,
} from 'lucide-react';
import {
  useListEvents, getListEventsQueryKey, useGetFeaturedEvents,
  getGetFeaturedEventsQueryKey, useGetEvent, getGetEventQueryKey,
  useCreateRsvp, useCancelRsvp, useSaveEvent, useUnsaveEvent,
  useGetMyEvents, getGetMyEventsQueryKey, useGetMyOrganizer,
  getGetMyOrganizerQueryKey, useCreateOrganizer, useGetOrganizerDashboard,
  getGetOrganizerDashboardQueryKey, useCreateOrganizerEvent,
  usePublishOrganizerEvent, type Event, type EventInput, type OrganizerInput,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#4F46E5',
    colorForeground: '#202448',
    colorMutedForeground: '#687084',
    colorDanger: '#b42318',
    colorBackground: '#ffffff',
    colorInput: '#f7f8fb',
    colorInputForeground: '#202448',
    colorNeutral: '#dfe2eb',
    fontFamily: 'Inter, sans-serif',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#202448] font-bold tracking-tight',
    headerSubtitle: 'text-[#687084]',
    socialButtonsBlockButtonText: 'text-[#34394d] font-semibold',
    formFieldLabel: 'text-[#4b5267] font-semibold',
    footerActionLink: 'text-[#4f46e5] font-semibold',
    footerActionText: 'text-[#687084]',
    dividerText: 'text-[#687084]',
    identityPreviewEditButton: 'text-[#4f46e5]',
    formFieldSuccessText: 'text-emerald-700',
    alertText: 'text-red-800',
    logoBox: 'mb-2',
    logoImage: 'max-h-8',
    socialButtonsBlockButton: 'border border-[#dfe2eb] rounded-xl',
    formButtonPrimary: 'bg-[#4f46e5] hover:bg-[#4338ca] rounded-xl font-bold',
    formFieldInput: 'border-[#dfe2eb] rounded-xl text-[#202448]',
    footerAction: 'border-0',
    dividerLine: 'bg-[#e4e6ed]',
    alert: 'rounded-xl',
    otpCodeFieldInput: 'rounded-lg border-[#dfe2eb]',
    formFieldRow: 'mb-4',
    main: 'gap-5',
  },
};

function money(event: Event) {
  return event.price === 0 ? 'Free' : new Intl.NumberFormat(undefined, { style: 'currency', currency: event.currency || 'USD' }).format(event.price);
}
function eventDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? 'Date to be announced' : new Intl.DateTimeFormat(undefined, opts).format(value);
}
function eventHref(event: Event) { return `/events/${event.id}`; }
function ErrorState({ retry }: { retry: () => void }) {
  return <div className="state-box" role="alert"><h3>We couldn’t load this right now</h3><p>Give it another try in a moment.</p><button className="btn btn-outline btn-sm" onClick={retry} data-testid="button-retry">Try again</button></div>;
}
function LoadingGrid() {
  return <div className="event-grid" aria-label="Loading events">{[0, 1, 2].map((n) => <div className="skeleton" key={n} />)}</div>;
}
function Header() {
  const [location] = useLocation();
  const { isSignedIn } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  return <header className="page-shell">
    <div className="topbar">
      <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark">L</span><span>LocalLoop</span></Link>
      <nav className="nav-links" aria-label="Main navigation">
        <Link href="/discover" className={location === '/discover' ? 'active' : ''} data-testid="link-discover">Discover</Link>
        <Link href="/my-events" className={location === '/my-events' ? 'active' : ''} data-testid="link-my-events">My events</Link>
        <Link href="/organizer" className={location.startsWith('/organizer') ? 'active' : ''} data-testid="link-organizer">For organizers</Link>
      </nav>
      <button type="button" className="mobile-menu-toggle" aria-expanded={mobileOpen} aria-controls="mobile-navigation" aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMobileOpen((open) => !open)} data-testid="button-mobile-menu">
        {mobileOpen ? <X size={19} /> : <Menu size={19} />}
      </button>
      {mobileOpen && <nav id="mobile-navigation" className="mobile-menu-panel" aria-label="Mobile navigation">
        <Link href="/discover" onClick={() => setMobileOpen(false)} data-testid="mobile-link-discover">Discover events</Link>
        <Link href="/my-events" onClick={() => setMobileOpen(false)} data-testid="mobile-link-my-events">My events</Link>
        <Link href="/organizer" onClick={() => setMobileOpen(false)} data-testid="mobile-link-organizer">For organizers</Link>
        {!isSignedIn && <Link href={`/sign-in?redirect_url=${encodeURIComponent(location)}`} onClick={() => setMobileOpen(false)} data-testid="mobile-link-sign-in">Sign in</Link>}
      </nav>}
      <div className="top-actions">
        {isSignedIn ? <Link href="/organizer" className="btn btn-quiet btn-sm" data-testid="link-account">Your space <ChevronRight size={14} /></Link> :
          <Link href={`/sign-in?redirect_url=${encodeURIComponent(location)}`} className="btn btn-outline btn-sm" data-testid="link-sign-in">Sign in</Link>}
        <Link href="/organizer" className="btn btn-primary btn-sm desktop-organize" data-testid="button-organize">Host an event <ArrowRight size={14} /></Link>
      </div>
    </div>
  </header>;
}
function PageFrame({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Header />{children}<Footer /></ErrorBoundary>;
}
function Footer() {
  return <footer className="page-shell"><div className="footer"><span>LocalLoop · Find your people, close to home.</span><div>Made for the places we call ours.</div></div></footer>;
}
function EventCard({ event }: { event: Event }) {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const save = useSaveEvent();
  const unsave = useUnsaveEvent();
  const busy = save.isPending || unsave.isPending;
  const toggleSave = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSignedIn) { setLocation(`/sign-in?redirect_url=${encodeURIComponent(eventHref(event))}`); return; }
    const action = event.isSaved ? unsave : save;
    action.mutate({ eventId: event.id }, { onSuccess: () => {
      void client.invalidateQueries({ queryKey: getGetMyEventsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetEventQueryKey(event.id) });
      void client.invalidateQueries({ queryKey: getListEventsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetFeaturedEventsQueryKey() });
    }});
  };
  return <article className="event-card" data-testid={`card-event-${event.id}`}>
    <div className="event-image">
      {event.bannerUrl ? <img src={event.bannerUrl} alt="" loading="lazy" /> : <div className="image-fallback">{event.category || 'Local gathering'}</div>}
      <span className="category-pill">{event.category}</span>
      {event.isDemo && <span className="sample-tag">Sample listing</span>}
      <button type="button" className="save-mini" onClick={toggleSave} disabled={busy} aria-label={event.isSaved ? 'Remove saved event' : 'Save event'} data-testid={`button-save-event-${event.id}`}>
        {event.isSaved ? <Check size={15} /> : <Bookmark size={15} />}
      </button>
    </div>
    <Link href={eventHref(event)} className="event-body" data-testid={`link-event-${event.id}`}>
      <div className="event-date">{eventDate(event.startAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
      <h3 data-testid={`text-event-title-${event.id}`}>{event.title}</h3>
      <div className="event-meta"><MapPin />{event.city || event.venue || (event.mode === 'online' ? 'Online' : 'Location details')}</div>
      <div className="card-foot"><span className="org-name">{event.organizer?.name || 'LocalLoop community'}</span><span className="price">{money(event)}</span></div>
    </Link>
  </article>;
}
function EventList({ events, isLoading, isError, retry, emptyTitle = 'No events found', emptyText = 'Try another search or check back soon.' }: {
  events?: Event[]; isLoading: boolean; isError: boolean; retry: () => void; emptyTitle?: string; emptyText?: string;
}) {
  if (isLoading) return <LoadingGrid />;
  if (isError) return <ErrorState retry={retry} />;
  if (!events?.length) return <div className="state-box"><h3>{emptyTitle}</h3><p>{emptyText}</p></div>;
  return <div className="event-grid">{events.map((event) => <EventCard key={event.id} event={event} />)}</div>;
}
function Home() {
  const featured = useGetFeaturedEvents({ query: { queryKey: getGetFeaturedEventsQueryKey() } });
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    if (city) query.set('city', city);
    const queryString = query.toString();
    setLocation(`/discover${queryString ? `?${queryString}` : ''}`);
  };
  return <PageFrame><main className="page-shell">
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow">Find Your People. Discover Your Next Thing.</div>
        <h1>Your Next Great Experience Starts Nearby.</h1>
        <p>Discover hackathons, workshops, meetups and community events tailored to your interests and happening around you.</p>
        <form className="home-search" onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="home-event-search">Search nearby events</label>
          <input id="home-event-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try “AI meetup” or “Python workshop”" data-testid="input-home-search" />
          <label className="sr-only" htmlFor="home-event-city">Choose a city</label>
          <select id="home-event-city" value={city} onChange={(event) => setCity(event.target.value)} data-testid="select-home-city">
            <option value="">Anywhere</option><option value="Mumbai">Mumbai</option><option value="Pune">Pune</option><option value="Bengaluru">Bengaluru</option><option value="Delhi">Delhi</option><option value="Hyderabad">Hyderabad</option><option value="Chennai">Chennai</option>
          </select>
          <button className="btn btn-primary" type="submit" data-testid="button-home-search"><Search size={15} /> Find events</button>
        </form>
        <div className="category-shortcuts" aria-label="Popular event categories">
          {['Artificial Intelligence', 'Software Development', 'Cybersecurity', 'Product and Design'].map((item) => <Link key={item} href={`/discover?category=${encodeURIComponent(item)}`} data-testid={`link-category-${item.toLowerCase().replaceAll(' ', '-')}`}>{item}</Link>)}
        </div>
        <div className="hero-cta"><Link href="/discover" className="btn btn-outline" data-testid="button-explore-events">Explore all events <ArrowRight size={16} /></Link><Link href="/organizer" className="btn btn-quiet" data-testid="button-host-event">Bring people together</Link></div>
      </div>
    </section>
    <div className="section-head"><div><div className="eyebrow" style={{ color: '#7772da' }}>Happening around you</div><h2>Worth stepping out for</h2><p>Fresh plans from the communities nearby.</p></div><Link href="/discover" className="btn btn-quiet btn-sm" data-testid="link-all-events">See all events <ArrowRight size={14} /></Link></div>
    <EventList events={featured.data} isLoading={featured.isLoading} isError={featured.isError} retry={() => void featured.refetch()} emptyTitle="The calendar is taking a breath" emptyText="No featured events are listed yet. Explore all events to find what’s happening." />
    <section className="wide-band"><div><h2>Have a gathering in mind?</h2><p>Start with a simple listing. Your next regular might be one event away.</p></div><Link href="/organizer" className="btn btn-primary" data-testid="button-start-organizing">Start organizing <ArrowRight size={15} /></Link></section>
  </main></PageFrame>;
}
function Discover() {
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [category, setCategory] = useState(() => new URLSearchParams(window.location.search).get('category') ?? '');
  const [city, setCity] = useState(() => new URLSearchParams(window.location.search).get('city') ?? '');
  const [mode, setMode] = useState('');
  const [price, setPrice] = useState('');
  const params = useMemo(() => ({
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(category ? { category } : {}),
    ...(city ? { city } : {}),
    ...(mode ? { mode: mode as 'in-person' | 'hybrid' | 'online' } : {}),
    ...(price ? { price: price as 'free' | 'paid' } : {}),
    sort: 'soonest' as const,
    limit: 24,
  }), [q, category, city, mode, price]);
  const result = useListEvents(params, { query: { queryKey: getListEventsQueryKey(params) } });
  return <PageFrame><main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: '#7772da' }}>Make a plan</div><h1>Discover what’s happening</h1><p>One good event can change the shape of your week.</p></div>
    <div className="filterbar">
      <div style={{ position: 'relative', flex: 1, minWidth: 200 }}><Search size={16} style={{ position: 'absolute', top: 14, left: 13, color: '#858a9a' }} /><input className="field search-field" style={{ paddingLeft: 38, width: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events, topics, or places" aria-label="Search events" data-testid="input-search-events" /></div>
      <select className="select" aria-label="Filter by format" value={mode} onChange={(e) => setMode(e.target.value)} data-testid="select-event-mode"><option value="">All formats</option><option value="in-person">In person</option><option value="hybrid">Hybrid</option><option value="online">Online</option></select>
      <select className="select" aria-label="Filter by price" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="select-event-price"><option value="">Any price</option><option value="free">Free</option><option value="paid">Paid</option></select>
      <input className="field" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" aria-label="Filter by category" data-testid="input-event-category" />
      <select className="select" aria-label="Filter by city" value={city} onChange={(e) => setCity(e.target.value)} data-testid="select-event-city"><option value="">Any city</option><option value="Mumbai">Mumbai</option><option value="Pune">Pune</option><option value="Bengaluru">Bengaluru</option><option value="Delhi">Delhi</option><option value="Hyderabad">Hyderabad</option><option value="Chennai">Chennai</option></select>
    </div>
    <div className="section-head" style={{ marginTop: 22 }}><div><h2>Open invitations</h2><p>Browse by what you’re curious about.</p></div><span style={{ color: '#737b8b', fontSize: 12 }}>{result.data?.length ?? '—'} events</span></div>
    <EventList events={result.data} isLoading={result.isLoading} isError={result.isError} retry={() => void result.refetch()} />
  </main></PageFrame>;
}
function EventDetails() {
  const params = useParams<{ eventId: string }>();
  const id = Number(params.eventId);
  const eventQuery = useGetEvent(id, { query: { queryKey: getGetEventQueryKey(id), enabled: Number.isFinite(id) } });
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const rsvp = useCreateRsvp();
  const cancel = useCancelRsvp();
  const save = useSaveEvent();
  const unsave = useUnsaveEvent();
  const event = eventQuery.data;
  const protectedAction = () => setLocation(`/sign-in?redirect_url=${encodeURIComponent(`/events/${id}`)}`);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getGetEventQueryKey(id) });
    void client.invalidateQueries({ queryKey: getGetMyEventsQueryKey() });
    void client.invalidateQueries({ queryKey: getListEventsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetFeaturedEventsQueryKey() });
  };
  const rsvpAction = () => {
    if (!isSignedIn) return protectedAction();
    if (!event) return;
    (event.rsvpStatus ? cancel : rsvp).mutate({ eventId: id }, { onSuccess: refresh });
  };
  const saveAction = () => {
    if (!isSignedIn) return protectedAction();
    if (!event) return;
    (event.isSaved ? unsave : save).mutate({ eventId: id }, { onSuccess: refresh });
  };
  if (eventQuery.isLoading) return <PageFrame><main className="page-shell" style={{ paddingTop: 40 }}><div className="skeleton" /></main></PageFrame>;
  if (eventQuery.isError || !event) return <PageFrame><main className="page-shell" style={{ paddingTop: 40 }}><ErrorState retry={() => void eventQuery.refetch()} /></main></PageFrame>;
  const pending = rsvp.isPending || cancel.isPending || save.isPending || unsave.isPending;
  const mutationError = rsvp.isError || cancel.isError || save.isError || unsave.isError;
  return <PageFrame><main className="page-shell" style={{ paddingTop: 26 }}>
    <div className="detail-hero">{event.bannerUrl ? <img src={event.bannerUrl} alt="" /> : <div className="image-fallback">{event.category || 'Local gathering'}</div>}</div>
    <div className="detail-grid">
      <article className="detail-main">
        <div className="eyebrow" style={{ color: '#7772da' }}>{event.category} · {event.mode === 'online' ? 'Online' : event.city}{event.isDemo && <span className="sample-tag detail-sample-tag">Sample listing</span>}</div>
        <h1 data-testid="text-event-detail-title">{event.title}</h1>
        <div className="event-meta"><Users />Hosted by {event.organizer?.name || 'LocalLoop organizer'} {event.organizer?.verified && <span className="status-tag">Verified</span>}</div>
        <div className="section-head" style={{ margin: '30px 0 13px' }}><div><h2 style={{ fontSize: 20 }}>About this event</h2></div></div>
        <p style={{ whiteSpace: 'pre-line' }}>{event.description}</p>
        {!!event.tags?.length && <div className="filterbar" style={{ marginTop: 22 }}>{event.tags.map(tag => <span key={tag} className="btn btn-quiet btn-sm">{tag}</span>)}</div>}
      </article>
      <aside className="detail-side">
        <h3>Make it part of your week</h3>
        <div className="side-row"><CalendarDays /> <span>{eventDate(event.startAt, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
        <div className="side-row"><Clock3 /> <span>{eventDate(event.startAt, { hour: 'numeric', minute: '2-digit', timeZone: event.timezone || undefined })} – {eventDate(event.endAt, { hour: 'numeric', minute: '2-digit', timeZone: event.timezone || undefined })} {event.timezone}</span></div>
        <div className="side-row">{event.mode === 'online' ? <Video /> : <MapPin />}<span>{event.mode === 'online' ? 'Online event' : `${event.venue}${event.city ? `, ${event.city}` : ''}`}</span></div>
        <div className="side-row"><Ticket /><span>{money(event)}{event.capacity ? ` · ${event.attendeeCount} of ${event.capacity} spots` : ''}</span></div>
        {event.registrationDeadline && <div className="side-row"><Clock3 /><span>Register by {eventDate(event.registrationDeadline)}</span></div>}
        {mutationError && <p role="alert" style={{ color: '#b42318', fontSize: 12 }}>That didn’t go through. Please try again.</p>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 9 }} disabled={pending} onClick={rsvpAction} data-testid="button-rsvp">
          {pending ? 'Updating…' : event.rsvpStatus ? 'Cancel RSVP' : event.rsvpStatus === 'waitlisted' ? 'On waitlist' : 'RSVP for this event'}
        </button>
        <button className="btn btn-outline" style={{ width: '100%', marginTop: 9 }} disabled={pending} onClick={saveAction} data-testid="button-save-detail">
          {event.isSaved ? <Check size={15} /> : <Bookmark size={15} />}{event.isSaved ? 'Saved' : 'Save for later'}
        </button>
        {event.externalUrl && <a href={event.externalUrl} target="_blank" rel="noreferrer" className="btn btn-quiet" style={{ width: '100%', marginTop: 9 }}>More event details <ArrowRight size={14} /></a>}
      </aside>
    </div>
  </main></PageFrame>;
}
function MyEvents() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const result = useGetMyEvents({ query: { queryKey: getGetMyEventsQueryKey(), enabled: Boolean(isLoaded && isSignedIn) } });
  if (isLoaded && !isSignedIn) return <PageFrame><main className="page-shell"><div className="state-box" style={{ marginTop: 50 }}><h3>Your plans, all in one place</h3><p>Sign in to see the events you’ve saved and joined.</p><button className="btn btn-primary" onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent('/my-events')}`)} data-testid="button-sign-in-my-events">Sign in to continue</button></div></main></PageFrame>;
  return <PageFrame><main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: '#7772da' }}>Your LocalLoop</div><h1>My events</h1><p>Your saved ideas and the plans you’ve said yes to.</p></div>
    {!isLoaded || result.isLoading ? <LoadingGrid /> : result.isError ? <ErrorState retry={() => void result.refetch()} /> : <>
      <div className="section-head" style={{ marginTop: 6 }}><div><h2>Coming up</h2><p>Events you’re registered for.</p></div></div>
      {result.data?.registered.length ? <div className="event-grid">{result.data.registered.map(event => <EventCard key={event.id} event={event} />)}</div> : <div className="state-box"><h3>No plans on the calendar yet</h3><p>Find something that feels like you and make it official.</p><Link href="/discover" className="btn btn-primary btn-sm" data-testid="link-discover-from-empty">Explore events <ArrowRight size={14} /></Link></div>}
      <div className="section-head"><div><h2>Saved for later</h2><p>Good ideas worth keeping close.</p></div></div>
      {result.data?.saved.length ? <div className="event-grid">{result.data.saved.map(event => <EventCard key={event.id} event={event} />)}</div> : <div className="state-box"><h3>Your shortlist starts here</h3><p>Save an event to keep it handy for another day.</p><Link href="/discover" className="btn btn-outline btn-sm" data-testid="link-find-events">Find events <ArrowRight size={14} /></Link></div>}
    </>}
  </main></PageFrame>;
}
function Organizer() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const profile = useGetMyOrganizer({ query: { queryKey: getGetMyOrganizerQueryKey(), enabled: Boolean(isLoaded && isSignedIn) } });
  const dashboard = useGetOrganizerDashboard({ query: { queryKey: getGetOrganizerDashboardQueryKey(), enabled: Boolean(isLoaded && isSignedIn && profile.data) } });
  const createOrganizer = useCreateOrganizer();
  const [profileError, setProfileError] = useState('');
  const submitProfile = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data: OrganizerInput = { name: String(form.get('name')), type: String(form.get('type')) as OrganizerInput['type'], description: String(form.get('description') || '') };
    createOrganizer.mutate({ data }, { onSuccess: () => {
      setProfileError('');
      void client.invalidateQueries({ queryKey: getGetMyOrganizerQueryKey() });
      void client.invalidateQueries({ queryKey: getGetOrganizerDashboardQueryKey() });
    }, onError: () => setProfileError('We couldn’t create your organizer profile. Please try again.') });
  };
  if (isLoaded && !isSignedIn) return <PageFrame><main className="page-shell"><div className="state-box" style={{ marginTop: 50 }}><h3>Bring your community together</h3><p>Sign in to create an organizer space and publish events.</p><button className="btn btn-primary" onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent('/organizer')}`)} data-testid="button-sign-in-organizer">Sign in to continue</button></div></main></PageFrame>;
  return <PageFrame><main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: '#7772da' }}>The people behind the plans</div><h1>Organizer studio</h1><p>Build a place people want to come back to.</p></div>
    {!isLoaded || profile.isLoading ? <div className="skeleton" /> : profile.isError ? <ErrorState retry={() => void profile.refetch()} /> : !profile.data ?
      <form className="form-layout" onSubmit={submitProfile}>
        <h2>Set up your organizer profile</h2>
        <p style={{ color: '#737b8b', fontSize: 13, marginTop: -10 }}>Tell people who is bringing them together.</p>
        <div className="form-grid">
          <div className="form-field full"><label htmlFor="organizer-name">Organizer name</label><input className="field" id="organizer-name" name="name" minLength={2} maxLength={120} required placeholder="Your community or group" data-testid="input-organizer-name" /></div>
          <div className="form-field"><label htmlFor="organizer-type">Organizer type</label><select className="select" id="organizer-type" name="type" required data-testid="select-organizer-type"><option value="community">Community</option><option value="college-club">College club</option><option value="individual">Individual</option><option value="startup">Startup</option><option value="company">Company</option></select></div>
          <div className="form-field full"><label htmlFor="organizer-description">A short introduction</label><textarea id="organizer-description" name="description" maxLength={1000} placeholder="What brings your people together?" data-testid="input-organizer-description" /></div>
        </div>
        {profileError && <p role="alert" style={{ color: '#b42318', fontSize: 12 }}>{profileError}</p>}
        <button className="btn btn-primary" type="submit" disabled={createOrganizer.isPending} style={{ marginTop: 20 }} data-testid="button-create-organizer">{createOrganizer.isPending ? 'Creating…' : 'Create organizer profile'} <ArrowRight size={15} /></button>
      </form> :
      <>
        <div className="dash-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div><h2 style={{ margin: 0, fontSize: 24, letterSpacing: '-.05em', color: '#202448' }}>{profile.data.name}</h2><p style={{ margin: '6px 0', color: '#737b8b', fontSize: 13 }}>{profile.data.description || 'Your organizer home, all in one place.'}</p></div>
          <Link href="/organizer/create" className="btn btn-primary" data-testid="button-create-event"><span aria-hidden="true">+</span> Create event</Link>
        </div>
        {dashboard.isLoading ? <div className="dash-stats">{[0,1,2,3].map(n => <div className="skeleton" key={n} style={{ height: 90 }} />)}</div> :
          dashboard.isError ? <div style={{ marginTop: 25 }}><ErrorState retry={() => void dashboard.refetch()} /></div> : dashboard.data && <>
            <div className="dash-stats">
              <div className="stat-card"><span>Published events</span><strong data-testid="text-published-count">{dashboard.data.publishedCount}</strong></div>
              <div className="stat-card"><span>Drafts</span><strong data-testid="text-draft-count">{dashboard.data.draftCount}</strong></div>
              <div className="stat-card"><span>Confirmed RSVPs</span><strong data-testid="text-confirmed-rsvps">{dashboard.data.confirmedRsvps}</strong></div>
              <div className="stat-card"><span>On the waitlist</span><strong data-testid="text-waitlisted-rsvps">{dashboard.data.waitlistedRsvps}</strong></div>
            </div>
            <div className="section-head" style={{ marginTop: 36 }}><div><h2>Your events</h2><p>Keep an eye on what’s live and what’s next.</p></div></div>
            {dashboard.data.events.length ? <div className="table-wrap"><table className="event-table"><thead><tr><th>Event</th><th>Date</th><th>Attendees</th><th>Status</th><th></th></tr></thead><tbody>{dashboard.data.events.map(event => <tr key={event.id} data-testid={`row-organizer-event-${event.id}`}><td>{event.status === 'published' ? <Link href={eventHref(event)} style={{ color: '#34394d', fontWeight: 700, textDecoration: 'none' }}>{event.title}</Link> : <strong>{event.title}</strong>}</td><td>{eventDate(event.startAt)}</td><td>{event.attendeeCount}</td><td><span className={`status-tag ${event.status === 'draft' ? 'status-draft' : ''}`}>{event.status}</span></td><td>{event.status === 'draft' && <PublishButton eventId={event.id} />}</td></tr>)}</tbody></table></div> :
              <div className="state-box"><h3>Your first event starts here</h3><p>Share an idea, a skill, or a reason to get together.</p><Link href="/organizer/create" className="btn btn-primary btn-sm" data-testid="link-create-first-event">Create an event <ArrowRight size={14} /></Link></div>}
          </>}
      </>}
  </main></PageFrame>;
}
function PublishButton({ eventId }: { eventId: number }) {
  const publish = usePublishOrganizerEvent();
  const client = useQueryClient();
  return <button type="button" className="btn btn-quiet btn-sm" disabled={publish.isPending} onClick={() => publish.mutate({ eventId }, { onSuccess: () => {
    void client.invalidateQueries({ queryKey: getGetOrganizerDashboardQueryKey() });
    void client.invalidateQueries({ queryKey: getListEventsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetFeaturedEventsQueryKey() });
  }})} data-testid={`button-publish-event-${eventId}`}>{publish.isPending ? 'Publishing…' : 'Publish'}</button>;
}
function CreateOrganizerEvent() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const profile = useGetMyOrganizer({ query: { queryKey: getGetMyOrganizerQueryKey(), enabled: Boolean(isLoaded && isSignedIn) } });
  const create = useCreateOrganizerEvent();
  const [error, setError] = useState('');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    const maybe = (name: string) => value(name).trim() || null;
    const tags = value('tags').split(',').map(tag => tag.trim()).filter(Boolean);
    const payload: EventInput = {
      title: value('title'), description: value('description'), category: value('category'), tags,
      bannerUrl: value('bannerUrl'), startAt: new Date(value('startAt')).toISOString(),
      endAt: new Date(value('endAt')).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      venue: value('venue'), city: value('city'), mode: value('mode') as EventInput['mode'],
      price: Number(value('price') || 0), currency: value('currency').toUpperCase() || 'USD',
      capacity: value('capacity') ? Number(value('capacity')) : null,
      registrationDeadline: value('registrationDeadline') ? new Date(value('registrationDeadline')).toISOString() : null,
      externalUrl: maybe('externalUrl'),
    };
    create.mutate({ data: payload }, { onSuccess: () => {
      setError('');
      void client.invalidateQueries({ queryKey: getGetOrganizerDashboardQueryKey() });
      setLocation('/organizer');
    }, onError: () => setError('We couldn’t save this event. Check the details and try again.') });
  };
  if (isLoaded && !isSignedIn) return <PageFrame><main className="page-shell"><div className="state-box" style={{ marginTop: 50 }}><h3>Sign in to create an event</h3><p>Your community is waiting to hear from you.</p><button className="btn btn-primary" onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent('/organizer/create')}`)} data-testid="button-sign-in-create">Sign in to continue</button></div></main></PageFrame>;
  if (isLoaded && profile.data === null) return <PageFrame><main className="page-shell"><div className="state-box" style={{ marginTop: 50 }}><h3>Set up your organizer space first</h3><p>Your event will live under an organizer profile.</p><Link href="/organizer" className="btn btn-primary" data-testid="link-setup-organizer">Set up organizer profile</Link></div></main></PageFrame>;
  return <PageFrame><main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: '#7772da' }}>Make the invite</div><h1>Create an event</h1><p>Give people the details they need to say yes.</p></div>
    {profile.isLoading ? <div className="skeleton" /> : profile.isError ? <ErrorState retry={() => void profile.refetch()} /> :
    <form className="form-layout" onSubmit={submit}>
      <h2>Event details</h2>
      <div className="form-grid">
        <div className="form-field full"><label htmlFor="event-title">Event title</label><input className="field" id="event-title" name="title" minLength={5} maxLength={140} required placeholder="Give this gathering a name" data-testid="input-event-title" /></div>
        <div className="form-field"><label htmlFor="event-category">Category</label><input className="field" id="event-category" name="category" required placeholder="Community, learning, arts…" data-testid="input-event-category-create" /></div>
        <div className="form-field"><label htmlFor="event-tags">Tags</label><input className="field" id="event-tags" name="tags" placeholder="Design, newcomers, weekend" data-testid="input-event-tags" /></div>
        <div className="form-field full"><label htmlFor="event-description">Description</label><textarea id="event-description" name="description" minLength={20} maxLength={5000} required placeholder="What will happen, and who should come?" data-testid="input-event-description" /></div>
        <div className="form-field full"><label htmlFor="event-banner">Banner image URL</label><input className="field" type="url" id="event-banner" name="bannerUrl" required placeholder="https://…" data-testid="input-event-banner" /></div>
        <div className="form-field"><label htmlFor="event-start">Starts</label><input className="field" type="datetime-local" id="event-start" name="startAt" required data-testid="input-event-start" /></div>
        <div className="form-field"><label htmlFor="event-end">Ends</label><input className="field" type="datetime-local" id="event-end" name="endAt" required data-testid="input-event-end" /></div>
        <div className="form-field"><label htmlFor="event-venue">Venue</label><input className="field" id="event-venue" name="venue" required placeholder="Place or online room" data-testid="input-event-venue" /></div>
        <div className="form-field"><label htmlFor="event-city">City</label><input className="field" id="event-city" name="city" required placeholder="City" data-testid="input-event-city" /></div>
        <div className="form-field"><label htmlFor="event-mode">Format</label><select className="select" id="event-mode" name="mode" required data-testid="select-event-format"><option value="in-person">In person</option><option value="hybrid">Hybrid</option><option value="online">Online</option></select></div>
        <div className="form-field"><label htmlFor="event-capacity">Capacity (optional)</label><input className="field" type="number" min="1" id="event-capacity" name="capacity" placeholder="No limit" data-testid="input-event-capacity" /></div>
        <div className="form-field"><label htmlFor="event-price">Price</label><input className="field" type="number" min="0" step="0.01" id="event-price" name="price" defaultValue="0" required data-testid="input-event-price" /></div>
        <div className="form-field"><label htmlFor="event-currency">Currency</label><input className="field" id="event-currency" name="currency" defaultValue="USD" minLength={3} maxLength={3} required data-testid="input-event-currency" /></div>
        <div className="form-field"><label htmlFor="event-deadline">Registration deadline (optional)</label><input className="field" type="datetime-local" id="event-deadline" name="registrationDeadline" data-testid="input-registration-deadline" /></div>
        <div className="form-field full"><label htmlFor="event-external">External details URL (optional)</label><input className="field" type="url" id="event-external" name="externalUrl" placeholder="https://…" data-testid="input-event-external-url" /></div>
      </div>
      {error && <p role="alert" style={{ color: '#b42318', fontSize: 12, marginTop: 15 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22 }}><Link href="/organizer" className="btn btn-outline" data-testid="button-cancel-event">Cancel</Link><button className="btn btn-primary" type="submit" disabled={create.isPending} data-testid="button-submit-event">{create.isPending ? 'Saving…' : 'Save as draft'} <ArrowRight size={15} /></button></div>
    </form>}
  </main></PageFrame>;
}
function SignInPage() {
  const requestedReturn = new URLSearchParams(window.location.search).get('redirect_url');
  const returnTo = requestedReturn?.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : undefined;
  return <div className="auth-surface"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={returnTo} /></div>;
}
function SignUpPage() {
  const requestedReturn = new URLSearchParams(window.location.search).get('redirect_url');
  const returnTo = requestedReturn?.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : undefined;
  return <div className="auth-surface"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={returnTo} /></div>;
}
function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded && isSignedIn ? <Redirect to="/discover" /> : <Home />;
}
function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Find the people and plans you love.' } }, signUp: { start: { title: 'Join your local loop', subtitle: 'Make room for something good.' } } }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <ClerkQueryClientCacheInvalidator />
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/discover" component={Discover} />
      <Route path="/events/:eventId" component={EventDetails} />
      <Route path="/my-events" component={MyEvents} />
      <Route path="/organizer/create" component={CreateOrganizerEvent} />
      <Route path="/organizer" component={Organizer} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={NotFound} />
    </Switch>
  </ClerkProvider>;
}
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) client.clear();
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
