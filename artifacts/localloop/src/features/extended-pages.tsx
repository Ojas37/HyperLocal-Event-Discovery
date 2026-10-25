import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { QRCodeSVG } from "qrcode.react";
import { Link, useLocation, useParams } from "wouter";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
} from "react-leaflet";
import {
  getGetAdminDashboardQueryKey,
  getGetEventQueryKey,
  getGetMyAttendanceBadgesQueryKey,
  getGetMyNotificationsQueryKey,
  getGetMyPreferencesQueryKey,
  getGetMyRecommendationsQueryKey,
  getGetOrganizerAttendeesQueryKey,
  getGetOrganizerEventQueryKey,
  getGetCommunityQueryKey,
  getExportOrganizerRegistrationsQueryKey,
  getListAdminReportsQueryKey,
  getListAdminVerificationsQueryKey,
  getListCommunitiesQueryKey,
  getListEventReviewsQueryKey,
  getListEventStaffQueryKey,
  getListEventsQueryKey,
  useAssignAdminRole,
  useAssignEventStaff,
  useCancelOrganizerEvent,
  useCheckInAttendee,
  useCreateCommunity,
  useCreateEventReview,
  useFollowOrganizer,
  useGetAdminDashboard,
  useGetCommunity,
  useGetMyAttendanceBadges,
  useGetMyNotifications,
  useGetMyPreferences,
  useGetOrganizerAttendees,
  useGetOrganizerEvent,
  useExportOrganizerRegistrations,
  useJoinCommunity,
  useLeaveCommunity,
  useListAdminReports,
  useListAdminVerifications,
  useListCommunities,
  useListEventReviews,
  useListEventStaff,
  useMarkNotificationRead,
  useRemoveEventStaff,
  useReportEvent,
  useResolveAdminReport,
  useReviewOrganizerVerification,
  useSuspendAdminUser,
  useUnfollowOrganizer,
  useUnsuspendAdminUser,
  useUpdateMyPreferences,
  useUpdateOrganizerEvent,
  type Event,
  type UpdateEventInput,
} from "@workspace/api-client-react";
import "leaflet/dist/leaflet.css";

function invalidate(client: ReturnType<typeof useQueryClient>, ...keys: ReadonlyArray<readonly unknown[]>) {
  for (const queryKey of keys) void client.invalidateQueries({ queryKey });
}

