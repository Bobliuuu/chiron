/** Runtime configuration loaded from environment. */
export const env = {
  port: parseInt(process.env.PORT ?? "8788", 10),
  chironApiUrl: (process.env.CHIRON_API_URL ?? "http://localhost:8787").replace(
    /\/$/,
    "",
  ),
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  /** Max conversation turns kept per WhatsApp user (matches backend cap). */
  sessionMaxMessages: 20,
};

export function whatsappConfigured(): boolean {
  return Boolean(
    env.verifyToken && env.accessToken && env.phoneNumberId,
  );
}
