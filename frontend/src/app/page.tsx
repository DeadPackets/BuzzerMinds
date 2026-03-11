import { Zap, Users, Brain, Tv } from "lucide-react";

import { CreateRoomCta } from "@/components/home/create-room-cta";
import { api } from "@/lib/api";

export default async function Home() {
  const config = await api.getConfig();

  return (
    <main className="bm-shell bm-grid-pattern relative z-10">
      <div className="bm-particles" aria-hidden="true" />

      {/* ── Hero section ── */}
      <div className="mx-auto flex min-h-[85vh] max-w-5xl flex-col items-center justify-center gap-12 py-16 text-center">
        {/* Logo / Brand */}
        <div>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--bm-neon-purple)] to-[var(--bm-neon-pink)] shadow-[0_0_40px_rgba(180,74,255,0.3)]">
            <Zap className="h-8 w-8 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="bm-title mt-6 text-5xl leading-[0.95] text-[var(--bm-text-bright)] sm:text-6xl lg:text-7xl">
            <span className="bm-gradient-text">Buzzer</span>Minds
          </h1>
          <p className="bm-body mx-auto mt-4 max-w-xl text-lg">
            The live AI trivia party. One big screen, a room full of phones, and questions that adapt to what your group actually knows.
          </p>
        </div>

        {/* ── CTA Card ── */}
        <div className="bm-card bm-card-glow w-full max-w-md p-8">
          <CreateRoomCta config={config} />
        </div>

        {/* ── How it works ── */}
        <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
          <FeatureCard
            icon={<Tv className="h-5 w-5" />}
            title="Screen-first"
            description="Put the display on a TV or projector. It runs the show."
            color="cyan"
          />
          <FeatureCard
            icon={<Users className="h-5 w-5" />}
            title="Phone to play"
            description="Players join from their phones with a room code. No app needed."
            color="pink"
          />
          <FeatureCard
            icon={<Brain className="h-5 w-5" />}
            title="AI-powered"
            description="Questions generated from player expertise. Every game is unique."
            color="purple"
          />
        </div>
      </div>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: "cyan" | "pink" | "purple";
}) {
  const iconColors: Record<string, string> = {
    cyan: "text-[var(--bm-neon-cyan)]",
    pink: "text-[var(--bm-neon-pink)]",
    purple: "text-[var(--bm-neon-purple)]",
  };

  return (
    <div className="bm-card rounded-xl p-5 text-left">
      <div className={iconColors[color]}>{icon}</div>
      <h3 className="mt-3 text-sm font-bold uppercase tracking-wide text-[var(--bm-text-bright)]">
        {title}
      </h3>
      <p className="bm-body mt-1.5 text-sm">{description}</p>
    </div>
  );
}