function SignInNotice({ title, message, path }: { title: string; message: string; path: string }) {
  const [, setLocation] = useLocation();
  return (
    <div className="state-box" style={{ margin: "32px 0" }}>
      <h3>{title}</h3>
      <p>{message}</p>
      <button
        className="btn btn-primary"
        type="button"
        onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent(path)}`)}
        data-testid="button-sign-in-protected"
      >
        Sign in to continue
      </button>
    </div>
  );
}

export function TicketPanel({ event }: { event: Event }) {
  if (event.status === "cancelled") {
    return <div className="ticket-panel ticket-muted" data-testid={`status-ticket-cancelled-${event.id}`}>This event was cancelled. The ticket is no longer valid.</div>;
  }
  if (event.rsvpStatus === "waitlisted") {
    return <div className="ticket-panel ticket-muted" data-testid={`status-ticket-waitlisted-${event.id}`}>You’re on the waitlist. A ticket will appear if a place opens.</div>;
  }
  if (event.rsvpStatus === "cancelled") {
    return <div className="ticket-panel ticket-muted" data-testid={`status-ticket-rsvp-cancelled-${event.id}`}>Your registration was cancelled.</div>;
  }
  if (event.rsvpStatus !== "confirmed" || !event.rsvpRegistrationCode) return null;
  return (
    <section className="ticket-panel" aria-label={`Ticket for ${event.title}`} data-testid={`ticket-panel-${event.id}`}>
      <div>
        <div className="eyebrow" style={{ color: "#7772da" }}>Your ticket</div>
        <strong>{event.title}</strong>
        <p>{eventDateLabel(event.startAt)} · {event.city}</p>
        {event.rsvpCheckedInAt ? (
          <span className="status-tag" data-testid={`status-checked-in-${event.id}`}>Attendance verified</span>
        ) : (
          <>
            <code className="registration-code" data-testid={`text-ticket-code-${event.id}`}>{event.rsvpRegistrationCode}</code>
            <small>Show this QR code to the event check-in team.</small>
          </>
        )}
      </div>
      {!event.rsvpCheckedInAt && (
        <QRCodeSVG
          value={event.rsvpRegistrationCode}
          size={128}
          level="M"
          includeMargin
          aria-label={`Check-in QR code for ${event.title}`}
          data-testid={`qr-ticket-${event.id}`}
        />
      )}
    </section>
  );
}

function eventDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function EventMap({ events }: { events: Event[] }) {
  const mapped = events.filter(
    (event) =>
      typeof event.latitude === "number" &&
      typeof event.longitude === "number" &&
      event.latitude >= -90 &&
      event.latitude <= 90 &&
      event.longitude >= -180 &&
      event.longitude <= 180,
  );
  return (
    <div className="map-frame" data-testid="event-map">
      <MapContainer center={[20.5937, 78.9629]} zoom={4} scrollWheelZoom className="event-map-canvas">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {mapped.map((event) => (
          <Marker key={event.id} position={[event.latitude!, event.longitude!]}>
            <Popup>
              <div className="map-popup">
                <strong>{event.title}</strong>
                <p>{event.city} · {eventDateLabel(event.startAt)}</p>
                <Link href={`/events/${event.id}`}>View event</Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {!mapped.length && (
        <div className="map-empty-note" data-testid="status-map-no-coordinates">
          No listings in this result have verified map coordinates. Switch to the list or search by city.
        </div>
      )}
    </div>
  );
}

export function EventEngagement({ event }: { event: Event }) {
  const { isSignedIn } = useAuth();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const follow = useFollowOrganizer();
  const unfollow = useUnfollowOrganizer();
  const report = useReportEvent();
  const reviews = useListEventReviews(event.id, {
    query: { queryKey: getListEventReviewsQueryKey(event.id) },
  });
  const createReview = useCreateEventReview();
  const [reportReason, setReportReason] = useState("misleading");
  const [reportDetails, setReportDetails] = useState("");
  const [rating, setRating] = useState("5");
  const [reviewText, setReviewText] = useState("");
  const [status, setStatus] = useState("");

  const signedIn = (redirect: string) => {
    if (isSignedIn) return true;
    setLocation(`/sign-in?redirect_url=${encodeURIComponent(redirect)}`);
    return false;
  };
  const toggleFollow = () => {
    if (!signedIn(`/events/${event.id}`)) return;
    const mutation = event.organizerFollowing ? unfollow : follow;
    mutation.mutate({ organizerId: event.organizer.id }, {
      onSuccess: () => {
        setStatus(event.organizerFollowing ? "Organizer unfollowed." : "Organizer followed.");
        invalidate(client, getGetEventQueryKey(event.id), getListEventsQueryKey());
      },
      onError: () => setStatus("Could not update your organizer follow. Please try again."),
    });
  };
  const submitReport = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!signedIn(`/events/${event.id}`)) return;
    report.mutate(
      { eventId: event.id, data: { reason: reportReason as "spam" | "misleading" | "unsafe" | "inappropriate" | "other", details: reportDetails } },
      {
        onSuccess: () => setStatus("Thanks. Your report has been sent to the moderation team."),
        onError: () => setStatus("This report could not be submitted. You may already have reported this event."),
      },
    );
  };
  const submitReview = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!signedIn(`/events/${event.id}`)) return;
    createReview.mutate(
      { eventId: event.id, data: { rating: Number(rating), content: reviewText } },
      {
        onSuccess: () => {
          setReviewText("");
          setStatus("Your review has been added.");
          void client.invalidateQueries({ queryKey: getListEventReviewsQueryKey(event.id) });
        },
        onError: () => setStatus("A review requires verified attendance, and each attendee can review once."),
      },
    );
  };
  return (
    <section className="engagement-panel">
      <div className="engagement-actions">
        <button className="btn btn-outline btn-sm" type="button" onClick={toggleFollow} disabled={follow.isPending || unfollow.isPending} data-testid="button-follow-organizer">
          {event.organizerFollowing ? "Following organizer" : `Follow ${event.organizer.name}`}
        </button>
        <details className="report-disclosure">
          <summary className="btn btn-quiet btn-sm" data-testid="button-report-event">Report event</summary>
          <form className="mini-form" onSubmit={submitReport}>
            <label>Reason
              <select className="select" value={reportReason} onChange={(e) => setReportReason(e.target.value)} data-testid="select-report-reason">
                <option value="misleading">Misleading details</option><option value="spam">Spam</option><option value="unsafe">Safety concern</option><option value="inappropriate">Inappropriate</option><option value="other">Other</option>
              </select>
            </label>
            <label>Details <textarea value={reportDetails} maxLength={2000} onChange={(e) => setReportDetails(e.target.value)} data-testid="input-report-details" /></label>
            <button className="btn btn-primary btn-sm" type="submit" disabled={report.isPending} data-testid="button-submit-report">Send report</button>
          </form>
        </details>
      </div>
      {status && <p className="inline-status" role="status" data-testid="status-event-engagement">{status}</p>}
      <h2>Attendee feedback</h2>
      {reviews.isLoading ? <p>Loading reviews…</p> : reviews.isError ? <p>Reviews are unavailable right now.</p> : reviews.data?.length ? (
        <div className="review-list">{reviews.data.map((review) => (
          <article className="review-card" key={review.id} data-testid={`review-${review.id}`}>
            <div className="review-heading"><strong>{review.reviewerLabel}</strong><span aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span></div>
            <p>{review.content || "Attended this event."}</p>
            <small>{eventDateLabel(review.createdAt)}</small>
          </article>
        ))}</div>
      ) : <p>No attendee feedback yet.</p>}
      {event.rsvpCheckedInAt && (
        <form className="mini-form review-form" onSubmit={submitReview}>
          <h3>Share your experience</h3>
          <label>Rating
            <select className="select" value={rating} onChange={(e) => setRating(e.target.value)} data-testid="select-review-rating">
              {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} out of 5</option>)}
            </select>
          </label>
          <label>Your feedback <textarea value={reviewText} maxLength={2000} onChange={(e) => setReviewText(e.target.value)} data-testid="input-review-content" /></label>
          <button className="btn btn-primary btn-sm" type="submit" disabled={createReview.isPending} data-testid="button-submit-review">Post review</button>
        </form>
      )}
    </section>
  );
}

export function CheckInPage() {
  const params = useParams<{ eventId: string }>();
  const eventId = Number(params.eventId);
  const client = useQueryClient();
  const roster = useGetOrganizerAttendees(eventId, {
    query: { queryKey: getGetOrganizerAttendeesQueryKey(eventId), enabled: Number.isInteger(eventId) && eventId > 0 },
  });
  const staff = useListEventStaff(eventId, {
    query: { queryKey: getListEventStaffQueryKey(eventId), enabled: Number.isInteger(eventId) && eventId > 0 },
  });
  const checkIn = useCheckInAttendee();
  const assignStaff = useAssignEventStaff();
  const removeStaff = useRemoveEventStaff();
  const [code, setCode] = useState("");
  const [staffId, setStaffId] = useState("");
  const [message, setMessage] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControls = useRef<{ stop: () => void } | null>(null);
  const checkInRef = useRef(checkIn.mutate);
  checkInRef.current = checkIn.mutate;

  const submitCode = (value: string) => {
    const registrationCode = value.trim();
    if (!registrationCode) return;
    checkIn.mutate(
      { eventId, data: { registrationCode } },
      {
        onSuccess: (result) => {
          setCode("");
          setMessage(result.alreadyCheckedIn ? `${result.attendeeRef} was already checked in.` : `${result.attendeeRef} checked in successfully.`);
          invalidate(client, getGetOrganizerAttendeesQueryKey(eventId), getGetMyAttendanceBadgesQueryKey(), getGetMyNotificationsQueryKey());
        },
        onError: () => setMessage("That code is invalid for this event, or this registration is not eligible for check-in."),
      },
    );
  };

  const stopScanner = () => {
    scannerControls.current?.stop();
    scannerControls.current = null;
    setScannerOpen(false);
  };
  const submitCodeRef = useRef(submitCode);
  submitCodeRef.current = submitCode;
  const startScanner = () => {
    setScannerError("");
    setScannerOpen(true);
  };
  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
      if (!result || cancelled) return;
      const scannedCode = result.getText();
      scannerControls.current?.stop();
      scannerControls.current = null;
      setScannerOpen(false);
      submitCodeRef.current(scannedCode);
    }).then((controls) => {
      if (cancelled) controls.stop();
      else scannerControls.current = controls;
    }).catch(() => {
      if (cancelled) return;
      setScannerError("Camera access is unavailable. You can still enter a registration code below.");
      setScannerOpen(false);
    });
    return () => {
      cancelled = true;
      scannerControls.current?.stop();
      scannerControls.current = null;
    };
  }, [scannerOpen]);

  const submitManual = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitCode(code);
  };
  const submitStaff = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    assignStaff.mutate(
      { eventId, data: { userId: staffId.trim() } },
      {
        onSuccess: () => {
          setStaffId("");
          setMessage("Check-in staff added.");
          void client.invalidateQueries({ queryKey: getListEventStaffQueryKey(eventId) });
        },
        onError: () => setMessage("Staff could not be added. Check the user ID and your organizer access."),
      },
    );
  };

  return (
    <main className="page-shell">
      <div className="page-title">
        <div className="eyebrow" style={{ color: "#7772da" }}>Organizer tools</div>
        <h1>Event check-in</h1>
        <p>Scan the attendee’s ticket or enter their registration code.</p>
      </div>
      {roster.isLoading ? <div className="skeleton" /> : roster.isError ? (
        <div className="state-box" role="alert"><h3>Check-in access required</h3><p>Only this event’s organizer or assigned staff can view the attendee roster.</p><Link href="/organizer" className="btn btn-outline btn-sm">Back to organizer studio</Link></div>
      ) : roster.data && <>
        <div className="dash-stats">
          <div className="stat-card"><span>Confirmed registrations</span><strong data-testid="text-registered-count">{roster.data.registeredCount}</strong></div>
          <div className="stat-card"><span>Checked in</span><strong data-testid="text-checked-in-count">{roster.data.checkedInCount}</strong></div>
          <div className="stat-card"><span>Attendance rate</span><strong data-testid="text-attendance-rate">{Math.round(roster.data.attendanceRate)}%</strong></div>
        </div>
        <div className="checkin-grid">
          <section className="form-layout checkin-card">
            <h2>Scan a ticket</h2>
            <p>Camera access is requested only after you start the scanner.</p>
            {!scannerOpen ? <button className="btn btn-primary" type="button" onClick={() => void startScanner()} data-testid="button-start-scanner">Start camera scanner</button> : (
              <div className="scanner-stage">
                <video ref={videoRef} autoPlay muted playsInline data-testid="video-ticket-scanner" />
                <button className="btn btn-outline btn-sm" type="button" onClick={stopScanner} data-testid="button-stop-scanner">Stop scanner</button>
              </div>
            )}
            {scannerError && <p role="alert" className="inline-status">{scannerError}</p>}
            <form className="mini-form" onSubmit={submitManual}>
              <label>Registration code <input className="field" value={code} onChange={(e) => setCode(e.target.value)} minLength={12} maxLength={128} autoComplete="off" data-testid="input-registration-code" /></label>
              <button className="btn btn-outline btn-sm" type="submit" disabled={checkIn.isPending} data-testid="button-manual-checkin">Check in attendee</button>
            </form>
            {message && <p role="status" className="inline-status" data-testid="status-checkin-result">{message}</p>}
          </section>
          <section className="form-layout checkin-card">
            <h2>Check-in staff</h2>
            <p>Assigned staff can scan tickets and view this event’s roster.</p>
            <form className="mini-form" onSubmit={submitStaff}>
              <label>Clerk user ID <input className="field" value={staffId} onChange={(e) => setStaffId(e.target.value)} maxLength={128} data-testid="input-event-staff-id" /></label>
              <button className="btn btn-outline btn-sm" type="submit" disabled={assignStaff.isPending} data-testid="button-assign-staff">Add staff</button>
            </form>
            {staff.isError ? <p>Staff assignments are visible to the event organizer.</p> : staff.data?.map((member) => (
              <div className="staff-row" key={member.userId}>
                <span>{member.userId} · check-in access</span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => removeStaff.mutate({ eventId, userId: member.userId }, { onSuccess: () => void client.invalidateQueries({ queryKey: getListEventStaffQueryKey(eventId) }) })} data-testid={`button-remove-staff-${member.userId}`}>Remove</button>
              </div>
            ))}
          </section>
        </div>
        <div className="section-head"><div><h2>Attendee roster</h2><p>Names and account details stay private; references are shown instead.</p></div></div>
        <div className="table-wrap"><table className="event-table"><thead><tr><th>Attendee</th><th>Status</th><th>Registered</th><th>Check-in</th></tr></thead><tbody>
          {roster.data.attendees.map((attendee) => <tr key={attendee.id} data-testid={`row-attendee-${attendee.id}`}><td>{attendee.attendeeRef}</td><td><span className="status-tag">{attendee.status}</span></td><td>{eventDateLabel(attendee.registeredAt)}</td><td>{attendee.checkedInAt ? `Checked in ${eventDateLabel(attendee.checkedInAt)}` : "Not checked in"}</td></tr>)}
          {!roster.data.attendees.length && <tr><td colSpan={4}>No registrations yet.</td></tr>}
        </tbody></table></div>
      </>}
    </main>
  );
}

function toLocalInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function EditEventPage() {
  const params = useParams<{ eventId: string }>();
  const eventId = Number(params.eventId);
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const eventQuery = useGetOrganizerEvent(eventId, {
    query: { queryKey: getGetOrganizerEventQueryKey(eventId), enabled: Number.isInteger(eventId) && eventId > 0 },
  });
  const update = useUpdateOrganizerEvent();
  const [message, setMessage] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");
    const maybe = (key: string) => value(key).trim() || null;
    const latitudeText = value("latitude").trim();
    const longitudeText = value("longitude").trim();
    if ((latitudeText === "") !== (longitudeText === "")) {
      setMessage("Enter both coordinates or leave both blank.");
      return;
    }
    const payload: UpdateEventInput = {
      title: value("title"),
      description: value("description"),
      category: value("category"),
      tags: value("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
      bannerUrl: value("bannerUrl"),
      startAt: new Date(value("startAt")).toISOString(),
      endAt: new Date(value("endAt")).toISOString(),
      timezone: value("timezone"),
      venue: value("venue"),
      city: value("city"),
      latitude: latitudeText ? Number(latitudeText) : null,
      longitude: longitudeText ? Number(longitudeText) : null,
      mode: value("mode") as UpdateEventInput["mode"],
      price: Number(value("price") || 0),
      currency: value("currency").toUpperCase(),
      capacity: value("capacity") ? Number(value("capacity")) : null,
      registrationDeadline: value("registrationDeadline") ? new Date(value("registrationDeadline")).toISOString() : null,
      externalUrl: maybe("externalUrl"),
    };
    update.mutate({ eventId, data: payload }, {
      onSuccess: () => {
        setMessage("Event changes saved. Registered attendees have been notified.");
        invalidate(client, getGetOrganizerEventQueryKey(eventId), getGetEventQueryKey(eventId), getListEventsQueryKey());
      },
      onError: () => setMessage("We couldn’t save the event. Check the details and try again."),
    });
  };
  if (eventQuery.isLoading) return <main className="page-shell"><div className="page-title"><h1>Loading event…</h1></div></main>;
  if (eventQuery.isError || !eventQuery.data) return <main className="page-shell"><div className="state-box"><h3>Event not available</h3><p>Only the event organizer can edit this listing.</p><Link className="btn btn-outline btn-sm" href="/organizer">Back to organizer studio</Link></div></main>;
  const event = eventQuery.data;
  return <main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: "#7772da" }}>Organizer tools</div><h1>Edit event</h1><p>Changes are saved to the existing listing and notify current registrants.</p></div>
    <form className="form-layout" onSubmit={submit}>
      <h2>{event.title}</h2>
      <div className="form-grid">
        <Field label="Event title" name="title" defaultValue={event.title} required />
        <Field label="Category" name="category" defaultValue={event.category} required />
        <Field label="Tags (comma separated)" name="tags" defaultValue={event.tags.join(", ")} />
        <Field label="Banner image URL" name="bannerUrl" defaultValue={event.bannerUrl} required />
        <Field label="Starts" name="startAt" type="datetime-local" defaultValue={toLocalInput(event.startAt)} required />
        <Field label="Ends" name="endAt" type="datetime-local" defaultValue={toLocalInput(event.endAt)} required />
        <Field label="Timezone" name="timezone" defaultValue={event.timezone} required />
        <Field label="Venue" name="venue" defaultValue={event.venue} required />
        <Field label="City or area" name="city" defaultValue={event.city} required />
        <div className="form-field"><label htmlFor="edit-event-mode">Format</label><select className="select" name="mode" id="edit-event-mode" defaultValue={event.mode} data-testid="select-edit-event-mode"><option value="in-person">In person</option><option value="hybrid">Hybrid</option><option value="online">Online</option></select></div>
        <Field label="Price" name="price" type="number" min="0" step="0.01" defaultValue={String(event.price)} required />
        <Field label="Currency" name="currency" defaultValue={event.currency} required />
        <Field label="Capacity" name="capacity" type="number" min="1" defaultValue={event.capacity ? String(event.capacity) : ""} />
        <Field label="Registration deadline" name="registrationDeadline" type="datetime-local" defaultValue={event.registrationDeadline ? toLocalInput(event.registrationDeadline) : ""} />
        <Field label="Latitude (optional)" name="latitude" type="number" min="-90" max="90" step="any" defaultValue={event.latitude === null ? "" : String(event.latitude)} />
        <Field label="Longitude (optional)" name="longitude" type="number" min="-180" max="180" step="any" defaultValue={event.longitude === null ? "" : String(event.longitude)} />
        <Field label="More details URL" name="externalUrl" type="url" defaultValue={event.externalUrl ?? ""} />
        <div className="form-field full"><label htmlFor="edit-description">Description</label><textarea id="edit-description" name="description" minLength={20} maxLength={5000} defaultValue={event.description} required data-testid="input-edit-event-description" /></div>
      </div>
      {message && <p role="status" className="inline-status" data-testid="status-edit-event">{message}</p>}
      <div className="form-actions"><Link className="btn btn-outline" href="/organizer">Cancel</Link><button className="btn btn-primary" type="submit" disabled={update.isPending} data-testid="button-save-event-changes">{update.isPending ? "Saving…" : "Save changes"}</button></div>
    </form>
  </main>;
}

function Field({ label, name, defaultValue, type = "text", required = false, min, max, step }: {
  label: string; name: string; defaultValue?: string; type?: string; required?: boolean;
  min?: string; max?: string; step?: string;
}) {
  return <div className="form-field"><label htmlFor={`field-${name}`}>{label}</label><input className="field" id={`field-${name}`} name={name} type={type} defaultValue={defaultValue} required={required} min={min} max={max} step={step} data-testid={`input-${name}`} /></div>;
}

export function OrganizerEventActions({ event }: { event: Event }) {
  const client = useQueryClient();
  const cancel = useCancelOrganizerEvent();
  const [message, setMessage] = useState("");
  const cancelEvent = () => {
    if (!window.confirm("Cancel this event? All active registrants will receive an in-app notification, and tickets will no longer be valid.")) return;
    cancel.mutate({ eventId: event.id }, {
      onSuccess: () => {
        setMessage("Event cancelled. Registered attendees were notified.");
        invalidate(client, getGetEventQueryKey(event.id), getListEventsQueryKey());
      },
      onError: () => setMessage("This event could not be cancelled."),
    });
  };
  return <div className="organizer-row-actions">
    <Link className="btn btn-quiet btn-sm" href={`/organizer/events/${event.id}/edit`} data-testid={`link-edit-event-${event.id}`}>Edit</Link>
    {event.status === "published" && <Link className="btn btn-quiet btn-sm" href={`/organizer/events/${event.id}/check-in`} data-testid={`link-checkin-event-${event.id}`}>Check-in</Link>}
    {event.status === "published" && <ExportRegistrationsButton eventId={event.id} />}
    {event.status === "published" && <button type="button" className="btn btn-outline btn-sm" disabled={cancel.isPending} onClick={cancelEvent} data-testid={`button-cancel-published-event-${event.id}`}>Cancel event</button>}
    {message && <span role="status" className="inline-status">{message}</span>}
  </div>;
}

function ExportRegistrationsButton({ eventId }: { eventId: number }) {
  const exportQuery = useExportOrganizerRegistrations(eventId, {
    query: { queryKey: getExportOrganizerRegistrationsQueryKey(eventId), enabled: false },
  });
  const [message, setMessage] = useState("");
  const download = async () => {
    setMessage("");
    const result = await exportQuery.refetch();
    if (result.error || result.data === undefined) {
      setMessage("Registration export is available to the event organizer.");
      return;
    }
    const content = result.data;
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `event-${eventId}-registrations.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <>
    <button type="button" className="btn btn-outline btn-sm" onClick={() => void download()} disabled={exportQuery.isFetching} data-testid={`button-export-registrations-${eventId}`}>{exportQuery.isFetching ? "Preparing…" : "Export CSV"}</button>
    {message && <span className="inline-status" role="status">{message}</span>}
  </>;
}

