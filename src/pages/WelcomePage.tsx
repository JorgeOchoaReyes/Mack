import { ArrowRight, CircleCheck, ListChecks, MessagesSquare, ShieldCheck, Wrench } from "lucide-react";
import type { Health, Project } from "../api";
import { Logo } from "../components/Logo";
import { NewProjectForm } from "../components/ProjectPicker";
import { Button } from "../components/ui";

type Props = { health: Health | null; onGoSetup: () => void; onGoGuide: () => void; onCreated: (p: Project, description: string) => void };

/** What Mack shows until there is a problem: one question, and what happens after you answer it. */
export function WelcomePage({ health, onGoSetup, onGoGuide, onCreated }: Props) {
  const setupDone = !!health?.lake && !!health?.hasMathlib && health.keySource !== "none" && !!health.model;
  return (
    <div className="page welcome-page">
      <div className="welcome-hero">
        <div className="welcome-logo">
          <Logo />
        </div>
        <h1>What problem do you want to tackle?</h1>
        <p className="muted">
          Mack is a research partner for mathematics. Describe a problem in your own words, even a famous unsolved one. An AI assistant explains it, plans the work
          and tries proofs, and <strong>Lean</strong>, a computer proof checker, decides what is actually proved. Nothing is taken on the AI's word.
        </p>
      </div>

      {!setupDone && (
        <div className="setup-callout">
          <Wrench size={16} />
          <span className="grow">First, a one-time setup: install Lean (one click) and add a key for the AI model you want to use.</span>
          <Button size="sm" icon={ArrowRight} onClick={onGoSetup}>
            Open Setup
          </Button>
        </div>
      )}
      {setupDone && (
        <div className="setup-callout done">
          <CircleCheck size={16} />
          <span className="grow">Setup is done: Lean and your AI model are ready.</span>
        </div>
      )}

      <section className="hero-card">
        <NewProjectForm primary onCreated={onCreated} />
      </section>

      <div className="how-grid">
        <div className="how-cell">
          <MessagesSquare size={18} />
          <b>1. Talk it through</b>
          <p>The assistant explains the problem in plain words, what is known, and how hard it really is.</p>
        </div>
        <div className="how-cell">
          <ListChecks size={18} />
          <b>2. Follow the plan</b>
          <p>It breaks the work into steps: reading, computing examples, ideas, and pieces to prove. You see each step's progress.</p>
        </div>
        <div className="how-cell">
          <ShieldCheck size={18} />
          <b>3. Lean checks</b>
          <p>Each proof is written in Lean and checked by computer. A step marked Verified is certain; everything else is labelled as what it is.</p>
        </div>
      </div>

      <button className="link small" onClick={onGoGuide}>
        How Mack works, in more detail <ArrowRight size={13} />
      </button>
    </div>
  );
}
