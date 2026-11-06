import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Close } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-[#33373d] active:bg-black border border-ink',
  secondary: 'bg-surface text-ink border border-control hover:bg-raised active:bg-active',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-active hover:text-ink active:bg-[#e2e2dd]',
  danger: 'bg-surface text-late-ink border border-control hover:bg-late-soft',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap transition-colors duration-100 select-none',
          'disabled:opacity-45 disabled:pointer-events-none',
          size === 'sm' ? 'h-7 px-2 text-[13px]' : 'h-8 px-3 text-[13px]',
          variants[variant],
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-ink-2 transition-colors hover:bg-active hover:text-ink disabled:opacity-40',
        active && 'bg-active text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Segmented control: a quiet group of options, the chosen one on a white chip. */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[6px] bg-active p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[5px] px-2.5 font-medium transition-colors',
            size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[13px]',
            value === o.value ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-[13px] text-ink-2 hover:bg-active hover:text-ink" title={title}>
      <span
        className={cx('relative inline-block h-4 w-7 rounded-full transition-colors', checked ? 'bg-ink' : 'bg-control')}
        aria-hidden="true"
      >
        <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform', checked ? 'translate-x-3.5' : 'translate-x-0.5')} />
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Working-day number input with − / + steppers. */
export function DayStepper({ value, onChange, label, disabled, min = 0, max = 2000, id }: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  id?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n * 2) / 2)));
    else setText(String(value));
  };
  return (
    <div className={cx('inline-flex h-8 items-stretch rounded-[6px] border border-control bg-surface', disabled && 'opacity-45')}>
      <button type="button" disabled={disabled || value <= min} aria-label={`Decrease ${label}`} className="w-7 text-ink-2 hover:bg-raised disabled:opacity-40" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, value + 1)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, value - 1)); }
        }}
        className="num w-11 border-x border-line bg-transparent text-center text-[13px] outline-none focus:bg-raised"
      />
      <button type="button" disabled={disabled || value >= max} aria-label={`Increase ${label}`} className="w-7 text-ink-2 hover:bg-raised disabled:opacity-40" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

export function Dialog({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[85vh] rounded-[12px] border border-line bg-surface p-0 text-ink shadow-[0_1px_2px_rgb(31_34_38/0.06),0_16px_40px_rgb(31_34_38/0.14)]"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      aria-label={title}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-[16px] font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}><Close /></IconButton>
          </div>
          <div className="overflow-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Pill({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'critical' | 'late' | 'sim' | 'ok'; children: ReactNode; title?: string }) {
  const tones = {
    neutral: 'bg-active text-ink-2',
    critical: 'bg-ink text-white',
    late: 'bg-late-soft text-late-ink',
    sim: 'bg-sim-soft text-sim-ink',
    ok: 'bg-ok-soft text-ok',
  };
  return <span title={title} className={cx('inline-flex h-5 items-center rounded-[4px] px-1.5 text-[12px] font-medium whitespace-nowrap', tones[tone])}>{children}</span>;
}
