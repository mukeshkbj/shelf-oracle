import Link from "next/link";
import { Brand } from "@/components/organizer/Brand";

const steps = [
  { number: "01", name: "Scan the shelf", copy: "One shelf photo becomes a reviewed, editable product lineup. Not another spreadsheet to build before the room arrives.", badge: "INTAKE", hue: "violet" },
  { number: "02", name: "Make the call", copy: "Score the lineup against behavioural principles, then lock the AI ranking with a verifiable fingerprint before voting opens.", badge: "PREDICTION", hue: "amber" },
  { number: "03", name: "Let the room decide", copy: "A QR code brings everyone in. Collect real ratings and human predictions, then reveal the gap and keep the report.", badge: "EVIDENCE", hue: "emerald" },
];

export default function Home() {
  return (
    <main className="so-marketing">
      <div className="so-landing-top">
        <nav className="so-landing-nav so-container" aria-label="Main navigation">
          <Brand inverse />
          <div className="so-landing-links"><a href="#how-it-works">How it works</a><a href="#the-output">The output</a><Link href="/login">Log in</Link><Link className="so-button so-button-light so-nav-cta" href="/signup">Start a panel <span aria-hidden="true">↗</span></Link></div>
        </nav>
        <section className="so-hero so-container">
          <div className="so-hero-copy">
            <span className="so-eyebrow so-eyebrow-on-dark"><span className="so-dot" /> THE LIVE RETAIL INTELLIGENCE PLATFORM</span>
            <h1>The shelf makes a claim.<br /><em>The room decides.</em></h1>
            <p>Turn a shelf of products into a live experiment. Predict what people will love, collect their actual votes, and leave with proof worth sharing.</p>
            <div className="so-hero-actions"><Link href="/signup" className="so-button so-button-light so-button-large">Create your first event <span aria-hidden="true">↗</span></Link><a href="#how-it-works" className="so-text-link so-text-link-light">See how it works <span aria-hidden="true">↓</span></a></div>
            <div className="so-hero-foot"><span className="so-avatar-cluster" aria-hidden="true"><b>AI</b><b>YOU</b><b>↗</b></span><span>One room. Two predictions.<br /><strong>A more honest answer.</strong></span></div>
          </div>
          <div className="so-hero-scene" role="img" aria-label="Illustration of a tasting shelf transforming into a live prediction and human vote comparison">
            <div className="so-scene-label">ILLUSTRATIVE SHELF / 001</div>
            <div className="so-scene-shelf"><div className="so-pack so-pack-one"><small>WILD</small><strong>GOOD<br />THINGS</strong><i>Oat bites</i></div><div className="so-pack so-pack-two"><small>mello.</small><strong>CRUNCH<br />CLUB</strong><i>sea salt</i></div><div className="so-pack so-pack-three"><small>sprout</small><strong>PLANT<br />POWER</strong><i>original</i></div><div className="so-pack so-pack-four"><small>happi</small><strong>THE<br />GOOD<br />STUFF</strong><i>cocoa</i></div><div className="so-pack so-pack-five"><small>POPPED</small><strong>BRIGHT<br />BITES</strong><i>chilli lime</i></div></div>
            <div className="so-scene-floor" />
            <div className="so-scene-card"><div className="so-scene-card-head"><span><span className="so-dot so-dot-violet" /> SAMPLE PREDICTION</span><span>DEMO</span></div><div className="so-scene-bar"><span>01</span><span>Wild Good Things</span><i style={{ width: "78%" }} /></div><div className="so-scene-bar"><span>02</span><span>Crunch Club</span><i style={{ width: "60%" }} /></div><div className="so-scene-bar"><span>03</span><span>Bright Bites</span><i style={{ width: "43%" }} /></div><div className="so-scene-proof"><span>Example fingerprint</span><strong>8F2A · C19D</strong></div></div>
            <div className="so-scene-sticker"><span>THE<br />HUMAN<br />TEST</span><strong>↗</strong></div>
          </div>
        </section>
        <div className="so-hero-bottom so-container"><span>BUILT FOR THE MOMENT OF TRUTH</span><span>SCROLL TO EXPLORE <span aria-hidden="true">↓</span></span></div>
      </div>
      <div className="so-ticker" aria-label="Platform flow"><div>PHOTOGRAPH THE SHELF <span>•</span> LOCK A PREDICTION <span>•</span> LET THE ROOM VOTE <span>•</span> SHOW YOUR WORK <span>•</span> PHOTOGRAPH THE SHELF <span>•</span> LOCK A PREDICTION</div></div>
      <section id="how-it-works" className="so-section so-container">
        <div className="so-section-header"><span className="so-kicker">01 / THE PROCESS</span><h2>From product shelf<br />to <em>proof</em> in one afternoon.</h2><p>No survey setup. No imported datasets. Just the products in front of you, the people in the room, and a prediction made before anyone votes.</p></div>
        <div className="so-steps">{steps.map((step) => <article className="so-step" key={step.number}><div className="so-step-top"><span>{step.number}</span><span className={`so-pill so-pill-${step.hue}`}>{step.badge}</span></div><div className={`so-step-art so-step-art-${step.hue}`} aria-hidden="true"><span>{step.number === "01" ? "▥  ▥  ▥" : step.number === "02" ? "01  →  05" : "AI  ≠  YOU"}</span></div><h3>{step.name}</h3><p>{step.copy}</p></article>)}</div>
      </section>
      <section id="the-output" className="so-output"><div className="so-container so-output-grid"><div><span className="so-kicker">02 / THE DIFFERENCE</span><h2>A prediction is interesting.<br /><em>A tested prediction changes things.</em></h2><p>Every event adds a new piece of evidence: what the model thought, what the room actually tasted, where they disagreed, and why. A repeatable way to make better product calls.</p><Link href="/signup" className="so-button so-button-dark">Build your first panel <span aria-hidden="true">↗</span></Link></div><div className="so-report-preview" aria-label="Illustrative report preview with example figures, not real panel results"><div className="so-report-preview-top"><span>EXAMPLE REPORT / ILLUSTRATIVE DATA</span><span className="so-dot so-dot-emerald" /></div><div className="so-report-preview-heading">What the room<br />really wanted.</div><p className="so-report-sample-note">SAMPLE FIGURES · NOT REAL PANEL RESULTS</p><div className="so-report-preview-metrics"><div><strong>24</strong><span>PRODUCTS</span></div><div><strong>86</strong><span>PEOPLE</span></div><div><strong>0.71</strong><span>RANK CORRELATION</span></div></div><div className="so-report-preview-row"><span>AI CALLED IT</span><span className="so-report-preview-line" /><span>ROOM PROVED IT</span></div><div className="so-report-preview-footer">A PERMANENT, SHAREABLE RECORD <span>↗</span></div></div></div></section>
      <section className="so-closing so-container"><span className="so-kicker">YOUR NEXT PANEL STARTS HERE</span><h2>Good instincts deserve<br /><em>better evidence.</em></h2><Link href="/signup" className="so-button so-button-dark so-button-large">Get started for free <span aria-hidden="true">↗</span></Link></section>
      <footer className="so-landing-footer"><div className="so-container"><Brand /><span>Predictive ranging, tested live.</span><span>© {new Date().getFullYear()} Shelf Oracle</span></div></footer>
    </main>
  );
}
