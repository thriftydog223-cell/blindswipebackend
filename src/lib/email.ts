import { Resend } from "resend";

const RESEND_API_KEY = process.env["RESEND_API_KEY"];
const FROM_ADDRESS = process.env["EMAIL_FROM"] ?? "onboarding@resend.dev";
const FROM_NAME = process.env["EMAIL_FROM_NAME"] ?? "Wyndr";
const FROM = `${FROM_NAME} <${FROM_ADDRESS}>`;

function getClient(): Resend | null {
  if (!RESEND_API_KEY) return null;
  return new Resend(RESEND_API_KEY);
}

function baseTemplate(title: string, previewText: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <!-- Logo / Brand header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#ff9a9e,#fecfef,#a18cd1);border-radius:16px;padding:3px;">
                    <div style="background:#fff;border-radius:14px;padding:14px 28px;">
                      <span style="font-size:26px;font-weight:800;background:linear-gradient(135deg,#ff6b9d,#c44dff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#ff6b9d;letter-spacing:-0.5px;">Wyndr</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;color:#bbb;font-size:12px;line-height:1.6;">
                You're receiving this email because an account action was requested for your Wyndr account.<br />
                If this wasn't you, you can safely ignore this email.
              </p>
              <p style="margin:8px 0 0;color:#ddd;font-size:11px;">© 2025 Wyndr. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendEmailVerificationEmail(email: string, code: string): Promise<void> {
  const client = getClient();

  if (!client) {
    console.log(`[Wyndr] No RESEND_API_KEY set — verification code for ${email}: ${code}`);
    return;
  }

  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f0e17;">Verify your email</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#666;line-height:1.6;">
      Thanks for signing up for Wyndr! Enter the code below in the app to verify your email address.
      It expires in <strong>24 hours</strong>.
    </p>

    <div style="background:linear-gradient(135deg,#fff5f7,#fdf2ff);border:2px solid #fecfef;border-radius:16px;padding:28px;text-align:center;margin-bottom:28px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#c44dff;letter-spacing:2px;text-transform:uppercase;">Your verification code</p>
      <span style="font-size:44px;font-weight:800;letter-spacing:12px;color:#0f0e17;font-variant-numeric:tabular-nums;">${code}</span>
    </div>

    <div style="background:#f8f8f8;border-radius:12px;padding:16px;margin-bottom:8px;">
      <p style="margin:0;font-size:13px;color:#888;line-height:1.5;">
        🔒 &nbsp;Never share this code with anyone. Wyndr will never ask for it over the phone or chat.
      </p>
    </div>
  `;

  const { error } = await client.emails.send({
    from: FROM,
    to: email,
    subject: "Your Wyndr verification code",
    html: baseTemplate("Verify your email — Wyndr", `Your verification code is ${code}`, body),
    text: `Your Wyndr verification code is: ${code}\n\nEnter this in the app to verify your email. It expires in 24 hours.\n\nIf you didn't sign up for Wyndr, ignore this email.`,
  });

  if (error) {
    console.error("[Wyndr] Failed to send verification email:", error);
    throw new Error(`Email send failed: ${error.message}`);
  }
}

export async function sendPasswordResetEmail(email: string, code: string): Promise<void> {
  const client = getClient();

  if (!client) {
    console.log(`[Wyndr] No RESEND_API_KEY set — password reset code for ${email}: ${code}`);
    return;
  }

  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f0e17;">Reset your password</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#666;line-height:1.6;">
      We received a request to reset your Wyndr password. Enter the code below in the app.
      It expires in <strong>15 minutes</strong>.
    </p>

    <div style="background:linear-gradient(135deg,#fff5f7,#fdf2ff);border:2px solid #fecfef;border-radius:16px;padding:28px;text-align:center;margin-bottom:28px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#c44dff;letter-spacing:2px;text-transform:uppercase;">Your reset code</p>
      <span style="font-size:44px;font-weight:800;letter-spacing:12px;color:#0f0e17;font-variant-numeric:tabular-nums;">${code}</span>
    </div>

    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:12px;padding:16px;margin-bottom:8px;">
      <p style="margin:0;font-size:13px;color:#888;line-height:1.5;">
        ⏱ &nbsp;This code expires in <strong>15 minutes</strong>. If you didn't request a password reset, no action is needed — your account is safe.
      </p>
    </div>
  `;

  const { error } = await client.emails.send({
    from: FROM,
    to: email,
    subject: "Your Wyndr password reset code",
    html: baseTemplate("Reset your password — Wyndr", `Your password reset code is ${code}`, body),
    text: `Your Wyndr password reset code is: ${code}\n\nEnter this in the app to reset your password. It expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
  });

  if (error) {
    console.error("[Wyndr] Failed to send password reset email:", error);
    throw new Error(`Email send failed: ${error.message}`);
  }
}
