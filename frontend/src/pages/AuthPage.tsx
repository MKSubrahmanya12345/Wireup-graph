import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { WireupWordmark } from '../components/Brand';
import { useAuth } from '../store/useAuth';
import heroArt from '../assets/wireup-hero.png';

type Mode = 'login' | 'signup';

const HIGHLIGHTS = [
  {
    title: 'Deterministic, not a wrapper',
    body: 'A device knowledge base and engineering rules drive every plan — firmware is compiled and the MERN app is built in a real terminal before you ever see a download button.',
  },
  {
    title: 'Three steps to shipped hardware',
    body: 'Prompt & questions → validated architecture graph → agentic build producing two zips: firmware and local dashboard software.',
  },
  {
    title: 'Runs on your bench',
    body: 'Everything the pipeline emits targets your local network. Flash the sketch, run the dashboard, watch the sensors live.',
  },
];

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const user = useAuth((state) => state.user);
  const busy = useAuth((state) => state.busy);
  const error = useAuth((state) => state.error);
  const login = useAuth((state) => state.login);
  const signup = useAuth((state) => state.signup);
  const clearError = useAuth((state) => state.clearError);
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  useEffect(() => clearError, [mode, clearError]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok =
      mode === 'login'
        ? await login(email.trim(), password)
        : await signup(name.trim(), email.trim(), password);
    if (ok) navigate('/', { replace: true });
  };

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <img className="auth-hero-art" src={heroArt} alt="" aria-hidden="true" />
        <div className="auth-hero-scrim" />
        <WireupWordmark size={44} />
        <h1>
          Describe hardware.
          <br />
          Get validated <span className="accent-text">firmware + software</span>.
        </h1>
        <p className="auth-sub">
          Wireup turns a sentence about your parts into a verified architecture,
          compilable ESP32 firmware and a local MERN dashboard — with the
          build logs to prove it.
        </p>
        <div className="auth-highlights">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="highlight-card">
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="auth-card-wrap">
        <form className="auth-card" onSubmit={(e) => void submit(e)}>
          <div className="auth-tabs" role="tablist">
            {(['login', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`auth-tab${mode === m ? ' active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'login' ? 'Log in' : 'Create account'}
              </button>
            ))}
          </div>

          <h2>{mode === 'login' ? 'Welcome back' : 'Join Wireup'}</h2>
          <p className="muted">
            {mode === 'login'
              ? 'Log in to your workspace.'
              : 'One account for every build. Free, local-first.'}
          </p>

          {mode === 'signup' && (
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                minLength={2}
                required
              />
            </label>
          )}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@lab.dev"
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span>Password {mode === 'signup' && <em>(8+ chars, a letter and a number)</em>}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 8 : 1}
              required
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="primary-button auth-submit" disabled={busy} type="submit">
            {busy ? 'One moment…' : mode === 'login' ? 'Log in →' : 'Create my account →'}
          </button>

          <p className="muted tiny center">
            Sessions are signed tokens; passwords are bcrypt-hashed and never stored.
          </p>
        </form>
      </section>
    </div>
  );
}
