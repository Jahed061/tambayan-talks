import nodemailer from 'nodemailer';

type SendMailArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

function hasSmtpConfig() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

export async function sendMail({ to, subject, text, html }: SendMailArgs) {
  // Dev-friendly fallback: if SMTP isn't configured, log the email contents.
  if (!hasSmtpConfig()) {
    console.log('\n--- EMAIL (SMTP not configured) ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(text);
    console.log('--- END EMAIL ---\n');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT!),
    secure: String(process.env.SMTP_SECURE ?? '').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM!,
    to,
    subject,
    text,
    html,
  });
}
