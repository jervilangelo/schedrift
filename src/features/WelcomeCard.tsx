import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../store/useProject';
import { Close, GitHub, Mark, Star } from '../components/ui/icons';

export const REPO_URL = 'https://github.com/jervilangelo/schedrift';

/** Pause after a project opens so the chart is seen first and the card never covers a loading state. */
const SETTLE_MS = 700;
const EXIT_MS = 180;

/**
 * One-time thank-you card, shown after the first project opens successfully.
 * It is dismissible (Continue, ×, Escape), ignores clicks on the backdrop, and never
 * touches project state. Nothing is sent anywhere.
 */
export function WelcomeCard() {
  const pending = useProject((s) => s.welcomePending);
  const project = useProject((s) => s.project);
  const reportOpen = useProject((s) => s.reportOpen);
  const masterPreview = useProject((s) => s.masterPreview);
  const busy = useProject((s) => s.busy);
  const presenting = useProject((s) => s.presenting);
  const dismiss = useProject((s) => s.dismissWelcome);

  // Wait until nothing else needs the user's attention.
  const ready = pending && !!project && !reportOpen && !masterPreview && !busy && !presenting;
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setShow(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    const d = ref.current;
    if (show && d && !d.open) {
      d.showModal();
      continueRef.current?.focus(); // the safe default: Enter simply continues
    }
  }, [show]);

  const close = useCallback(() => {
    if (leaving) return;
    dismiss();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setLeaving(true);
    setTimeout(() => {
      ref.current?.close();
      setShow(false);
      setLeaving(false);
    }, reduce ? 0 : EXIT_MS);
  }, [dismiss, leaving]);

  if (!show) return null;
  return (
    <dialog
      ref={ref}
      className="welcome-card m-auto w-[min(440px,calc(100vw-32px))] rounded-[12px] border border-line bg-surface p-0 text-ink"
      data-leaving={leaving || undefined}
      aria-labelledby="welcome-title"
      aria-describedby="welcome-body"
      data-testid="welcome-card"
      onCancel={(e) => {
        e.preventDefault(); // Escape: animate out instead of an abrupt close
        close();
      }}
    >
      <div className="relative px-7 pt-7 pb-6">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-active hover:text-ink"
        >
          <Close />
        </button>

        <span className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-line bg-ground">
          <Mark size={24} />
        </span>
        <h2 id="welcome-title" className="mt-5 text-[20px] leading-[26px] font-semibold tracking-[-0.01em]">Enjoying Schedrift?</h2>
        <div id="welcome-body" className="mt-2 flex flex-col gap-2.5 text-[14px] leading-[21px] text-ink-2">
          <p>
            Schedrift is a free and open-source project, independently developed by{' '}
            <span className="font-medium text-ink">Jervil Angelo De Leon</span>. It was made to turn complex Microsoft Project schedules into
            something easy to understand, visualize and present.
          </p>
          <p>If it helps you, a star on GitHub is a kind way to support it, and it helps others find it too.</p>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="welcome-btn inline-flex h-10 shrink-0 items-center sm:flex-1 justify-center gap-2 rounded-[8px] border border-ink bg-ink px-4 text-[14px] font-medium text-white hover:bg-[#33373d]"
            data-testid="welcome-star"
          >
            <GitHub size={16} />
            Star on GitHub
            <Star size={13} className="text-[#f2c94c]" fill="currentColor" />
          </a>
          <button
            type="button"
            onClick={close}
            ref={continueRef}
            className="welcome-btn inline-flex h-10 shrink-0 items-center sm:flex-1 justify-center rounded-[8px] border border-control bg-surface px-4 text-[14px] font-medium text-ink hover:bg-raised"
            data-testid="welcome-continue"
          >
            Continue to Schedrift
          </button>
        </div>
      </div>
      <p className="border-t border-line bg-raised px-7 py-3 text-center text-[12px] text-ink-3 rounded-b-[12px]">
        Free &amp; Open Source <span aria-hidden="true">·</span> Made with care
      </p>
    </dialog>
  );
}
