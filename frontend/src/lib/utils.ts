import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRole(role: string): string {
  switch (role) {
    case "vip_player":
      return "VIP";
    case "spectator":
      return "Spectator";
    default:
      return "Player";
  }
}

export function formatPhase(phase: string): string {
  switch (phase) {
    case "intro":
      return "Introduction";
    case "topic_voting":
      return "Topic Voting";
    case "question_loading":
      return "Question Loading";
    case "question_reveal_progressive":
      return "Progressive Reveal";
    case "question_reveal_full":
      return "Full Reveal";
    case "buzz_open":
      return "Buzz Open";
    case "bonus_loading":
      return "Bonus Loading";
    case "bonus_answering":
      return "Bonus Chain";
    case "score_reveal":
      return "Score Reveal";
    case "paused_waiting_for_vip":
      return "Waiting For VIP";
    default:
      return phase.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
  }
}

export function formatCountdown(target: string | null): string {
  if (!target) {
    return "--";
  }
  const diffMs = new Date(target).getTime() - Date.now();
  const diffSeconds = Math.max(Math.ceil(diffMs / 1000), 0);
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
