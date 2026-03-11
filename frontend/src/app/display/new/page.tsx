import { redirect } from "next/navigation";

import { API_BASE } from "@/lib/api";

export default async function DisplayNewPage() {
  const response = await fetch(`${API_BASE}/api/rooms`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ turnstile_token: null }),
  });

  if (!response.ok) {
    throw new Error("Unable to create room.");
  }

  const payload = (await response.json()) as { room: { code: string }; display_session: { display_token: string } };
  redirect(`/display/${payload.room.code}?dt=${encodeURIComponent(payload.display_session.display_token)}`);
}
