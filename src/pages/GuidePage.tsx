import { ArrowRight, BookOpen, CircleCheck, CircleDollarSign, GitCompare, Lock, ShieldCheck, Wrench } from "lucide-react";
import { Badge, Button, OutcomeBadge } from "../components/ui";

type Props = { onGo: (page: "setup" | "prove" | "upstream") => void };

export function GuidePage({ onGo }: Props) {
  return (
    <div className="page guide">
      <div className="page-head">
        <h1>How Mack works</h1>
        <p className="muted">
          Mack lets an AI model try to prove math statements in Lean, and only trusts a proof once Lean's checker accepts it. The model proposes; Lean
          decides.
        </p>
      </div>

      <section className="guide-card">
        <div className="guide-icon">
          <Wrench size={18} />
        </div>
        <div>
          <h2>1. Set up once</h2>
          <p>
            In <strong>Setup</strong>, install Lean and Mathlib (one click, about 5 GB), choose a model provider (Fireworks, OpenRouter, a LiteLLM proxy or any OpenAI-compatible server), paste your key, and pick a model. The first time Lean
            loads Mathlib it can take several minutes; after that a check takes seconds.
          </p>
          <Button size="sm" icon={ArrowRight} onClick={() => onGo("setup")}>
            Open Setup
          </Button>
        </div>
      </section>

      <section className="guide-card">
        <div className="guide-icon">
          <BookOpen size={18} />
        </div>
        <div>
          <h2>2. Write the statement</h2>
          <p>
            On <strong>Prove</strong>, write a Lean file that starts with <code>import Mathlib</code> and states one theorem proved by <code>sorry</code>, or
            pick one from <em>Examples</em>. This statement is <em>frozen</em>: a proof only counts if it proves exactly this, word for word.
          </p>
          <pre className="guide-code">{`import Mathlib

theorem my_result (n : ℕ) : n + 0 = n :=
sorry`}</pre>
          <p className="muted small">
            Type <code>\to</code>, <code>\forall</code>, <code>\R</code>, <code>\le</code> and a space to get <code>→ ∀ ℝ ≤</code>.
          </p>
        </div>
      </section>

      <section className="guide-card">
        <div className="guide-icon">
          <ShieldCheck size={18} />
        </div>
        <div>
          <h2>3. Press Prove and watch the attempts</h2>
          <p>
            Each attempt, the model writes a complete proof and Lean checks it. Lean's errors go back to the model, which revises. Each attempt ends with a
            label:
          </p>
          <div className="outcomes">
            <div>
              <OutcomeBadge outcome="verified" /> Lean and the strict verifier accept it. Done.
            </div>
            <div>
              <OutcomeBadge outcome="errors" /> Lean found mistakes; the model sees them and tries again.
            </div>
            <div>
              <OutcomeBadge outcome="sorries" /> The proof still has gaps (<code>sorry</code>).
            </div>
            <div>
              <OutcomeBadge outcome="refused" /> It changed the statement or used a banned shortcut, before Lean even ran.
            </div>
            <div>
              <OutcomeBadge outcome="rejected" /> Lean ran, but the strict verifier found a problem, such as an extra axiom.
            </div>
            <div>
              <OutcomeBadge outcome="no verdict" /> Lean ran past the deadline. That counts as a failure, never a pass.
            </div>
          </div>
        </div>
      </section>

      <section className="guide-card">
        <div className="guide-icon">
          <CircleCheck size={18} />
        </div>
        <div>
          <h2>What "Verified" guarantees</h2>
          <ul>
            <li>The theorem statement is unchanged, byte for byte, and so is everything defined before it.</li>
            <li>
              No <code>sorry</code>, <code>axiom</code>, <code>native_decide</code> or metaprogramming tricks.
            </li>
            <li>
              The proof depends only on Lean's three standard axioms: <Badge>propext</Badge> <Badge>Classical.choice</Badge> <Badge>Quot.sound</Badge>
            </li>
            <li>The theorem Lean checked means exactly what you wrote, compared in Lean's fully expanded form.</li>
          </ul>
          <p className="muted small">These are the same rules Open Math Harness uses, ported to Mack. A model's own claim that a proof works counts for nothing.</p>
        </div>
      </section>

      <section className="guide-card">
        <div className="guide-icon">
          <GitCompare size={18} />
        </div>
        <div>
          <h2>Staying current with Open Math Harness</h2>
          <p>
            Mack checks the Open Math Harness repository when it opens and every 6 hours. If upstream changes how it checks or searches for proofs, a yellow
            banner appears and <strong>Upstream</strong> shows what changed and which part of Mack it affects. You can turn checks off, or choose to stay on
            your current version.
          </p>
          <Button size="sm" icon={ArrowRight} onClick={() => onGo("upstream")}>
            Open Upstream
          </Button>
        </div>
      </section>

      <section className="guide-card">
        <div className="guide-icon">
          <CircleDollarSign size={18} />
        </div>
        <div>
          <h2>Costs</h2>
          <p>
            Each attempt is one call to your model, billed to your provider account. Every attempt shows its token count. Lower <em>Attempts per run</em> (single) or the <em>model-call budget</em> (search tree) in
            Settings to cap spend per problem.
          </p>
        </div>
      </section>

      <section className="guide-card">
        <div className="guide-icon">
          <Lock size={18} />
        </div>
        <div>
          <h2>Privacy</h2>
          <p>
            Your key is encrypted on this computer and only sent to the provider it belongs to. Your statements go to that provider to be proved; everything else, including the
            run history, stays on this computer. The only other network calls Mack makes are the upstream check to GitHub and the one-time Lean download.
          </p>
        </div>
      </section>

      <div className="row gap-sm">
        <Button variant="primary" icon={ArrowRight} onClick={() => onGo("prove")}>
          Start proving
        </Button>
      </div>
    </div>
  );
}