export function ActivityPanel() {
  const client = useQueryClient();
  const notifications = useGetMyNotifications({ query: { queryKey: getGetMyNotificationsQueryKey() } });
  const badges = useGetMyAttendanceBadges({ query: { queryKey: getGetMyAttendanceBadgesQueryKey() } });
  const markRead = useMarkNotificationRead();
  return <div className="activity-grid">
    <section className="activity-card">
      <h2>Notifications</h2>
      {notifications.isLoading ? <p>Loading notifications…</p> : notifications.isError ? <p>Notifications are unavailable.</p> : !notifications.data?.length ? <p>No new updates yet.</p> :
        notifications.data.slice(0, 6).map((item) => <article className={`notice-row ${item.readAt ? "notice-read" : ""}`} key={item.id} data-testid={`notification-${item.id}`}>
          <div><strong>{item.title}</strong><p>{item.body}</p><small>{eventDateLabel(item.createdAt)}</small></div>
          {!item.readAt && <button className="btn btn-quiet btn-sm" type="button" onClick={() => markRead.mutate({ notificationId: item.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() }) })} data-testid={`button-mark-read-${item.id}`}>Mark read</button>}
        </article>)}
    </section>
    <section className="activity-card">
      <h2>Attendance badges</h2>
      {badges.isLoading ? <p>Loading badges…</p> : badges.isError ? <p>Badges are unavailable.</p> : !badges.data?.length ? <p>Your badges appear after an organizer verifies your event check-in.</p> :
        badges.data.map((badge) => <div className="badge-row" key={badge.eventId} data-testid={`attendance-badge-${badge.eventId}`}><span className="badge-mark">✓</span><div><strong>{badge.eventTitle}</strong><small>Verified {eventDateLabel(badge.issuedAt)}</small></div></div>)}
    </section>
  </div>;
}

