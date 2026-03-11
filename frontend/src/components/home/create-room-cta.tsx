"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { TurnstileProvider, useTurnstile } from "@/components/providers/turnstile-provider";
import { api } from "@/lib/api";
import { PublicConfigResponse } from "@/lib/types";
import { saveDisplaySession } from "@/lib/storage";

function CreateGameButton() {
  const router = useRouter();
  const { requestToken } = useTurnstile();
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const token = await requestToken("create-room");
      const payload = await api.createRoom(token);
      saveDisplaySession(payload.room.code, payload.display_session.display_token);
      router.push(`/display/${payload.room.code}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="bm-btn-neon w-full py-4 text-lg"
      disabled={busy}
      onClick={handleCreate}
    >
      {busy ? "Creating Room..." : "Create Game"}
    </button>
  );
}

function JoinGameForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) {
      router.push(`/player/${trimmed}`);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={handleJoin}>
      <input
        autoComplete="off"
        className="h-14 rounded-xl border border-[var(--bm-border-glow)] bg-[var(--bm-bg-elevated)] px-4 text-center text-xl font-bold uppercase tracking-[0.2em] text-[var(--bm-text-bright)] placeholder:text-[var(--bm-text-dim)] placeholder:tracking-[0.1em] placeholder:text-base placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[var(--bm-neon-purple)]/50"
        maxLength={8}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Room code"
        value={code}
      />
      <button
        className="bm-btn-outline w-full py-3.5 text-lg"
        disabled={!code.trim()}
        type="submit"
      >
        Join Game
      </button>
    </form>
  );
}

export function CreateRoomCta({ config }: { config: PublicConfigResponse }) {
  return (
    <TurnstileProvider config={config}>
      <div className="grid gap-6 w-full">
        <CreateGameButton />
        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-[var(--bm-border-glow)]" />
          <span className="text-sm font-medium text-[var(--bm-text-dim)]">or</span>
          <div className="h-px flex-1 bg-[var(--bm-border-glow)]" />
        </div>
        <JoinGameForm />
      </div>
    </TurnstileProvider>
  );
}
