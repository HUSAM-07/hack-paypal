import type { ReactNode, SVGProps } from "react";

/**
 * Stroke icon set — 24px grid, 1.75 stroke, round joins. Every icon takes SVG props;
 * size with width/height or CSS. Add new glyphs here only if two or more components use them;
 * one-off glyphs live inside the component file.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(name: string, body: ReactNode, opts: { fill?: boolean; strokeWidth?: number } = {}) {
  const Icon = ({ size = 16, ...p }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={opts.fill ? "currentColor" : "none"}
      stroke={opts.fill ? "none" : "currentColor"}
      strokeWidth={opts.strokeWidth ?? 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {body}
    </svg>
  );
  Icon.displayName = `Icon${name}`;
  return Icon;
}

export const IconCheck = make("Check", <path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconX = make("X", <path d="M6 6l12 12M18 6L6 18" />);
export const IconPlus = make("Plus", <path d="M12 5v14M5 12h14" />);
export const IconMinus = make("Minus", <path d="M5 12h14" />);
export const IconChevronDown = make("ChevronDown", <path d="M6 9l6 6 6-6" />);
export const IconChevronUp = make("ChevronUp", <path d="M18 15l-6-6-6 6" />);
export const IconChevronRight = make("ChevronRight", <path d="M9 6l6 6-6 6" />);
export const IconChevronLeft = make("ChevronLeft", <path d="M15 6l-6 6 6 6" />);
export const IconChevronsUpDown = make("ChevronsUpDown", <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />);
export const IconArrowUp = make("ArrowUp", <path d="M12 19V5M5 12l7-7 7 7" />);
export const IconArrowDown = make("ArrowDown", <path d="M12 5v14M19 12l-7 7-7-7" />);
export const IconArrowRight = make("ArrowRight", <path d="M5 12h14M12 5l7 7-7 7" />);
export const IconArrowLeft = make("ArrowLeft", <path d="M19 12H5M12 19l-7-7 7-7" />);
export const IconArrowUpRight = make("ArrowUpRight", <path d="M7 17L17 7M8 7h9v9" />);
export const IconCornerDownLeft = make(
  "CornerDownLeft",
  <path d="M20 4v7a4 4 0 0 1-4 4H4M9 10l-5 5 5 5" />,
);
export const IconSearch = make(
  "Search",
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>,
);
export const IconSparkle = make(
  "Sparkle",
  <path d="M12 3c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6zM19 15c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z" />,
  { fill: true },
);
export const IconBolt = make("Bolt", <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />, {
  fill: true,
});
export const IconCopy = make(
  "Copy",
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="3" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </>,
);
export const IconRefresh = make(
  "Refresh",
  <>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </>,
);
export const IconThumbUp = make(
  "ThumbUp",
  <path d="M7 11v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7zm0 0l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.5 20H7" />,
);
export const IconThumbDown = make(
  "ThumbDown",
  <path d="M17 13V4h2.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H17zm0 0l-4 8a2.5 2.5 0 0 1-2.5-2.5V15H5.3a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.5 4H17" />,
);
export const IconMic = make(
  "Mic",
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);
export const IconPaperclip = make(
  "Paperclip",
  <path d="M20.5 11.5l-8.3 8.3a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />,
);
export const IconSend = make("Send", <path d="M12 19V5M5 12l7-7 7 7" />);
export const IconStop = make("Stop", <rect x="7" y="7" width="10" height="10" rx="2" />, {
  fill: true,
});
export const IconPlay = make("Play", <path d="M8 5.5v13l10.5-6.5L8 5.5z" />, { fill: true });
export const IconPause = make(
  "Pause",
  <>
    <rect x="6.5" y="5" width="4" height="14" rx="1" />
    <rect x="13.5" y="5" width="4" height="14" rx="1" />
  </>,
  { fill: true },
);
export const IconClock = make(
  "Clock",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const IconCalendar = make(
  "Calendar",
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>,
);
export const IconUser = make(
  "User",
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </>,
);
export const IconUsers = make(
  "Users",
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.9-3.3 3.4-5 6.5-5s5.6 1.7 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 15c1.6.6 2.6 2.2 3 5" />
  </>,
);
export const IconSettings = make(
  "Settings",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
);
export const IconSliders = make(
  "Sliders",
  <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5" />,
);
export const IconFilter = make("Filter", <path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5z" />);
export const IconMore = make(
  "More",
  <>
    <circle cx="5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="19" cy="12" r="1.3" />
  </>,
  { fill: true },
);
export const IconMoreVertical = make(
  "MoreVertical",
  <>
    <circle cx="12" cy="5" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="12" cy="19" r="1.3" />
  </>,
  { fill: true },
);
export const IconTrash = make(
  "Trash",
  <path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M10 11v6M14 11v6" />,
);
export const IconEdit = make(
  "Edit",
  <path d="M14.5 5.5l4 4M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5 4 20z" />,
);
export const IconPencil = IconEdit;
export const IconEye = make(
  "Eye",
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconEyeOff = make(
  "EyeOff",
  <path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
);
export const IconLock = make(
  "Lock",
  <>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </>,
);
export const IconShield = make(
  "Shield",
  <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z" />,
);
export const IconShieldCheck = make(
  "ShieldCheck",
  <>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z" />
    <path d="M9 12l2 2 4-4" />
  </>,
);
export const IconAlert = make(
  "Alert",
  <>
    <path d="M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17h.01" />
  </>,
);
export const IconInfo = make(
  "Info",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
);
export const IconAlertCircle = make(
  "AlertCircle",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16h.01" />
  </>,
);
export const IconCheckCircle = make(
  "CheckCircle",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.7 2.7L16 9.8" />
  </>,
);
export const IconXCircle = make(
  "XCircle",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </>,
);
export const IconCircle = make("Circle", <circle cx="12" cy="12" r="8.5" />);
export const IconCircleDashed = make(
  "CircleDashed",
  <circle cx="12" cy="12" r="8.5" strokeDasharray="3.2 3.2" />,
);
export const IconFile = make(
  "File",
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5" />
  </>,
);
export const IconFileText = make(
  "FileText",
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </>,
);
export const IconFolder = make(
  "Folder",
  <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10z" />,
);
export const IconImage = make(
  "Image",
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 15.5l-5-5-9 9" />
  </>,
);
export const IconUpload = make(
  "Upload",
  <path d="M12 15V4M7 9l5-5 5 5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />,
);
export const IconDownload = make(
  "Download",
  <path d="M12 4v11M7 10l5 5 5-5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />,
);
export const IconLink = make(
  "Link",
  <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />,
);
export const IconExternal = make(
  "External",
  <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
);
export const IconGlobe = make(
  "Globe",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
  </>,
);
export const IconMail = make(
  "Mail",
  <>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M3.5 7.5l8.5 6 8.5-6" />
  </>,
);
export const IconBell = make(
  "Bell",
  <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" />,
);
export const IconInbox = make(
  "Inbox",
  <>
    <path d="M3.5 13.5l2.6-7.4A2 2 0 0 1 8 4.8h8a2 2 0 0 1 1.9 1.3l2.6 7.4V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4.5z" />
    <path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5" />
  </>,
);
export const IconMessage = make(
  "Message",
  <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.1A8 8 0 1 1 20 12z" />,
);
export const IconChat = IconMessage;
export const IconHash = make("Hash", <path d="M5 9h15M4 15h15M10 3.5l-2 17M16 3.5l-2 17" />);
export const IconAt = make(
  "At",
  <>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M15.5 8.5v4.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7" />
  </>,
);
export const IconStar = make(
  "Star",
  <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />,
);
export const IconHeart = make(
  "Heart",
  <path d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10z" />,
);
export const IconBookmark = make("Bookmark", <path d="M6.5 3.5h11v17L12 16.5l-5.5 4v-17z" />);
export const IconPin = make("Pin", <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6.5" />);
export const IconHome = make(
  "Home",
  <path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15V15h-6v5.5H5.5A1.5 1.5 0 0 1 4 19v-8.5z" />,
);
export const IconGrid = make(
  "Grid",
  <>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <rect x="13" y="13" width="7" height="7" rx="2" />
  </>,
);
export const IconList = make(
  "List",
  <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
);
export const IconLayers = make(
  "Layers",
  <path d="M12 3.5l9 4.5-9 4.5-9-4.5 9-4.5zM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" />,
);
export const IconBox = make(
  "Box",
  <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9" />,
);
export const IconCode = make("Code", <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" />);
export const IconTerminal = make(
  "Terminal",
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M7 9.5l3 2.5-3 2.5M12.5 15H17" />
  </>,
);
export const IconBranch = make(
  "Branch",
  <>
    <circle cx="6.5" cy="5.5" r="2" />
    <circle cx="6.5" cy="18.5" r="2" />
    <circle cx="17.5" cy="7.5" r="2" />
    <path d="M6.5 7.5v9M17.5 9.5c0 4-4 4-11 7" />
  </>,
);
export const IconGitMerge = make(
  "GitMerge",
  <>
    <circle cx="6.5" cy="5.5" r="2" />
    <circle cx="6.5" cy="18.5" r="2" />
    <circle cx="17.5" cy="14.5" r="2" />
    <path d="M6.5 7.5v9M6.5 7.5c0 4 4 7 9 7" />
  </>,
);
export const IconCpu = make(
  "Cpu",
  <>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    <path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" />
  </>,
);
export const IconDatabase = make(
  "Database",
  <>
    <ellipse cx="12" cy="6" rx="7.5" ry="3" />
    <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
  </>,
);
/** Brain seen from above: two hemispheres split down the middle (reference glyph, 1.9 stroke). */
export const IconBrain = make(
  "Brain",
  <>
    <path d="M7 4.5C5.34 4.5 4 5.84 4 7.5c0 .57.16 1.1.43 1.55C3.05 9.32 2 10.54 2 12s1.05 2.68 2.43 2.95M7 4.5C7 3.12 8.12 2 9.5 2S12 3.12 12 4.5v15c0 1.38-1.12 2.5-2.5 2.5S7 20.88 7 19.5c-1.66 0-3-1.34-3-3 0-.57.16-1.1.43-1.55M7 4.5c0 .82.39 1.54 1 2M4.43 14.95c.36-.59.91-1.04 1.57-1.28" />
    <path d="M17 19.5c1.66 0 3-1.34 3-3 0-.57-.16-1.1-.43-1.55C20.95 14.68 22 13.46 22 12s-1.05-2.68-2.43-2.95M17 19.5c0 1.38-1.12 2.5-2.5 2.5S12 20.88 12 19.5v-15C12 3.12 13.12 2 14.5 2S17 3.12 17 4.5c1.66 0 3 1.34 3 3 0 .57-.16 1.1-.43 1.55M17 19.5c0-.82-.39-1.54-1-2M19.57 9.05c-.36.59-.91 1.04-1.57 1.28" />
  </>,
  { strokeWidth: 1.9 },
);
export const IconRobot = make(
  "Robot",
  <>
    <rect x="4.5" y="8" width="15" height="11" rx="3.5" />
    <path d="M12 4.5V8M9 13h.01M15 13h.01M2.5 13v2M21.5 13v2" />
  </>,
);
export const IconWand = make(
  "Wand",
  <path d="M15 4V2M15 10V8M11 6H9M21 6h-2M18 3l-1 1M18 9l-1-1M12 9L3 18l3 3 9-9-3-3z" />,
);
export const IconZap = make("Zap", <path d="M13 2.5L4.5 13.5H11l-1 8L18.5 10.5H12l1-8z" />);
export const IconTarget = make(
  "Target",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r=".8" />
  </>,
);
export const IconFlag = make("Flag", <path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5" />);
export const IconTag = make(
  "Tag",
  <>
    <path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6l8 8a1.5 1.5 0 0 1 0 2.1l-7.5 7.5a1.5 1.5 0 0 1-2.1 0l-7.5-8.5z" />
    <circle cx="8" cy="8" r="1.3" />
  </>,
);
export const IconDollar = make(
  "Dollar",
  <path d="M12 3v18M16.5 7.5c-.7-1.4-2.4-2.2-4.5-2.2-2.6 0-4.3 1.3-4.3 3.2 0 4.5 9 2.3 9 6.9 0 2-1.9 3.4-4.7 3.4-2.3 0-4.1-.9-4.8-2.6" />,
);
export const IconChart = make("Chart", <path d="M4 4v16h16M8 16v-4M12 16V8M16 16v-6" />);
export const IconTrendingUp = make("TrendingUp", <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />);
export const IconTrendingDown = make("TrendingDown", <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" />);
export const IconActivity = make("Activity", <path d="M3 12h4l3-8 4 16 3-8h4" />);
export const IconGauge = make(
  "Gauge",
  <>
    <path d="M4.2 17a9 9 0 1 1 15.6 0" />
    <path d="M12 13l4-4" />
  </>,
);
export const IconHistory = make(
  "History",
  <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
    <path d="M3.5 4v4.5H8M12 8v4.5l3 1.5" />
  </>,
);
export const IconRewind = make(
  "Rewind",
  <path d="M11 6.5L4 12l7 5.5v-11zM20 6.5L13 12l7 5.5v-11z" />,
);
export const IconUndo = make("Undo", <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />);
export const IconLogOut = make(
  "LogOut",
  <path d="M9 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3M15.5 16.5L20 12l-4.5-4.5M20 12H9" />,
);
export const IconSun = make(
  "Sun",
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </>,
);
export const IconMoon = make(
  "Moon",
  <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
);
export const IconCommand = make(
  "Command",
  <path d="M9 9V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V9z" />,
);
export const IconGrip = make(
  "Grip",
  <>
    <circle cx="9" cy="6" r="1.2" />
    <circle cx="15" cy="6" r="1.2" />
    <circle cx="9" cy="12" r="1.2" />
    <circle cx="15" cy="12" r="1.2" />
    <circle cx="9" cy="18" r="1.2" />
    <circle cx="15" cy="18" r="1.2" />
  </>,
  { fill: true },
);
export const IconMaximize = make(
  "Maximize",
  <path d="M15 4h5v5M9 20H4v-5M20 4l-6.5 6.5M4 20l6.5-6.5" />,
);
export const IconSidebar = make(
  "Sidebar",
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </>,
);
export const IconSmile = make(
  "Smile",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
  </>,
);
export const IconLightbulb = make(
  "Lightbulb",
  <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />,
);
export const IconRoute = make(
  "Route",
  <>
    <circle cx="6" cy="18.5" r="2" />
    <circle cx="18" cy="5.5" r="2" />
    <path d="M8 18.5h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8" />
  </>,
);
export const IconLoader = make(
  "Loader",
  <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />,
);
export const IconRepeat = make(
  "Repeat",
  <path d="M17 2.5l3 3-3 3M4 11.5v-1a5 5 0 0 1 5-5h11M7 21.5l-3-3 3-3M20 12.5v1a5 5 0 0 1-5 5H4" />,
);
export const IconScale = make(
  "Scale",
  <path d="M12 3.5v17M7 20.5h10M5 7.5h14M5 7.5l-2.5 6a3 3 0 0 0 5 0L5 7.5zM19 7.5l-2.5 6a3 3 0 0 0 5 0L19 7.5z" />,
);
export const IconPuzzle = make(
  "Puzzle",
  <path d="M9.5 4.5a2 2 0 0 1 4 0V6H18v4.5h1.5a2 2 0 0 1 0 4H18V19h-4.5v-1.5a2 2 0 0 0-4 0V19H5v-4.5h1.5a2 2 0 0 0 0-4H5V6h4.5V4.5z" />,
);
export const IconKey = make(
  "Key",
  <>
    <circle cx="8" cy="15" r="4.5" />
    <path d="M11.2 11.8L20 3M17 6l2.5 2.5M14.5 8.5L17 11" />
  </>,
);
export const IconSignal = make("Signal", <path d="M5 20v-3M10 20v-7M15 20V9M20 20V4" />);
export const IconWaveform = make(
  "Waveform",
  <path d="M3 12h1.5M6.5 8v8M10 5v14M13.5 9v6M17 7v10M20.5 11v2" />,
);
export const IconHand = make(
  "Hand",
  <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0v4.5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.7 15.4a1.6 1.6 0 0 1 2.4-2.1L8 15" />,
);