export function CommunitiesPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const client = useQueryClient();
  const [city, setCity] = useState("");
  const [status, setStatus] = useState("");
  const params = useMemo(() => city.trim() ? { city: city.trim() } : undefined, [city]);
  const communities = useListCommunities(params, {
    query: { queryKey: getListCommunitiesQueryKey(params) },
  });
  const create = useCreateCommunity();
  const join = useJoinCommunity();
  const leave = useLeaveCommunity();
  const [formOpen, setFormOpen] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    create.mutate(
      { data: { name: value("name"), description: value("description"), topics: value("topics").split(",").map((item) => item.trim()).filter(Boolean), city: value("city").trim() || null } },
      {
        onSuccess: () => {
          setFormOpen(false);
          setStatus("Community created.");
          void client.invalidateQueries({ queryKey: getListCommunitiesQueryKey() });
        },
        onError: () => setStatus("Community could not be created. An organizer profile is required."),
      },
    );
  };
  return <main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: "#7772da" }}>Find your people</div><h1>Communities</h1><p>Join local groups around the topics and events you care about.</p></div>
    <div className="community-tools">
      <input className="field" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Filter by city or area" aria-label="Filter communities by city" data-testid="input-community-city" />
      {isSignedIn && <button className="btn btn-primary btn-sm" type="button" onClick={() => setFormOpen((open) => !open)} data-testid="button-create-community">{formOpen ? "Close form" : "Create a community"}</button>}
    </div>
    {formOpen && <form className="form-layout community-form" onSubmit={submit}>
      <h2>Create a community</h2>
      <div className="form-grid">
        <Field label="Community name" name="name" required />
        <Field label="Topics (comma separated)" name="topics" />
        <Field label="City or area" name="city" />
        <div className="form-field full"><label htmlFor="community-description">Description</label><textarea id="community-description" name="description" minLength={10} maxLength={2000} required data-testid="input-community-description" /></div>
      </div>
      <button className="btn btn-primary" type="submit" disabled={create.isPending} data-testid="button-submit-community">{create.isPending ? "Creating…" : "Create community"}</button>
    </form>}
    {status && <p role="status" className="inline-status">{status}</p>}
    {communities.isLoading ? <div className="skeleton" /> : communities.isError ? <div className="state-box"><h3>Communities are unavailable</h3><button className="btn btn-outline btn-sm" type="button" onClick={() => void communities.refetch()}>Try again</button></div> :
      communities.data?.length ? <div className="community-grid">{communities.data.map((community) => <article className="community-card" key={community.id} data-testid={`community-card-${community.id}`}>
        <div className="eyebrow" style={{ color: "#7772da" }}>{community.city || "Local community"} · {community.memberCount} members</div>
        <h2><Link href={`/communities/${community.slug}`}>{community.name}</Link></h2><p>{community.description}</p>
        <div className="topic-list">{community.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
        <div className="community-card-actions"><Link className="btn btn-quiet btn-sm" href={`/communities/${community.slug}`}>Explore</Link>
          {isLoaded && isSignedIn && <button className="btn btn-outline btn-sm" type="button" onClick={() => (community.isMember ? leave : join).mutate({ communityId: community.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getListCommunitiesQueryKey() }) })} data-testid={`${community.isMember ? "button-leave" : "button-join"}-community-${community.id}`}>{community.isMember ? "Leave" : "Join"}</button>}
        </div>
      </article>)}</div> : <div className="state-box" data-testid="status-no-communities"><h3>No communities in this area yet</h3><p>Try another city or check back as local groups join.</p></div>}
    {!isLoaded && <p className="muted-copy">Checking your sign-in status…</p>}
  </main>;
}

