import {
  SMTPClient,
  type MessageHeaders,
  type SMTPConnectionOptions
} from "emailjs";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailDelivery {
  send(message: EmailMessage): Promise<void>;
}

export class LogEmailDelivery implements EmailDelivery {
  async send(message: EmailMessage): Promise<void> {
    console.log("Development email", message);
  }
}

type SmtpClient = {
  sendAsync(message: MessageHeaders): Promise<unknown>;
};

type SmtpClientFactory = (
  options: Partial<SMTPConnectionOptions>
) => SmtpClient;

function smtpClientOptions(
  smtpUrl: string
): Partial<SMTPConnectionOptions> {
  let url: URL;
  try {
    url = new URL(smtpUrl);
  } catch {
    throw invalidSmtpUrl();
  }

  const implicitTls = url.protocol === "smtps:";
  if ((!implicitTls && url.protocol !== "smtp:") || !url.hostname) {
    throw invalidSmtpUrl();
  }

  const port = url.port ? Number(url.port) : implicitTls ? 465 : 587;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw invalidSmtpUrl();
  }

  try {
    return {
      host: url.hostname,
      port,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: implicitTls ? { servername: url.hostname } : false,
      tls: !implicitTls,
      // Deliberately short: hosted deployments run the API as a single
      // container instance, so a slow send blocks every other request.
      timeout: 5_000
    };
  } catch {
    throw invalidSmtpUrl();
  }
}

function invalidSmtpUrl() {
  return new Error(
    "SMTP_URL must be a valid smtp:// or smtps:// URL. A password containing " +
      "'%' must be percent-encoded, since the userinfo is URL-decoded."
  );
}

export class SmtpEmailDelivery implements EmailDelivery {
  private readonly client: SmtpClient;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    createClient: SmtpClientFactory = (options) => new SMTPClient(options)
  ) {
    this.client = createClient(smtpClientOptions(smtpUrl));
  }

  async send(message: EmailMessage): Promise<void> {
    await this.client.sendAsync({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text
    });
  }
}

type EmailDeliveryEnvironment = {
  EMAIL_DELIVERY?: string;
  EMAIL_FROM?: string;
  SMTP_URL?: string;
  /** Deprecated aliases kept so existing deployments and .env files work. */
  AUTH_EMAIL_DELIVERY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_SMTP_URL?: string;
  NODE_ENV?: string;
};

function settings(env: EmailDeliveryEnvironment) {
  return {
    mode: env.EMAIL_DELIVERY ?? env.AUTH_EMAIL_DELIVERY,
    from: env.EMAIL_FROM ?? env.AUTH_EMAIL_FROM,
    smtpUrl: env.SMTP_URL ?? env.AUTH_SMTP_URL,
    production: env.NODE_ENV === "production"
  };
}

/**
 * Delivery for flows that cannot function without it — email-provider
 * registration cannot verify an address it never sent to, so this throws
 * rather than degrading.
 */
export function configuredEmailDelivery(
  env: EmailDeliveryEnvironment = process.env
): EmailDelivery {
  const { mode = "log", from, smtpUrl, production } = settings(env);

  switch (mode) {
    case "log":
      if (production) {
        throw new Error(
          "EMAIL_DELIVERY=log is available only outside production"
        );
      }
      return new LogEmailDelivery();
    case "smtp":
      if (!from || !smtpUrl) {
        throw new Error(
          "EMAIL_FROM and SMTP_URL are required for SMTP email delivery"
        );
      }
      return new SmtpEmailDelivery(smtpUrl, from);
    default:
      throw new Error("EMAIL_DELIVERY must be one of: log, smtp");
  }
}

/**
 * Delivery for notifications that degrade gracefully. Returns null when
 * nothing is configured so the caller can fall back — an invitation still
 * commits and surfaces a shareable link when no mailer exists.
 */
export function optionalNotificationDelivery(
  env: EmailDeliveryEnvironment = process.env
): EmailDelivery | null {
  const { mode, from, smtpUrl, production } = settings(env);

  if (!mode) return production ? null : new LogEmailDelivery();
  if (mode === "log") return production ? null : new LogEmailDelivery();
  if (mode === "smtp") return from && smtpUrl ? new SmtpEmailDelivery(smtpUrl, from) : null;
  return null;
}
