/**
 * Telegram Bot API client.
 *
 * Sends messages to a channel/chat via the Bot API.
 * No SDK needed — just HTTP POST.
 */

const BASE_URL = "https://api.telegram.org";

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

function getChatId(): string {
  const chatId = process.env.TELEGRAM_CHANNEL_ID;
  if (!chatId) throw new Error("TELEGRAM_CHANNEL_ID is not set");
  return chatId;
}

interface SendMessageOptions {
  chatId?: string;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  disableWebPagePreview?: boolean;
}

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

export async function sendMessage(
  options: SendMessageOptions
): Promise<TelegramResponse> {
  const { chatId, text, parseMode = "HTML", disableWebPagePreview = true } =
    options;
  const token = getToken();
  const targetChat = chatId ?? getChatId();

  const res = await fetch(`${BASE_URL}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: targetChat,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: disableWebPagePreview,
    }),
  });

  const data = (await res.json()) as TelegramResponse;

  if (!data.ok) {
    console.error(
      `[Telegram] sendMessage failed: ${data.description ?? res.status}`
    );
  }

  return data;
}

/** Send multiple messages with rate-limit spacing (Telegram allows ~30 msg/sec to channels) */
export async function sendMessages(
  messages: SendMessageOptions[]
): Promise<TelegramResponse[]> {
  const results: TelegramResponse[] = [];

  for (const msg of messages) {
    const result = await sendMessage(msg);
    results.push(result);
    // Telegram rate limit: 20 messages per minute to the same group
    if (messages.length > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}
