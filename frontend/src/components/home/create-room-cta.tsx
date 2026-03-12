"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { motion } from "framer-motion";
import { Monitor, ArrowRight } from "lucide-react";

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
    <motion.button
      className="bm-btn-primary w-full py-4 text-lg"
      disabled={busy}
      onClick={handleCreate}
      whileHover={{ y: -3, scale: 1.02 }}
      whileTap={{ y: 1, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 15 }}
    >
      <Monitor className="h-[18px] w-[18px]" />
      {busy ? "Creating Room..." : "Create Game"}
    </motion.button>
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
      <div className="bm-divider">or join</div>
      <div className="flex gap-2.5">
        <input
          autoComplete="off"
          className="bm-code-input"
          maxLength={8}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Room code"
          value={code}
        />
        <motion.button
          className="bm-btn-secondary px-5"
          disabled={!code.trim()}
          type="submit"
          whileHover={{ y: -3, scale: 1.02 }}
          whileTap={{ y: 1, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <ArrowRight className="h-5 w-5" />
        </motion.button>
      </div>
    </form>
  );
}

function CreateRoomCtaInner() {
  return (
    <div className="grid w-full gap-4">
      <CreateGameButton />
      <JoinGameForm />
    </div>
  );
}

export function CreateRoomCta({ config }: { config: PublicConfigResponse }) {
  return (
    <TurnstileProvider config={config}>
      <CreateRoomCtaInner />
    </TurnstileProvider>
  );
}
