import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const ChevronRight = (p: P) => <Icon {...p}><path d="M6 3.5 10.5 8 6 12.5" /></Icon>;
export const ChevronDown = (p: P) => <Icon {...p}><path d="M3.5 6 8 10.5 12.5 6" /></Icon>;
export const Upload = (p: P) => <Icon {...p}><path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v3h11v-3" /></Icon>;
export const Save = (p: P) => <Icon {...p}><path d="M2.5 2.5h8.5l2.5 2.5v8.5h-11zM5 2.5v3.5h5V2.5M5 13.5v-4h6v4" /></Icon>;
export const Download = (p: P) => <Icon {...p}><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" /></Icon>;
export const Maximize = (p: P) => <Icon {...p}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></Icon>;
export const Minimize = (p: P) => <Icon {...p}><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" /></Icon>;
export const Close = (p: P) => <Icon {...p}><path d="M4 4l8 8M12 4l-8 8" /></Icon>;
export const Plus = (p: P) => <Icon {...p}><path d="M8 3v10M3 8h10" /></Icon>;
export const Trash = (p: P) => <Icon {...p}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9" /></Icon>;
export const Alert = (p: P) => <Icon {...p}><path d="M8 2.5 14 13H2zM8 6.5v3M8 11.5v.01" /></Icon>;
export const Info = (p: P) => <Icon {...p}><circle cx="8" cy="8" r="5.75" /><path d="M8 7.5v3.5M8 5.25v.01" /></Icon>;
export const Sidebar = (p: P) => <Icon {...p}><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M6.5 3v10" /></Icon>;
export const Folder = (p: P) => <Icon {...p}><path d="M2.5 4.5v8h11v-6.5H8L6.5 4.5z" /></Icon>;
export const Check = (p: P) => <Icon {...p}><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></Icon>;

/** Schedrift mark: three offset bars, the last one drifting late. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#1f2226" />
      <rect x="6" y="9" width="12" height="4" rx="1" fill="#5fb3a5" />
      <rect x="11" y="15" width="10" height="4" rx="1" fill="#5fb3a5" />
      <rect x="17" y="21" width="9" height="4" rx="1" fill="#e2593f" />
    </svg>
  );
}
