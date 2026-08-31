import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H8L4 22v-4.2A7.5 7.5 0 0 1 12.5 4.5 7.5 7.5 0 0 1 20 12Z" />
      <circle cx="9.8" cy="12" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="12" r=".9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l1.8 2.2h9A1.5 1.5 0 0 1 21 9.7v8.3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2} {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.8} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M8.2 5.4 17.6 11.5a.6.6 0 0 1 0 1L8.2 18.6a.6.6 0 0 1-.92-.5v-3.9a.6.6 0 0 1 .5-.6l4.3-.6-4.3-.6a.6.6 0 0 1-.5-.6V5.9a.6.6 0 0 1 .92-.5Z" />
    </Icon>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 11.5 12.3 19a4.6 4.6 0 0 1-6.5-6.5l7.7-7.6a3.1 3.1 0 1 1 4.3 4.4l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.1l7-7" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7h15M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7M6.5 7l.7 11.2A1.6 1.6 0 0 0 8.8 19.7h6.4a1.6 1.6 0 0 0 1.6-1.5L17.5 7" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.8M12 15.8v.4" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7 10 5 5 5-5" />
    </Icon>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8Z" />
      <path d="M13.5 3.5V8H18" />
    </Icon>
  );
}

/** Small lined-paper thumbnail used on citation cards. */
export function DocThumb({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 60"
      className={className}
      aria-hidden="true"
      role="presentation"
    >
      <rect
        x="0.75"
        y="0.75"
        width="46.5"
        height="58.5"
        rx="3"
        fill="var(--surface-card)"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <g fill="var(--accent)" opacity="0.32">
        <rect x="9" y="12" width="30" height="2.4" rx="1.2" />
        <rect x="9" y="19" width="30" height="2.4" rx="1.2" />
        <rect x="9" y="26" width="30" height="2.4" rx="1.2" />
        <rect x="9" y="33" width="30" height="2.4" rx="1.2" />
        <rect x="9" y="40" width="19" height="2.4" rx="1.2" />
      </g>
    </svg>
  );
}

/**
 * Illustrated document tray for the upload zone.
 *
 * Hand-authored SVG in the mockup's palette — a stand-in for the exact
 * illustration in the Claude Design export, which wasn't provided as an asset.
 * Same subject (tray + papers + plant + sparkles), not a pixel match.
 */
export function DocumentTrayIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden="true" role="presentation">
      {/* sparkles */}
      <g fill="#d8bb96">
        <path d="M158 34c.4 5.4 1.6 6.6 7 7-5.4.4-6.6 1.6-7 7-.4-5.4-1.6-6.6-7-7 5.4-.4 6.6-1.6 7-7Z" />
        <path d="M147 55c.25 3.2 1 4 4.2 4.2-3.2.25-4 1-4.2 4.2-.25-3.2-1-4-4.2-4.2 3.2-.25 4-1 4.2-4.2Z" />
      </g>

      {/* plant */}
      <g>
        <path
          d="M40 100c-9-4-13-13-12-23 8 2 13 9 14 19"
          fill="#cfd9bd"
          stroke="#a9b891"
          strokeWidth="1.6"
        />
        <path
          d="M44 100c6-6 7-15 4-23-6 5-8 13-7 21"
          fill="#dde5cf"
          stroke="#a9b891"
          strokeWidth="1.6"
        />
        <path d="M42 78v24" stroke="#a9b891" strokeWidth="1.6" strokeLinecap="round" />
        <path
          d="M32 100h20l-2.4 15.5a3 3 0 0 1-3 2.5H37.4a3 3 0 0 1-3-2.5Z"
          fill="#c08a5c"
        />
      </g>

      {/* papers stacked behind the tray */}
      <g stroke="#ddd3c2" strokeWidth="1.6">
        <rect x="82" y="34" width="52" height="62" rx="4" fill="#fdfcfa" transform="rotate(-7 108 65)" />
        <rect x="88" y="40" width="52" height="62" rx="4" fill="#fdfcfa" transform="rotate(4 114 71)" />
      </g>
      <g fill="#e3d7c6">
        <rect x="97" y="52" width="34" height="3.2" rx="1.6" />
        <rect x="97" y="61" width="34" height="3.2" rx="1.6" />
        <rect x="97" y="70" width="22" height="3.2" rx="1.6" />
      </g>

      {/* tray */}
      <path
        d="M62 88h96a4 4 0 0 1 4 4v28a6 6 0 0 1-6 6H64a6 6 0 0 1-6-6V92a4 4 0 0 1 4-4Z"
        fill="#e0be95"
      />
      <path
        d="M58 98h34l4 7h28l4-7h34v22a6 6 0 0 1-6 6H64a6 6 0 0 1-6-6Z"
        fill="#cfa878"
      />

      {/* envelope badge on the tray front */}
      <circle cx="110" cy="112" r="10" fill="#fdfcfa" />
      <path
        d="M104.6 108.5h10.8v7h-10.8z"
        fill="none"
        stroke="#b8895a"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="m104.6 108.8 5.4 4 5.4-4"
        fill="none"
        stroke="#b8895a"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
