import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  getAuthSession,
  redirectStaleSession,
  StaleSessionError,
  subscribeToAuthUnauthorized,
  UnauthorizedError,
  type AuthSession
} from "@/auth-client";
import { apiUrl } from "@/lib/config";

type AuthState = {
  session: AuthSession | null;
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  error: string | null;
  refresh: () => Promise<AuthSession | null>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const loadSession = useCallback(async (signal?: AbortSignal) => {
    setStatus("loading");
    setError(null);

    try {
      const nextSession = await getSessionWithRetry(signal);
      setSession(nextSession);
      setStatus("authenticated");
      return nextSession;
    } catch (reason) {
      if (signal?.aborted) return null;
      setSession(null);
      if (redirectStaleSession(reason)) return null;
      if (reason instanceof UnauthorizedError) {
        setStatus("unauthenticated");
        return null;
      }
      setError(
        reason instanceof Error ? reason.message : "Unable to load your account."
      );
      setStatus("error");
      return null;
    }
  }, []);

  const refresh = useCallback(() => loadSession(), [loadSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setSession(null);
      setError(null);
      setStatus("unauthenticated");
    };
    return subscribeToAuthUnauthorized(handleUnauthorized);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal);

    return () => controller.abort();
  }, [loadSession]);

  const value = useMemo(
    () => ({ session, status, error, refresh }),
    [error, refresh, session, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function getSessionWithRetry(signal?: AbortSignal): Promise<AuthSession> {
  const retryDelays = [250, 500, 1_000, 2_000, 4_000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getAuthSession(apiUrl, signal);
    } catch (error) {
      if (
        signal?.aborted ||
        error instanceof StaleSessionError ||
        error instanceof UnauthorizedError ||
        attempt === retryDelays.length
      ) {
        throw error;
      }
      await abortableDelay(retryDelays[attempt]!, signal);
    }
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