export function CommunityDetailPage() {
  const params = useParams<{ slug: string }>();
  const client = useQueryClient();
  const { isSignedIn } = useAuth();
  const slug = params.slug ?? "";
  const query = useGetCommunity(slug, { query: { queryKey: getGetCommunityQueryKey(slug), enabled: Boolean(slug) } });
  const join = useJoinCommunity();
  const leave = useLeaveCommunity();
  if (query.isLoading) return <main className="page-shell"><div className="skeleton" /></main>;
  if (query.isError || !query.data) return <main className="page-shell"><div className="state-box"><h3>Community not found</h3><p>This community may have been removed or is not public.</p><Link className="btn btn-outline btn-sm" href="/communities">Browse communities</Link></div></main>;
  const { community, events } = query.data;
  return <main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: "#7772da" }}>{community.city || "Local community"} · {community.memberCount} members</div><h1>{community.name}</h1><p>{community.description}</p></div>
    <div className="topic-list">{community.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
    {isSignedIn && <button className="btn btn-primary btn-sm" type="button" onClick={() => (community.isMember ? leave : join).mutate({ communityId: community.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getGetCommunityQueryKey(slug) }) })} data-testid="button-community-membership">{community.isMember ? "Leave community" : "Join community"}</button>}
    <div className="section-head"><div><h2>Upcoming events</h2><p>Public events hosted by this community’s organizer.</p></div></div>
    {events.length ? <div className="community-event-list">{events.map((event) => <Link className="community-event-row" href={`/events/${event.id}`} key={event.id} data-testid={`link-community-event-${event.id}`}><div><strong>{event.title}</strong><span>{eventDateLabel(event.startAt)} · {event.city}</span></div><span className="btn btn-quiet btn-sm">View event</span></Link>)}</div> : <div className="state-box"><h3>No upcoming events listed</h3><p>Check back for the next community gathering.</p></div>}
  </main>;
}

