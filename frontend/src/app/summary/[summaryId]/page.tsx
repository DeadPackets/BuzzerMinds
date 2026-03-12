import { notFound } from "next/navigation";
import { Trophy, Brain, CheckCircle, XCircle, HelpCircle, ChevronRight, Sparkles, Hash, BookOpen } from "lucide-react";

import { API_BASE } from "@/lib/api";
import { GameSummaryResponse, QuestionResult } from "@/lib/types";

/* ── Result helpers ── */

function resultColor(r: QuestionResult) {
  switch (r) {
    case "correct": return "var(--teal)";
    case "incorrect": return "var(--coral)";
    case "adjudicated": return "var(--gold)";
    default: return "var(--text-dim)";
  }
}

function resultLabel(r: QuestionResult) {
  switch (r) {
    case "correct": return "Correct";
    case "incorrect": return "Incorrect";
    case "adjudicated": return "Adjudicated";
    default: return "Unanswered";
  }
}

function ResultIcon({ result }: { result: QuestionResult }) {
  const size = 16;
  switch (result) {
    case "correct":
      return <CheckCircle size={size} color="var(--teal)" />;
    case "incorrect":
      return <XCircle size={size} color="var(--coral)" />;
    case "adjudicated":
      return <Sparkles size={size} color="var(--gold)" />;
    default:
      return <HelpCircle size={size} color="var(--text-dim)" />;
  }
}

/* ── Rank badge ── */

