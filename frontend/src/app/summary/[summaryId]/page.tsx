import { notFound } from "next/navigation";

import { API_BASE } from "@/lib/api";
import { GameSummaryResponse } from "@/lib/types";

export default async function SummaryPage({ params }: { params: Promise<{ summaryId: string }> }) {
  const { summaryId } = await params;

  const response = await fetch(`${API_BASE}/api/summaries/${summaryId}`, { cache: "no-store" });
  if (!response.ok) {
    notFound();
  }

  const summary = (await response.json()) as GameSummaryResponse;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Game Summary</p>
        <h1 className="mt-2 text-4xl font-semibold">Room {summary.room_code}</h1>
        <p className="mt-2 text-muted-foreground">Finished because: {summary.reason.replace(/_/g, " ")}</p>
      </div>

      <section className="grid gap-4 rounded-3xl border p-6">
        <h2 className="text-xl font-semibold">Final standings</h2>
        {summary.players.map((player) => (
          <div key={player.player_id} className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
            <span>#{player.rank} {player.name}</span>
            <span>{player.score} pts</span>
          </div>
        ))}
      </section>

      <section className="grid gap-4 rounded-3xl border p-6">
        <h2 className="text-xl font-semibold">Selected topics</h2>
        <div className="flex flex-wrap gap-2">
          {summary.selected_topics.map((topic) => <span key={topic} className="rounded-full border px-3 py-1 text-sm">{topic}</span>)}
        </div>
      </section>

      <section className="grid gap-4 rounded-3xl border p-6">
        <h2 className="text-xl font-semibold">Match recap</h2>
        {summary.questions.map((question, index) => (
          <article key={question.question_id} className="grid gap-3 rounded-2xl border px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <strong>{index + 1}. {question.topic_label}</strong>
              <span>{question.result}</span>
            </div>
            <p>{question.prompt}</p>
            <p className="text-sm text-muted-foreground">Submitted: {question.submitted_answer ?? "-"}</p>
            <p className="text-sm text-muted-foreground">Correct: {question.correct_answer}</p>
            <p className="text-sm text-muted-foreground">Fact: {question.fact_card.detail}</p>
            {question.bonus_questions.length > 0 ? (
              <div className="grid gap-2 rounded-xl border p-3 text-sm">
                <strong>Bonus chain</strong>
                {question.bonus_questions.map((bonus, bonusIndex) => (
                  <div key={`${question.question_id}-${bonusIndex}`}>
                    {bonusIndex + 1}. {bonus.prompt} - submitted: {bonus.submitted_answer ?? "-"} - correct: {bonus.correct_answer}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