export function PreferencesPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const client = useQueryClient();
  const query = useGetMyPreferences({ query: { queryKey: getGetMyPreferencesQueryKey(), enabled: Boolean(isLoaded && isSignedIn) } });
  const update = useUpdateMyPreferences();
  const [message, setMessage] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    update.mutate(
      { data: {
        interests: String(form.get("interests") ?? "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 15),
        homeCity: String(form.get("homeCity") ?? "").trim() || null,
        preferredRadiusKm: Number(form.get("radius")),
        showAttendanceBadges: form.get("showAttendanceBadges") === "on",
        profileVisibility: String(form.get("profileVisibility")) as "private" | "community" | "public",
      } },
      {
        onSuccess: () => {
          setMessage("Your discovery and privacy settings are saved.");
          invalidate(client, getGetMyPreferencesQueryKey(), getGetMyRecommendationsQueryKey());
        },
        onError: () => setMessage("Settings could not be saved. Please check the values and try again."),
      },
    );
  };
  if (isLoaded && !isSignedIn) return <main className="page-shell"><SignInNotice title="Sign in to manage settings" message="Your interests and privacy controls are attached to your account." path="/settings" /></main>;
  if (query.isLoading) return <main className="page-shell"><div className="skeleton" /></main>;
  if (query.isError || !query.data) return <main className="page-shell"><div className="state-box"><h3>Settings unavailable</h3><p>Sign in to load your saved preferences.</p></div></main>;
  const preferences = query.data;
  return <main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: "#7772da" }}>Make it yours</div><h1>Discovery & privacy</h1><p>Choose the topics and area LocalLoop uses to personalize event suggestions.</p></div>
    <form className="form-layout" onSubmit={submit}>
      <div className="form-grid">
        <div className="form-field full"><label htmlFor="preference-interests">Interests (comma separated)</label><input className="field" id="preference-interests" name="interests" defaultValue={preferences.interests.join(", ")} placeholder="AI, design, community" data-testid="input-preference-interests" /></div>
        <Field label="Home city or area" name="homeCity" defaultValue={preferences.homeCity ?? ""} />
        <div className="form-field"><label htmlFor="preference-radius">Preferred radius (km)</label><input className="field" id="preference-radius" name="radius" type="number" min="1" max="500" defaultValue={preferences.preferredRadiusKm} required data-testid="input-preference-radius" /></div>
        <div className="form-field"><label htmlFor="preference-visibility">Profile visibility</label><select className="select" id="preference-visibility" name="profileVisibility" defaultValue={preferences.profileVisibility} data-testid="select-profile-visibility"><option value="private">Private</option><option value="community">Community members</option><option value="public">Public</option></select></div>
        <label className="check-field"><input type="checkbox" name="showAttendanceBadges" defaultChecked={preferences.showAttendanceBadges} data-testid="checkbox-show-attendance-badges" /> Show verified attendance badges where profile visibility allows</label>
      </div>
      {message && <p role="status" className="inline-status" data-testid="status-preferences">{message}</p>}
      <button className="btn btn-primary" type="submit" disabled={update.isPending} data-testid="button-save-preferences">{update.isPending ? "Saving…" : "Save settings"}</button>
    </form>
  </main>;
}

