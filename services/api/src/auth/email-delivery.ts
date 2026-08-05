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
    console.log("Development authentication email", message);
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
      timeout: 30_000
    };
  } catch {
    throw invalidSmtpUrl();
  }
}

function invalidSmtpUrl() {
  return new Error(
    "AUTH_SMTP_URL must be a valid smtp:// or smtps:// URL"
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
  AUTH_EMAIL_DELIVERY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_SMTP_URL?: string;
  NODE_ENV?: string;
};

export function configuredEmailDelivery(
  env: EmailDeliveryEnvironment = process.env
): EmailDelivery {
  const mode = env.AUTH_EMAIL_DELIVERY ?? "log";

  switch (mode) {
    case "log":
      if (env.NODE_ENV === "production") {
        throw new Error(
          "AUTH_EMAIL_DELIVERY=log is available only outside production"
        );
      }
      return new LogEmailDelivery();
    case "smtp":
      if (!env.AUTH_EMAIL_FROM || !env.AUTH_SMTP_URL) {
        throw new Error(
          "AUTH_EMAIL_FROM and AUTH_SMTP_URL are required for SMTP email delivery"
        );
      }
      return new SmtpEmailDelivery(env.AUTH_SMTP_URL, env.AUTH_EMAIL_FROM);
    default:
      throw new Error("AUTH_EMAIL_DELIVERY must be one of: log, smtp");
  }
}
