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