export function AdminPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const client = useQueryClient();
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey(), enabled: Boolean(isLoaded && isSignedIn) } });
  const reports = useListAdminReports({ query: { queryKey: getListAdminReportsQueryKey(), enabled: Boolean(isLoaded && isSignedIn) } });
  const verifications = useListAdminVerifications({ query: { queryKey: getListAdminVerificationsQueryKey(), enabled: Boolean(isLoaded && isSignedIn) } });
  const resolve = useResolveAdminReport();
  const verify = useReviewOrganizerVerification();
  const suspend = useSuspendAdminUser();
  const unsuspend = useUnsuspendAdminUser();
  const assignRole = useAssignAdminRole();
  const [message, setMessage] = useState("");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [roleEnabled, setRoleEnabled] = useState(true);
  if (isLoaded && !isSignedIn) return <main className="page-shell"><SignInNotice title="Moderation access" message="Sign in with an administrator or moderator account to continue." path="/admin" /></main>;
  if (!isLoaded || dashboard.isLoading || !dashboard.data) return <main className="page-shell"><div className="skeleton" /></main>;
  if (dashboard.isError) return <main className="page-shell"><div className="state-box"><h3>Admin access required</h3><p>This dashboard is restricted to LocalLoop administrators and moderators.</p></div></main>;
  const refresh = () => {
    invalidate(client, getGetAdminDashboardQueryKey(), getListAdminReportsQueryKey(), getListAdminVerificationsQueryKey());
  };
  const submitUserAction = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const userId = targetId.trim();
    if (!userId) return;
    if (reason.trim()) {
      suspend.mutate({ userId, data: { reason: reason.trim() } }, { onSuccess: () => { setMessage("Account suspended."); setReason(""); refresh(); }, onError: () => setMessage("Could not suspend that account. Administrator access is required.") });
    } else {
      assignRole.mutate({ userId, data: { role: "moderator", enabled: roleEnabled } }, { onSuccess: () => setMessage(roleEnabled ? "Moderator role assigned." : "Moderator role removed."), onError: () => setMessage("Could not update the moderator role.") });
    }
  };
  return <main className="page-shell">
    <div className="page-title"><div className="eyebrow" style={{ color: "#7772da" }}>Trust & safety</div><h1>Moderation dashboard</h1><p>Review reports and verification requests. Sensitive account actions require administrator access.</p></div>
    <div className="dash-stats">
      <div className="stat-card"><span>Open reports</span><strong data-testid="text-open-reports">{dashboard.data.openReports}</strong></div>
      <div className="stat-card"><span>Pending verifications</span><strong data-testid="text-pending-verifications">{dashboard.data.pendingVerifications}</strong></div>
      <div className="stat-card"><span>Suspended accounts</span><strong data-testid="text-suspended-accounts">{dashboard.data.suspendedUsers}</strong></div>
    </div>
    {message && <p className="inline-status" role="status" data-testid="status-admin-action">{message}</p>}
    <div className="admin-columns">
      <section><div className="section-head"><div><h2>Event reports</h2><p>Review and resolve member reports.</p></div></div>
        {reports.isLoading ? <div className="skeleton" /> : reports.isError ? <p>Report queue unavailable.</p> : reports.data?.filter((report) => report.status === "open").length ? reports.data.filter((report) => report.status === "open").map((report) => <article className="admin-card" key={report.id} data-testid={`admin-report-${report.id}`}>
          <div className="eyebrow" style={{ color: "#7772da" }}>{report.reason} · report #{report.id}</div><h3>{report.eventTitle}</h3><p>{report.details || "No additional details provided."}</p><small>Reported by {report.reporterId} · {eventDateLabel(report.createdAt)}</small>
          <div className="form-actions"><button className="btn btn-outline btn-sm" type="button" onClick={() => resolve.mutate({ reportId: report.id, data: { status: "dismissed", cancelEvent: false } }, { onSuccess: refresh, onError: () => setMessage("This report could not be dismissed.") })} data-testid={`button-dismiss-report-${report.id}`}>Dismiss</button><button className="btn btn-primary btn-sm" type="button" onClick={() => { if (!window.confirm("Cancel this reported event and notify its active registrants?")) return; resolve.mutate({ reportId: report.id, data: { status: "actioned", cancelEvent: true } }, { onSuccess: refresh, onError: () => setMessage("Only an administrator can cancel an event from this report.") }); }} data-testid={`button-cancel-reported-event-${report.id}`}>Cancel event</button></div>
        </article>) : <div className="state-box"><h3>No open reports</h3><p>The moderation queue is clear.</p></div>}
      </section>
      <section><div className="section-head"><div><h2>Organizer verification</h2><p>Approve or reject requests from organizers.</p></div></div>
        {verifications.isLoading ? <div className="skeleton" /> : verifications.isError ? <p>Verification requests require administrator access.</p> : verifications.data?.length ? verifications.data.map((item) => <article className="admin-card" key={item.id} data-testid={`verification-request-${item.id}`}>
          <div className="eyebrow" style={{ color: "#7772da" }}>{item.type}</div><h3>{item.name}</h3><p>{item.description || "No description provided."}</p><small>Requested {item.requestedAt ? eventDateLabel(item.requestedAt) : "date unavailable"}</small>
          <div className="form-actions"><button className="btn btn-outline btn-sm" type="button" onClick={() => verify.mutate({ organizerId: item.id, data: { status: "rejected" } }, { onSuccess: refresh })} data-testid={`button-reject-verification-${item.id}`}>Reject</button><button className="btn btn-primary btn-sm" type="button" onClick={() => verify.mutate({ organizerId: item.id, data: { status: "approved" } }, { onSuccess: refresh })} data-testid={`button-approve-verification-${item.id}`}>Approve</button></div>
        </article>) : <div className="state-box"><h3>No pending requests</h3><p>There are no organizers waiting for review.</p></div>}
      </section>
    </div>
    <section className="form-layout admin-user-tools">
      <h2>Account access</h2><p>Use the Clerk user ID from your account administration records. This section is restricted to administrators.</p>
      <form className="form-grid" onSubmit={submitUserAction}>
        <div className="form-field"><label htmlFor="admin-target-id">Clerk user ID</label><input className="field" id="admin-target-id" value={targetId} onChange={(e) => setTargetId(e.target.value)} data-testid="input-admin-target-id" /></div>
        <label className="check-field"><input type="checkbox" checked={roleEnabled} onChange={(e) => setRoleEnabled(e.target.checked)} data-testid="checkbox-role-enabled" /> Grant moderator role (uncheck to remove)</label>
        <div className="form-field full"><label htmlFor="admin-suspension-reason">Suspension reason (leave blank to update moderator role)</label><input className="field" id="admin-suspension-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="input-suspension-reason" /></div>
        <div className="form-actions"><button className="btn btn-outline btn-sm" type="submit" disabled={assignRole.isPending || suspend.isPending} data-testid="button-save-account-access">{reason.trim() ? "Suspend account" : "Save moderator role"}</button><button className="btn btn-quiet btn-sm" type="button" onClick={() => unsuspend.mutate({ userId: targetId.trim() }, { onSuccess: () => { setMessage("Account restored."); refresh(); }, onError: () => setMessage("Could not restore this account.") })} disabled={!targetId.trim() || unsuspend.isPending} data-testid="button-restore-account">Restore suspended account</button></div>
      </form>
    </section>
  </main>;
}

export function Recommendations({ events, renderEvent }: { events: Event[]; renderEvent: (event: Event) => ReactNode }) {
  return events.length ? <div className="event-grid">{events.map((event) => <div key={event.id}>{renderEvent(event)}</div>)}</div> : <div className="state-box"><h3>No recommendations yet</h3><p>Save a few interests or events to personalize your discovery feed.</p><Link href="/settings" className="btn btn-outline btn-sm">Set your interests</Link></div>;
}
