// client/src/pages/TeacherSessionsPage.tsx
import React, { useEffect, useState, FormEvent } from 'react';
import { api } from '../api/http';
import type { CurrentUserDTO } from '../api/http';

type Props = { currentUser: CurrentUserDTO };

type VideoSession = {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  videoLink: string;
  channelId: string | null;
  teacherId: string;
  createdAt: string;
};

type FormState = {
  title: string;
  description: string;
  startTime: string; // datetime-local string
  endTime: string;   // datetime-local string
};

const initialForm: FormState = {
  title: '',
  description: '',
  startTime: '',
  endTime: '',
};

const TeacherSessionsPage: React.FC<Props> = ({ currentUser }) => {
  const [sessions, setSessions] = useState<VideoSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);

  // load upcoming sessions on mount
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api<VideoSession[]>('/api/video-sessions/upcoming');
        setSessions(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load sessions');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.startTime || !form.endTime) {
      alert('Title, start time, and end time are required.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // datetime-local -> ISO string
      const start = new Date(form.startTime);
      const end = new Date(form.endTime);

      const payload = {
        title: form.title,
        description: form.description || undefined,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      };

      const created = await api<VideoSession>('/api/video-sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // prepend new session
      setSessions((prev) => [created, ...prev]);
      setForm(initialForm);
    } catch (err: any) {
      setError(err.message || 'Failed to create session');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  return (
    <div className="tt-page-scroll">
      <div className="tt-container py-6">
        <div className="tt-page-header">
          <h1 className="tt-h1">Teacher Video Sessions</h1>
          <p className="tt-subtitle">Create and manage scheduled video sessions for your Tambayan Talks classes.</p>
        </div>

      {/* Error banner */}
        {error && <div className="tt-alert tt-alert-error" style={{ marginBottom: 14 }}>{error}</div>}

      {/* Create form */}
        <section className="tt-card tt-card-pad mb-5">
          <h2 className="tt-card-title mb-3">Schedule a new session</h2>

          <form onSubmit={handleSubmit} className="tt-form">
            <div className="tt-field">
              <label className="tt-label" htmlFor="title">Title *</label>
              <input
                id="title"
                name="title"
                value={form.title}
                onChange={handleChange}
                type="text"
                placeholder="e.g. Algebra Review, English 101"
                className="tt-input"
              />
            </div>

            <div className="tt-field">
              <label className="tt-label" htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="Short summary of what you'll cover"
                rows={3}
                className="tt-textarea"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="tt-field">
                <label className="tt-label" htmlFor="startTime">Start time *</label>
                <input
                  id="startTime"
                  name="startTime"
                  type="datetime-local"
                  value={form.startTime}
                  onChange={handleChange}
                  className="tt-input"
                />
              </div>

              <div className="tt-field">
                <label className="tt-label" htmlFor="endTime">End time *</label>
                <input
                  id="endTime"
                  name="endTime"
                  type="datetime-local"
                  value={form.endTime}
                  onChange={handleChange}
                  className="tt-input"
                />
              </div>
            </div>

            <button type="submit" disabled={submitting} className="tt-btn tt-btn-primary" style={{ alignSelf: 'flex-start' }}>
              {submitting ? 'Creating…' : 'Create session'}
            </button>
        </form>
      </section>

      {/* Sessions list */}
        <section>
          <h2 className="tt-card-title mb-3">Upcoming sessions</h2>

        {loading ? (
          <p>Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="tt-subtitle">No upcoming sessions yet. Create your first one above.</p>
        ) : (
          <div className="grid gap-3">
            {sessions.map((s) => (
              <article key={s.id} className="tt-card tt-card-pad">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-extrabold tracking-tight m-0">{s.title}</h3>
                  <span className="tt-badge" style={{ borderColor: 'rgba(0, 132, 255, 0.20)', background: 'rgba(0, 132, 255, 0.06)', color: 'rgba(0, 70, 160, 0.95)' }}>
                    {formatDate(s.startTime)} – {formatDate(s.endTime)}
                  </span>
                </div>

                {s.description && <p className="mt-1 text-sm text-slate-600">{s.description}</p>}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <a href={s.videoLink} target="_blank" rel="noreferrer" className="tt-btn-link" style={{ paddingLeft: 0, paddingRight: 0 }}>
                    Join link →
                  </a>
                  <span className="text-xs text-slate-500 font-semibold">Created {formatDate(s.createdAt)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
};

export default TeacherSessionsPage;