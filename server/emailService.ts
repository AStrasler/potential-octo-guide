/**
 * Email delivery service for ScholarScan OTP codes.
 * Uses the Manus built-in notification system as primary delivery,
 * with a fallback that logs the code to the console for development.
 */

import { notifyOwner } from "./_core/notification";

export async function sendOTPEmail(email: string, code: string): Promise<void> {
  const subject = "Your ScholarScan Verification Code";
  const htmlBody = `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #0f0f1a; color: #f0f0f8; border-radius: 12px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 28px;">
        <div style="width: 36px; height: 36px; background: rgba(100, 120, 255, 0.15); border: 1px solid rgba(100, 120, 255, 0.3); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 18px;">🎓</span>
        </div>
        <span style="font-size: 18px; font-weight: 600; letter-spacing: -0.3px;">ScholarScan</span>
      </div>
      
      <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px 0; letter-spacing: -0.5px;">Your verification code</h1>
      <p style="font-size: 14px; color: #8888aa; margin: 0 0 24px 0; line-height: 1.5;">
        Enter this code to access ScholarScan. It expires in 15 minutes.
      </p>
      
      <div style="background: rgba(100, 120, 255, 0.1); border: 1px solid rgba(100, 120, 255, 0.25); border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 40px; font-weight: 800; letter-spacing: 12px; color: #a0aaff; font-family: 'Courier New', monospace;">${code}</span>
      </div>
      
      <p style="font-size: 12px; color: #666688; line-height: 1.6; margin: 0;">
        If you didn't request this code, you can safely ignore this email. 
        ScholarScan is exclusively available to verified .edu email addresses.
      </p>
      
      <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08);">
        <p style="font-size: 11px; color: #555577; margin: 0;">
          ScholarScan — Academic Integrity Suite · Restricted to verified .edu students
        </p>
      </div>
    </div>
  `;

  // Primary: use the Manus built-in forge API to send email via the notification system
  // The notification goes to the project owner (Aaron), who can see the code
  // For student emails, we use the LLM-powered email API if available
  
  try {
    // Try to send via the Manus built-in email/notification API
    const forgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
    const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
    
    if (forgeApiUrl && forgeApiKey) {
      // Try the email endpoint
      const emailEndpoint = `${forgeApiUrl.replace(/\/$/, "")}/v1/email/send`;
      const response = await fetch(emailEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${forgeApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: email,
          subject,
          html: htmlBody,
          text: `Your ScholarScan verification code is: ${code}\n\nThis code expires in 15 minutes.`,
        }),
      });
      
      if (response.ok) {
        console.log(`[Email] OTP sent to ${email} via forge email API`);
        return;
      }
      console.warn(`[Email] Forge email API returned ${response.status}, falling back`);
    }
  } catch (e) {
    console.warn("[Email] Forge email API unavailable:", e);
  }

  // Fallback: notify owner via built-in notification with the code
  // This ensures the owner (Aaron) always sees the code
  try {
    await notifyOwner({
      title: `ScholarScan OTP: ${code}`,
      content: `Verification code requested by **${email}**\n\nCode: **${code}**\n\nExpires in 15 minutes.\n\nPlease forward this code to the student if needed.`,
    });
    console.log(`[Email] OTP for ${email} sent via owner notification: ${code}`);
  } catch (e) {
    console.warn("[Email] Owner notification failed:", e);
  }

  // Always log to console as ultimate fallback (visible in dev)
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  ScholarScan OTP for ${email}`);
  console.log(`║  Code: ${code}`);
  console.log(`╚══════════════════════════════════════╝\n`);
}
