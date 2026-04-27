import nodemailer from "nodemailer";

const SMTP_HOST = process.env["SMTP_HOST"];
const SMTP_PORT = parseInt(process.env["SMTP_PORT"] ?? "587");
const SMTP_USER = process.env["SMTP_USER"];
const SMTP_PASS = process.env["SMTP_PASS"];
const FROM_ADDRESS = process.env["FROM_EMAIL"] ?? "noreply@wyndr.app";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendEmailVerificationEmail(email: string, code: string): Promise<void> {
  const transport = getTransporter();

  if (!transport) {
    console.log(`[Wyndr] Email verification code for ${email}: ${code} (expires in 24 hours)`);
    return;
  }

  await transport.sendMail({
    from: `"Wyndr" <${FROM_ADDRESS}>`,
    to: email,
    subject: "Verify your Wyndr email",
    text: `Your email verification code is: ${code}\n\nThis code expires in 24 hours.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #ff9a9e; margin-bottom: 8px;">Verify your email</h2>
        <p style="color: #555; margin-bottom: 24px;">Enter this code in the Wyndr app to verify your account. It expires in 24 hours.</p>
        <div style="background: #f4f4f4; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0f0e17;">${code}</span>
        </div>
        <p style="color: #999; font-size: 13px;">If you didn't create a Wyndr account, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, code: string): Promise<void> {
  const transport = getTransporter();

  if (!transport) {
    console.log(`[Wyndr] Password reset code for ${email}: ${code} (expires in 15 minutes)`);
    return;
  }

  await transport.sendMail({
    from: `"Wyndr" <${FROM_ADDRESS}>`,
    to: email,
    subject: "Your Wyndr password reset code",
    text: `Your password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #ff9a9e; margin-bottom: 8px;">Reset your password</h2>
        <p style="color: #555; margin-bottom: 24px;">Use the code below to reset your Wyndr password. It expires in 15 minutes.</p>
        <div style="background: #f4f4f4; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0f0e17;">${code}</span>
        </div>
        <p style="color: #999; font-size: 13px;">If you didn't request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  });
}
