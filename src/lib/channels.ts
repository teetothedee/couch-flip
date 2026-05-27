export type Show = {
  title: string;
  year?: number;
  genre?: string;
  startTime?: string; // ISO
};

export type Channel = {
  id: string;
  name: string;
  emoji: string;
  color: string; // hex
  schedule: Show[]; // up to 4: Now, +30, +1h, +1.5h
  streamUrl?: string; // HLS .m3u8 when channel has a real stream
};

export const CHANNELS: Channel[] = [
  {
    id: "kung-fu",
    name: "Kung Fu Theater",
    emoji: "🐉",
    color: "#b91c1c",
    schedule: [
      { title: "Drunken Master", year: 1978, genre: "Martial Arts" },
      { title: "Five Deadly Venoms", year: 1978, genre: "Martial Arts" },
      { title: "The 36th Chamber of Shaolin", year: 1978, genre: "Action" },
      { title: "Enter the Dragon", year: 1973, genre: "Action" },
    ],
  },
  {
    id: "saturday-morning",
    name: "Saturday Morning",
    emoji: "🥣",
    color: "#f59e0b",
    schedule: [
      { title: "Looney Tunes Hour", year: 1989, genre: "Animation" },
      { title: "Teenage Mutant Ninja Turtles", year: 1987, genre: "Animation" },
      { title: "X-Men: The Animated Series", year: 1992, genre: "Animation" },
      { title: "DuckTales", year: 1987, genre: "Animation" },
    ],
  },
  {
    id: "sci-fi-sleepover",
    name: "Sci-Fi Sleepover",
    emoji: "👽",
    color: "#7c3aed",
    schedule: [
      { title: "The Thing", year: 1982, genre: "Sci-Fi Horror" },
      { title: "Blade Runner", year: 1982, genre: "Sci-Fi" },
      { title: "Akira", year: 1988, genre: "Anime" },
      { title: "Solaris", year: 1972, genre: "Sci-Fi" },
    ],
  },
  {
    id: "new-drop",
    name: "New Drop Cinema",
    emoji: "🎬",
    color: "#0ea5e9",
    schedule: [
      { title: "Anatomy of a Fall", year: 2023, genre: "Drama" },
      { title: "Past Lives", year: 2023, genre: "Romance" },
      { title: "The Zone of Interest", year: 2023, genre: "Drama" },
      { title: "Poor Things", year: 2023, genre: "Comedy" },
    ],
  },
  {
    id: "after-dark",
    name: "After Dark",
    emoji: "🌙",
    color: "#db2777",
    schedule: [
      { title: "Mulholland Drive", year: 2001, genre: "Mystery" },
      { title: "Lost Highway", year: 1997, genre: "Neo-Noir" },
      { title: "Eraserhead", year: 1977, genre: "Surreal" },
      { title: "Possession", year: 1981, genre: "Horror" },
    ],
  },
  {
    id: "late-night-docs",
    name: "Late Night Docs",
    emoji: "📼",
    color: "#16a34a",
    schedule: [
      { title: "Grizzly Man", year: 2005, genre: "Documentary" },
      { title: "The Act of Killing", year: 2012, genre: "Documentary" },
      { title: "Hoop Dreams", year: 1994, genre: "Documentary" },
      { title: "Sans Soleil", year: 1983, genre: "Essay Film" },
    ],
  },
  {
    id: "retro-pluto",
    name: "Retro Pluto",
    emoji: "📺",
    color: "#0891b2",
    schedule: [
      { title: "The Twilight Zone", year: 1959, genre: "Anthology" },
      { title: "Columbo", year: 1971, genre: "Crime" },
      { title: "Cheers", year: 1982, genre: "Sitcom" },
      { title: "The Rockford Files", year: 1974, genre: "Crime" },
    ],
  },
];

export const TIME_SLOTS = ["Now", "+30min", "+1hr", "+1.5hr"] as const;