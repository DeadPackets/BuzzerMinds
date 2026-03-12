"use client";

import { motion } from "framer-motion";
import { Zap, Monitor, Smartphone, Brain } from "lucide-react";

import { CreateRoomCta } from "@/components/home/create-room-cta";
import { WireframeBackground } from "@/components/ui/wireframe-background";
import { PublicConfigResponse } from "@/lib/types";

/* ── Animation variants ── */
const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const popIn = {
  hidden: { opacity: 0, y: 30, scale: 0.92 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.7, ease: [0.34, 1.56, 0.64, 1] as const },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};

/* ── Feature cards ── */
const features = [
  {
    icon: Monitor,
    title: "Screen-first",
    description: "Put the display on a TV or projector. It runs the show.",
    color: "var(--amber)",
  },
  {
    icon: Smartphone,
    title: "Phone to play",
    description: "Players join from their phones with a room code. No app needed.",
    color: "var(--sage)",
  },
  {
    icon: Brain,
    title: "AI-powered",
    description: "Questions generated from player expertise. Every game is unique.",
    color: "var(--rose)",
  },
] as const;

export function LandingHero({ config }: { config: PublicConfigResponse }) {
  return (
    <main className="bm-shell relative z-10 overflow-hidden">
      <WireframeBackground />

      <motion.div
        className="relative z-10 mx-auto flex min-h-[90vh] max-w-5xl flex-col items-center justify-center gap-12 py-16 text-center"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        {/* ── Logo ── */}
        <motion.div variants={popIn} className="flex flex-col items-center gap-4">
          <motion.div
            variants={popIn}
            className="flex h-[56px] w-[56px] items-center justify-center rounded-2xl"
            style={{ background: "var(--amber)" }}
          >
            <Zap className="h-7 w-7" style={{ color: "var(--bg)" }} />
          </motion.div>

          <motion.h1
            variants={popIn}
            className="bm-title text-5xl leading-[0.95] sm:text-6xl lg:text-[5.5rem]"
          >
            <span style={{ color: "var(--amber)" }}>Buzzer</span>
            <span style={{ color: "var(--sage)" }}>Minds</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="bm-body mx-auto max-w-[440px] text-[1.05rem] font-medium leading-relaxed"
          >
            The live AI trivia party. One big screen, a room full of phones, and questions that adapt to your group.
          </motion.p>
        </motion.div>

        {/* ── CTA Card ── */}
        <motion.div
          variants={popIn}
          className="w-full max-w-[420px] rounded-2xl border border-[rgba(255,255,255,0.06)] p-8"
          style={{
            background: "var(--surface)",
            backdropFilter: "blur(16px)",
          }}
        >
          <CreateRoomCta config={config} />
        </motion.div>

        {/* ── Feature cards ── */}
        <motion.div
          variants={containerVariants}
          className="flex max-w-[720px] flex-wrap justify-center gap-5"
        >
          {features.map((feat) => (
            <motion.div
              key={feat.title}
              variants={popIn}
              className="w-[210px] rounded-2xl border border-[rgba(255,255,255,0.06)] p-5 text-left"
              style={{
                background: "var(--surface)",
                backdropFilter: "blur(16px)",
              }}
            >
              <feat.icon
                className="mb-3 h-6 w-6"
                style={{ color: feat.color }}
              />
              <h3 className="bm-title text-[0.95rem] text-[var(--text-bright)]">{feat.title}</h3>
              <p className="mt-1.5 text-[0.8rem] leading-relaxed text-[var(--text-dim)]">
                {feat.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </main>
  );
}