function RankBadge({ rank }: { rank: number }) {
  const colors: Record<number, string> = {
    1: "var(--gold)",
    2: "var(--text-dim)",
    3: "var(--tangerine)",
  };
  const bg = colors[rank] ?? "var(--bg-elevated)";
  const fg = rank <= 3 ? "var(--bg-deep)" : "var(--text-bright)";

  return (
    <span
      style={{ background: bg, color: fg }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-extrabold"
    >
      {rank}
    </span>
  );
}

/* ── Section wrapper ── */

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bm-card rounded-[var(--radius)] overflow-hidden">
      <div className="flex items-center gap-3 border-b-2 border-[var(--border)] px-6 py-4">
        {icon}
        <h2 className="bm-title text-lg text-[var(--text-bright)]">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

/* ── Page ── */

export default async function SummaryPage({ params }: { params: Promise<{ summaryId: string }> }) {
  const { summaryId } = await params;

  const response = await fetch(`${API_BASE}/api/summaries/${summaryId}`, { cache: "no-store" });
  if (!response.ok) {
    notFound();
  }

  const summary = (await response.json()) as GameSummaryResponse;

  const winner = summary.players.find((p) => p.rank === 1);

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10"
      style={{ background: "var(--bg-deep)", color: "var(--text-bright)" }}
    >
      {/* ── Header ── */}
      <div className="flex flex-col items-start gap-4">
        <div className="flex items-center gap-2">
          <span
            className="bm-label"
            style={{ background: "var(--violet)", transform: "rotate(-2deg)" }}
          >
            <Brain size={10} />
            Game Summary
          </span>
        </div>

        <h1
          className="bm-title text-3xl sm:text-4xl"
          style={{ color: "var(--text-bright)" }}
        >
          Room{" "}
          <span style={{ color: "var(--sky)", letterSpacing: "0.08em" }}>
            {summary.room_code}
          </span>
        </h1>

        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Finished: {summary.reason.replace(/_/g, " ")}
          <span className="mx-2" style={{ color: "var(--border)" }}>|</span>
          {new Date(summary.finished_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      {/* ── Winner highlight ── */}
      {winner && (
        <div
          className="bm-card flex items-center gap-4 rounded-[var(--radius)] px-6 py-5"
          style={{ borderColor: "var(--gold)", borderWidth: 2 }}
        >
          <Trophy size={28} color="var(--gold)" />
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>
              Winner
            </span>
            <span className="bm-title text-xl" style={{ color: "var(--text-bright)" }}>
              {winner.name}
            </span>
          </div>
          <span className="bm-score ml-auto text-2xl" style={{ color: "var(--gold)" }}>
            {winner.score} pts
          </span>
        </div>
      )}

      {/* ── Final standings ── */}
      <Section title="Final Standings" icon={<Trophy size={18} color="var(--sky)" />}>
        <div className="flex flex-col gap-2">
          {summary.players.map((player) => (
            <div
              key={player.player_id}
              className="flex items-center gap-3 rounded-lg px-4 py-3"
              style={{
                background: player.rank === 1 ? "rgba(251, 191, 36, 0.08)" : "var(--bg-elevated)",
                border: player.rank === 1 ? "1px solid rgba(251, 191, 36, 0.25)" : "1px solid var(--border)",
              }}
            >
              <RankBadge rank={player.rank} />
              <span
                className="h-3 w-3 rounded-full flex-shrink-0"
                style={{ background: player.color, border: "2px solid rgba(255,255,255,0.15)" }}
              />
              <span className="flex-1 font-semibold text-sm" style={{ color: "var(--text-bright)" }}>
                {player.name}
              </span>
              <span className="bm-score text-base" style={{ color: player.rank === 1 ? "var(--gold)" : "var(--sky)" }}>
                {player.score} pts
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Selected topics ── */}
      <Section title="Selected Topics" icon={<Hash size={18} color="var(--teal)" />}>
        <div className="flex flex-wrap gap-2">
          {summary.selected_topics.map((topic, i) => {
            const tagColors = ["var(--sky)", "var(--teal)", "var(--violet)", "var(--coral)", "var(--gold)", "var(--blush)"];
            const bg = tagColors[i % tagColors.length];
            return (
              <span
                key={topic}
                className="bm-feat-tag"
                style={{
                  background: bg,
                  color: "var(--bg-deep)",
                  transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)`,
                }}
              >
                {topic}
              </span>
            );
          })}
        </div>
      </Section>

      {/* ── Match recap ── */}
      <Section title="Match Recap" icon={<BookOpen size={18} color="var(--violet)" />}>
        <div className="flex flex-col gap-4">
          {summary.questions.map((question, index) => {
            const rc = resultColor(question.result);
            return (
              <article
                key={question.question_id}
                className="rounded-lg overflow-hidden"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                {/* Question header */}
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold flex-shrink-0"
                      style={{ background: "var(--sky)", color: "var(--bg-deep)" }}
                    >
                      {index + 1}
                    </span>
                    <span
                      className="text-xs font-bold uppercase tracking-wider truncate"
                      style={{ color: "var(--text-dim)" }}
                    >
                      {question.topic_label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <ResultIcon result={question.result} />
                    <span className="text-xs font-bold" style={{ color: rc }}>
                      {resultLabel(question.result)}
                    </span>
                  </div>
                </div>

                {/* Question body */}
                <div className="px-4 py-4 flex flex-col gap-3">
                  <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--text-bright)" }}>
                    {question.prompt}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md px-3 py-2" style={{ background: "var(--bg-surface)" }}>
                      <span style={{ color: "var(--text-faint)" }}>Submitted: </span>
                      <span style={{ color: question.submitted_answer ? "var(--text-bright)" : "var(--text-faint)" }}>
                        {question.submitted_answer ?? "—"}
                      </span>
                    </div>
                    <div className="rounded-md px-3 py-2" style={{ background: "var(--bg-surface)" }}>
                      <span style={{ color: "var(--text-faint)" }}>Correct: </span>
                      <span style={{ color: "var(--teal)" }}>{question.correct_answer}</span>
                    </div>
                  </div>

                  {/* Fact card */}
                  <div
                    className="rounded-md px-3 py-2 text-xs leading-relaxed"
                    style={{
                      background: "rgba(129, 140, 248, 0.06)",
                      border: "1px solid rgba(129, 140, 248, 0.15)",
                      color: "var(--text-dim)",
                    }}
                  >
                    <span className="font-bold" style={{ color: "var(--violet)" }}>Fact: </span>
                    {question.fact_card.detail}
                  </div>

                  {/* Bonus chain */}
                  {question.bonus_questions.length > 0 && (
                    <div
                      className="rounded-md overflow-hidden"
                      style={{
                        background: "rgba(52, 211, 153, 0.05)",
                        border: "1px solid rgba(52, 211, 153, 0.15)",
                      }}
                    >
                      <div
                        className="flex items-center gap-2 px-3 py-2"
                        style={{ borderBottom: "1px solid rgba(52, 211, 153, 0.15)" }}
                      >
                        <Sparkles size={12} color="var(--teal)" />
                        <span className="text-xs font-bold" style={{ color: "var(--teal)" }}>
                          Bonus Chain
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 p-3">
                        {question.bonus_questions.map((bonus, bonusIndex) => (
                          <div
                            key={`${question.question_id}-${bonusIndex}`}
                            className="flex items-start gap-2 text-xs"
                          >
                            <span className="flex-shrink-0 mt-0.5">
                              <ResultIcon result={bonus.result} />
                            </span>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span style={{ color: "var(--text-bright)" }}>{bonus.prompt}</span>
                              <span style={{ color: "var(--text-faint)" }}>
                                Submitted: {bonus.submitted_answer ?? "—"} · Correct: {bonus.correct_answer}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </Section>

      {/* ── Footer ── */}
      <div className="flex items-center justify-center gap-2 pb-4 text-xs" style={{ color: "var(--text-faint)" }}>
        <Brain size={14} />
        <span>BuzzerMinds</span>
      </div>
    </main>
  );
}
