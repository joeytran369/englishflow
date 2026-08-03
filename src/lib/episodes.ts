// Shared episode helpers — used by sidebar + pages.

export interface Episode {
  id: string;
  publishedAt?: string;
  generatedAt?: string;
  plan: { topic: string; setting: string; level: string; keyConcepts: string[]; category?: string };
  dialogue: { title: string; sceneBrief?: string; characters: any[]; lines: any[] };
  vocab: any[];
  audio?: any;
}

export function pubDate(ep: Episode): string {
  return (ep.publishedAt || ep.generatedAt || "").slice(0, 10);
}

export function sortByPublished(list: Episode[]): Episode[] {
  return [...list].sort((a, b) => {
    const da = a.publishedAt || a.generatedAt || "";
    const db = b.publishedAt || b.generatedAt || "";
    return db.localeCompare(da);
  });
}

export interface Category { name: string; gradient: string; dot: string }

const CATEGORY_STYLES: Record<string, { gradient: string; dot: string }> = {
  "Cloud Tech":  { gradient: "from-sky-500 via-blue-500 to-indigo-600",        dot: "bg-sky-500" },
  "Career":      { gradient: "from-emerald-400 via-teal-500 to-cyan-500",      dot: "bg-emerald-500" },
  "Office Life": { gradient: "from-amber-300 via-orange-400 to-rose-400",      dot: "bg-amber-500" },
  "Life Admin":  { gradient: "from-zinc-400 via-slate-500 to-zinc-600",        dot: "bg-zinc-400" },
  "Travel":      { gradient: "from-orange-300 via-red-400 to-pink-500",        dot: "bg-orange-500" },
  "Hobbies":     { gradient: "from-violet-400 via-purple-500 to-fuchsia-500",  dot: "bg-violet-500" },
};

export function categoryOf(setting: string, plan?: any): Category {
  if (plan?.category) {
    const name = String(plan.category);
    const style = CATEGORY_STYLES[name] ?? { gradient: "from-sky-600 via-blue-600 to-violet-600", dot: "bg-sky-500" };
    return { name, ...style };
  }
  const s = setting.toLowerCase();
  const has = (...words: string[]) =>
    words.some((w) => new RegExp(`\\b${w.replace(/[-\s]/g, "[- ]?")}\\b`, "i").test(s));
  if (has("openstack", "kubernetes", "k8s", "aws", "gcp", "azure", "cloud", "vpc", "vm", "volume", "snapshot", "ssh", "floating ip", "security group", "network acl", "glance", "cinder", "nova", "neutron"))
    return { name: "OpenStack", gradient: "from-sky-600 via-blue-600 to-violet-600", dot: "bg-sky-500" };
  if (has("code review", "pull request", "pr review", "merge conflict", "diff"))
    return { name: "Code Review", gradient: "from-violet-500 via-purple-500 to-fuchsia-500", dot: "bg-violet-500" };
  if (has("sprint", "standup", "planning", "scrum", "retro", "kanban"))
    return { name: "Sprint", gradient: "from-sky-500 via-blue-500 to-indigo-500", dot: "bg-indigo-500" };
  if (has("design", "architecture", "rfc", "adr"))
    return { name: "Architecture", gradient: "from-emerald-500 via-teal-500 to-cyan-500", dot: "bg-emerald-500" };
  if (has("interview"))
    return { name: "Interview", gradient: "from-amber-500 via-yellow-500 to-lime-500", dot: "bg-amber-500" };
  if (has("incident", "outage", "on-call", "p1", "p2", "post-mortem", "war room", "alert"))
    return { name: "Incident", gradient: "from-rose-500 via-orange-500 to-amber-500", dot: "bg-rose-500" };
  return { name: "Daily Work", gradient: "from-zinc-500 via-slate-500 to-zinc-600", dot: "bg-zinc-400" };
}

// Solid CEFR level chips — designed for high-contrast readability on poster overlays.
// Pattern: light mode = soft pastel bg + deep text, dark mode = deep solid bg + bright text.
// Always with subtle border to ground the chip on any background.
export const levelColor: Record<string, string> = {
  A2: "bg-sky-100 dark:bg-sky-900 text-sky-900 dark:text-sky-100 border-sky-300/60 dark:border-sky-700",
  B1: "bg-emerald-100 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100 border-emerald-300/60 dark:border-emerald-700",
  B2: "bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-100 border-amber-300/60 dark:border-amber-700",
  C1: "bg-rose-100 dark:bg-rose-900 text-rose-900 dark:text-rose-100 border-rose-300/60 dark:border-rose-700",
};

export function durationSec(ep: Episode): number {
  const a: any = ep.audio || {};
  if (a.durationSec) {
    const intro = a.mix?.intro?.durationSec ?? 0;
    const outro = a.mix?.outro?.durationSec ?? 0;
    return Math.round(a.durationSec + intro + outro);
  }
  const words = ep.dialogue.lines.reduce((n: number, l: any) => n + l.text.split(/\s+/).length, 0);
  return Math.ceil((words / 130) * 60);
}

export function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Canonical category list — order = display order on home page.
export const CATEGORY_LIST = ["Cloud Tech", "Career", "Office Life", "Life Admin", "Travel", "Hobbies"] as const;

export function categorySlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export interface CategoryGroup {
  name: string;
  slug: string;
  style: { gradient: string; dot: string };
  episodes: Episode[];
}

// Group sorted episodes by category, preserving CATEGORY_LIST order.
// Categories with zero episodes are omitted.
export function groupByCategory(episodes: Episode[]): CategoryGroup[] {
  const byCat: Record<string, Episode[]> = {};
  for (const ep of episodes) {
    const c = categoryOf(ep.plan.setting, ep.plan).name;
    (byCat[c] ||= []).push(ep);
  }
  return CATEGORY_LIST
    .filter((name) => byCat[name]?.length)
    .map((name) => ({
      name,
      slug: categorySlug(name),
      style: CATEGORY_STYLES[name] ?? { gradient: "from-sky-600 via-blue-600 to-violet-600", dot: "bg-sky-500" },
      episodes: byCat[name],
    }));
}
