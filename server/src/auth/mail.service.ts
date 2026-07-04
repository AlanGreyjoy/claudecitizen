import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EnvService } from '../shared/env.service';

@Injectable()
export class MailService {
  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @InjectPinoLogger(MailService.name) private readonly logger: PinoLogger,
  ) {}

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    if (!this.env.smtpHost) {
      this.logger.info(
        { email },
        'Password reset requested but SMTP is not configured; email not sent',
      );
      return;
    }

    const transporter = nodemailer.createTransport({
      host: this.env.smtpHost,
      port: this.env.smtpPort,
      secure: this.env.smtpPort === 465,
      auth:
        this.env.smtpUser && this.env.smtpPass
          ? { user: this.env.smtpUser, pass: this.env.smtpPass }
          : undefined,
    });

    await transporter.sendMail({
      from: this.env.smtpFrom,
      to: email,
      subject: 'Reset your ClaudeCitizen password',
      text: `Reset your password: ${resetUrl}\n\nThis link expires in 30 minutes.`,
    });
    this.logger.info({ email }, 'Password reset email sent');
  }
}
