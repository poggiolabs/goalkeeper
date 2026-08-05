import { useEffect, useState } from "react";
import {
  createApiToken,
  getAuthConfiguration,
  getAuthSession,
  getApiTokenScopes,
  listApiTokens,
  loginUrl,
  loginWithEmail,
  logout,
  registerWithEmail,
  revokeApiToken,
  UnauthorizedError,
  verifyEmail,
  type ApiToken,
  type ApiTokenScope,
  type ApiTokenScopeDefinition,
  type AuthConfiguration,
  type AuthSession
} from "./auth-client";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const docsUrl = import.meta.env.VITE_DOCS_URL ?? "http://localhost:3003/docs";

const services = [
  { name: "Documentation", url: docsUrl }
];

export function App() {
  switch (window.location.pathname) {
    case "/account":
      return <AccountPage />;
    case "/verify-email":
      return <VerifyEmailPage />;
    default:
      return <HomePage />;
  }
}

function HomePage() {
  const requestedReturnTo = new URLSearchParams(window.location.search).get(
    "returnTo"
  );
  const returnTo = safeAppUrl(requestedReturnTo, "/account");
  const [configuration, setConfiguration] = useState<AuthConfiguration | null>(
    null
  );
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") return "Email verified. You can sign in.";
    return null;
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getAuthConfiguration(apiUrl, controller.signal)
      .then(setConfiguration)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setAuthError(
            reason instanceof Error
              ? reason.message
              : "Unable to load authentication settings."
          );
        }
      });
    return () => controller.abort();
  }, []);

  async function handleEmailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setAuthError(null);
    setMessage(null);
    try {
      if (mode === "register") {
        const result = await registerWithEmail(apiUrl, {
          email,
          password,
          displayName
        });
        setMessage(`Check ${result.email} for a verification link.`);
      } else {
        window.location.assign(
          await loginWithEmail(apiUrl, { email, password, returnTo })
        );
      }
    } catch (reason) {
      setAuthError(
        reason instanceof Error ? reason.message : "Authentication failed."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <h1>Goalkeeper.</h1>
        <p className="lede">Team goals for AI agents.</p>
        {configuration?.method === "redirect" ? (
          <a
            className="primary-button hero-sign-in"
            href={loginUrl(apiUrl, returnTo)}
          >
            Sign in
          </a>
        ) : null}
      </section>

      {configuration?.method === "email" ? (
        <section className="email-auth" aria-labelledby="email-auth-title">
          <div className="auth-mode" role="group" aria-label="Authentication mode">
            <button
              aria-pressed={mode === "login"}
              onClick={() => setMode("login")}
              type="button"
            >
              Sign in
            </button>
            <button
              aria-pressed={mode === "register"}
              onClick={() => setMode("register")}
              type="button"
            >
              Create account
            </button>
          </div>
          <form onSubmit={handleEmailAuth}>
            <h2 id="email-auth-title">
              {mode === "login" ? "Sign in with email" : "Create your account"}
            </h2>
            {mode === "register" ? (
              <label>
                Display name
                <input
                  autoComplete="name"
                  maxLength={100}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  type="text"
                  value={displayName}
                />
              </label>
            ) : null}
            <label>
              Email
              <input
                autoComplete="email"
                maxLength={254}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              Password
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={12}
                maxLength={512}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <button className="primary-button" disabled={isSubmitting} type="submit">
              {isSubmitting
                ? "Working…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
        </section>
      ) : null}

      {message ? <p className="auth-message" role="status">{message}</p> : null}
      {authError ? <p className="form-error auth-error" role="alert">{authError}</p> : null}

      <section aria-label="Resources">
        <div className="grid">
          {services.map((service) => (
            <a className="card" href={service.url} key={service.name}>
              <span>{service.name}</span>
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}

function VerifyEmailPage() {
  const [token] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("token")
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, "", "/verify-email");
  }, []);

  async function handleVerification() {
    if (!token) return;
    setIsSubmitting(true);
    setError(null);
    try {
      window.location.assign(await verifyEmail(apiUrl, token));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That verification link is invalid or expired."
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="verify-email-title">
        <a className="wordmark" href="/">Goalkeeper</a>
        <div>
          <p className="eyebrow">Email verification</p>
          <h1 id="verify-email-title">Verify your email</h1>
          <p>
            {token
              ? "Confirm that you want to verify this email address."
              : "That verification link is invalid or expired."}
          </p>
        </div>
        {token ? (
          <button
            className="primary-button"
            disabled={isSubmitting}
            onClick={handleVerification}
            type="button"
          >
            {isSubmitting ? "Verifying…" : "Verify email"}
          </button>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}

function AccountPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [scopeDefinitions, setScopeDefinitions] = useState<
    ApiTokenScopeDefinition[] | null
  >(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    getAuthSession(apiUrl, controller.signal)
      .then(async (nextSession) => {
        setSession(nextSession);
        try {
          const [nextTokens, nextScopeDefinitions] = await Promise.all([
            listApiTokens(apiUrl, controller.signal),
            getApiTokenScopes(apiUrl, controller.signal)
          ]);
          setTokens(nextTokens);
          setScopeDefinitions(nextScopeDefinitions);
        } catch (reason) {
          if (controller.signal.aborted) return;
          if (reason instanceof UnauthorizedError) {
            window.location.replace("/?returnTo=/account");
            return;
          }
          setTokenError(
            reason instanceof Error ? reason.message : "Unable to load API tokens."
          );
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof UnauthorizedError) {
          window.location.replace("/?returnTo=/account");
          return;
        }
        setError(
          reason instanceof Error ? reason.message : "Unable to load your account."
        );
      });

    return () => controller.abort();
  }, []);

  async function handleLogout() {
    setIsLoggingOut(true);
    setError(null);

    try {
      window.location.assign(await logout(apiUrl));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to log out.");
      setIsLoggingOut(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card account-card" aria-labelledby="account-title">
        <a className="wordmark" href="/">Goalkeeper</a>
        {session ? (
          <>
            <div>
              <p className="eyebrow">Account</p>
              <h1 id="account-title">{session.user.displayName}</h1>
              <p>{session.user.email}</p>
            </div>
            <button
              className="secondary-button"
              disabled={isLoggingOut}
              onClick={handleLogout}
              type="button"
            >
              {isLoggingOut ? "Logging out…" : "Log out"}
            </button>
            <ApiTokenManager
              error={tokenError}
              onError={setTokenError}
              onTokensChange={setTokens}
              scopeDefinitions={scopeDefinitions}
              tokens={tokens}
            />
          </>
        ) : error ? (
          <div role="alert">
            <h1 id="account-title">Account unavailable</h1>
            <p>{error}</p>
            <button
              className="secondary-button"
              onClick={() => window.location.reload()}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : (
          <div aria-live="polite">
            <h1 id="account-title">Loading account…</h1>
          </div>
        )}
      </section>
    </main>
  );
}

function ApiTokenManager({
  error,
  onError,
  onTokensChange,
  scopeDefinitions,
  tokens
}: {
  error: string | null;
  onError: (error: string | null) => void;
  onTokensChange: (tokens: ApiToken[]) => void;
  scopeDefinitions: ApiTokenScopeDefinition[] | null;
  tokens: ApiToken[] | null;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    if (!scopeDefinitions) return;
    setScopes(
      scopeDefinitions
        .filter((scope) => scope.default)
        .map((scope) => scope.id)
    );
  }, [scopeDefinitions]);

  function toggleScope(scope: ApiTokenScope) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((candidate) => candidate !== scope)
        : [...current, scope]
    );
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setCreatedSecret(null);
    onError(null);

    try {
      const result = await createApiToken(apiUrl, {
        name,
        scopes,
        expiresInDays
      });
      onTokensChange([result.token, ...(tokens ?? [])]);
      setCreatedSecret(result.secret);
      setName("");
    } catch (reason) {
      if (reason instanceof UnauthorizedError) {
        window.location.replace("/?returnTo=/account");
        return;
      }
      onError(
        reason instanceof Error ? reason.message : "Unable to create API token."
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(token: ApiToken) {
    if (!window.confirm(`Revoke ${token.name}? This cannot be undone.`)) return;

    setRevokingId(token.id);
    onError(null);
    try {
      await revokeApiToken(apiUrl, token.id);
      onTokensChange((tokens ?? []).filter((candidate) => candidate.id !== token.id));
    } catch (reason) {
      if (reason instanceof UnauthorizedError) {
        window.location.replace("/?returnTo=/account");
        return;
      }
      onError(
        reason instanceof Error ? reason.message : "Unable to revoke API token."
      );
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="token-manager" aria-labelledby="api-tokens-title">
      <div>
        <p className="eyebrow">Developer access</p>
        <h2 id="api-tokens-title">API tokens</h2>
        <p>Create scoped credentials for automation and integrations.</p>
      </div>

      {createdSecret ? (
        <div className="secret-callout" role="status">
          <strong>Copy this token now.</strong>
          <p>It will not be shown again.</p>
          <code>{createdSecret}</code>
          <button
            className="text-button"
            onClick={() => navigator.clipboard.writeText(createdSecret)}
            type="button"
          >
            Copy token
          </button>
        </div>
      ) : null}

      <form className="token-form" onSubmit={handleCreate}>
        <label>
          Name
          <input
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="CI deployment"
            required
            type="text"
            value={name}
          />
        </label>

        <fieldset>
          <legend>Scopes</legend>
          <div className="scope-grid">
            {scopeDefinitions?.map((scope) => (
              <label className="scope-option" key={scope.id}>
                <input
                  checked={scopes.includes(scope.id)}
                  onChange={() => toggleScope(scope.id)}
                  type="checkbox"
                />
                <span>
                  <strong>{scope.label}</strong>
                  <small>{scope.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label>
          Expires
          <select
            onChange={(event) => setExpiresInDays(Number(event.target.value))}
            value={expiresInDays}
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </label>

        <button
          className="primary-button"
          disabled={isCreating || revokingId !== null || scopes.length === 0}
          type="submit"
        >
          {isCreating ? "Creating…" : "Create token"}
        </button>
      </form>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="token-list" aria-live="polite">
        {tokens === null && !error ? <p>Loading API tokens…</p> : null}
        {tokens?.length === 0 ? <p>No active API tokens.</p> : null}
        {tokens?.map((token) => (
          <article className="token-row" key={token.id}>
            <div>
              <strong>{token.name}</strong>
              <code>{token.prefix}…</code>
              <div className="scope-list">
                {token.scopes.map((scope) => <span key={scope}>{scope}</span>)}
              </div>
              <small>
                Expires {formatDate(token.expiresAt)} · Last used{" "}
                {token.lastUsedAt ? formatDate(token.lastUsedAt) : "never"}
              </small>
            </div>
            <button
              className="danger-button"
              disabled={revokingId !== null}
              onClick={() => handleRevoke(token)}
              type="button"
            >
              {revokingId === token.id ? "Revoking…" : "Revoke"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value)
  );
}

function safeAppUrl(requestedPath: string | null, fallbackPath: string): string {
  const fallback = new URL(fallbackPath, window.location.origin);

  if (!requestedPath) return fallback.toString();

  try {
    const requested = new URL(requestedPath, window.location.origin);
    return requested.origin === window.location.origin
      ? requested.toString()
      : fallback.toString();
  } catch {
    return fallback.toString();
  }
}
