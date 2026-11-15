import React from "react";
import { Link } from "react-router-dom";

const REPO = "https://github.com/SCTY-Inc/web-draw";

const linkClass =
  "underline decoration-1 underline-offset-4 transition-opacity duration-150 hover:opacity-60 active:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="bg-black/5 px-1 py-0.5 font-mono text-[0.85em]">
    {children}
  </code>
);

const Section: React.FC<{
  id: string;
  title: string;
  children: React.ReactNode;
}> = ({ id, title, children }) => (
  <section aria-labelledby={id} className="max-w-[65ch] pt-14">
    <h2 id={id} className="text-[22px] font-medium tracking-[-0.01em]">
      {title}
    </h2>
    <div className="mt-3 space-y-3.5">{children}</div>
  </section>
);

export const LabNote: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#F0F0F0] font-['Helvetica_Neue',Helvetica,Arial,sans-serif] text-[18px] leading-[1.65] text-black">
      <main className="mx-auto max-w-[1040px] px-6 pb-10">
        <nav className="flex items-center justify-between py-7 text-[15px]">
          <span className="flex items-center gap-3 text-xl font-medium tracking-[-0.02em]">
            <img src="/favicon.svg" alt="" width={28} height={28} className="block" />
            web-draw
          </span>
          <Link
            to="/login"
            className="transition-opacity duration-150 hover:opacity-60 active:opacity-45"
          >
            Sign in
          </Link>
        </nav>

        <header className="border-b border-black pb-14 pt-[72px]">
          <p className="m-0 font-mono text-xs text-black/60">SCTY Lab</p>
          <h1 className="mt-6 max-w-[14ch] text-[clamp(2.5rem,7vw,5rem)] font-medium leading-[0.95] tracking-[-0.05em]">
            A shared whiteboard you host yourself.
          </h1>
          <p className="mt-7 max-w-[42ch] text-[clamp(1.1rem,2.4vw,1.375rem)] leading-[1.45] text-black/60">
            Excalidraw workspaces with collections, live collaboration, sharing
            and version history. This fork adds a Copilot: say what you want, or
            paste Markdown or code, and it draws on the canvas.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5 text-[15px]">
            <Link
              to="/login"
              className="inline-block bg-black px-[22px] py-2.5 text-[#F0F0F0] transition-[opacity,transform] duration-150 hover:opacity-80 active:scale-[0.97]"
            >
              Sign in
            </Link>
            <a href={REPO} className={linkClass}>
              View on GitHub
            </a>
          </div>
        </header>

        <Section id="file-title" title="One file holds the drawings">
          <p>
            Every drawing, collection and version lives in one SQLite database
            by default, with uploaded images in a folder beside it. There is no
            outside service. Any drawing exports as a plain{" "}
            <Code>.excalidraw</Code> file that the free Excalidraw editor can
            open.
          </p>
        </Section>

        <Section id="start-title" title="Quickstart">
          <p>Docker Compose, no build step.</p>
          <pre
            tabIndex={0}
            aria-label="Quickstart commands"
            className="mt-4 overflow-x-auto bg-black/5 px-6 py-5 font-mono text-sm leading-[1.7]"
          >
            {`git clone ${REPO}.git
cd web-draw
docker compose -f docker-compose.prod.yml up -d`}
          </pre>
          <p className="text-sm text-black/60">
            Then open <Code>http://localhost:6767</Code> and choose how people
            sign in. These commands run the published upstream ExcaliDash
            images, without the Copilot. The Copilot needs a build from this
            repository and an <Code>OPENAI_API_KEY</Code> on the server. The
            compose file publishes port 6767 on every network interface, so put
            it behind a firewall or a proxy.
          </p>
        </Section>

        <Section id="why-title" title="Why">
          <p className="text-xl leading-[1.45]">
            Can you tell a whiteboard what to draw and still get a normal
            drawing back?
          </p>
          <p>
            The Copilot works through the same scene API as your mouse. It adds
            ordinary Excalidraw shapes, so you can move, edit or delete anything
            it draws. Voice runs over a live connection with a short-lived key,
            and it disconnects after three idle minutes to cap the cost.
          </p>
          <p>
            Compose is where it failed first. The model wrote Mermaid diagram
            types that the converter cannot render, such as mind maps and Gantt
            charts, and the canvas threw an error. Now the prompt allows only
            flowchart, sequence and class diagrams. Two later fixes placed new
            drawings in open space instead of on top of your work, and cut the
            activity log to one plain line per action.
          </p>
        </Section>

        <Section id="delete-title" title="If you delete it, keep your exports">
          <p>
            The drawings live in the database volume. Removing the containers
            keeps the volume, and <Code>docker compose down -v</Code> deletes
            it. Export the drawings you want to keep as <Code>.excalidraw</Code>{" "}
            files first, or turn on the scheduled SQLite backups.
          </p>
        </Section>

        <footer className="mt-24 flex flex-wrap items-center gap-5 border-t border-black/10 pt-6 text-sm text-black/60">
          <span>
            LGPL-3.0 · a fork of{" "}
            <a
              href="https://github.com/ZimengXiong/ExcaliDash"
              className={linkClass}
            >
              ExcaliDash
            </a>
          </span>
          <a href={REPO} className={linkClass}>
            GitHub
          </a>
          <a href="https://scty.org/lab" className={linkClass}>
            SCTY Lab
          </a>
        </footer>
      </main>
    </div>
  );
};
