import type { ContentDraft, ProfileSection, Settings } from "../shared/types.js";

export const DEFAULT_ANALYSIS_MODEL = "inception/mercury-2.5-preview";
export const DEFAULT_WRITING_MODEL = "deepseek/deepseek-v4-flash-0731";

const weekStart = () => {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - ((day + 6) % 7));
  return date;
};

const weekDays = [
  { id: "mon", day: "Mon", pillar: "Systems" },
  { id: "tue", day: "Tue", pillar: "Education" },
  { id: "wed", day: "Wed", pillar: "Proof" },
  { id: "thu", day: "Thu", pillar: "Opinion" },
  { id: "fri", day: "Fri", pillar: "Framework" },
] as const;

export const initialContentDrafts: ContentDraft[] = weekDays.map((item, index) => {
  const date = weekStart();
  date.setDate(date.getDate() + index);
  return {
    ...item,
    date: String(date.getDate()).padStart(2, "0"),
    title: "Untitled post",
    status: "Idea",
    hook: "",
    body: "",
  };
});

export const initialProfileSections: ProfileSection[] = [
  { id: "positioning", label: "Positioning", status: "Missing", summary: "Add your buyer, problem and outcome", guidance: "Name the buyer, the costly problem and the practical result.", current: "", suggested: "", checks: ["Names the market", "Explains the work", "Keeps the promise practical"] },
  { id: "headline", label: "Headline", status: "Missing", summary: "Add your current LinkedIn headline", guidance: "Lead with who you help and the operational result—not a list of tools.", current: "", suggested: "", checks: ["Names the buyer", "States the operational value", "Avoids tool-first positioning"] },
  { id: "about", label: "About", status: "Missing", summary: "Add your current About section", guidance: "Open with the operational problem you understand, then show how you think and work.", current: "", suggested: "", checks: ["Starts with the buyer problem", "Shows a point of view", "Uses plain language"] },
  { id: "featured", label: "Featured", status: "Missing", summary: "Add a useful teardown or case study", guidance: "Give profile visitors one concrete example of how you diagnose and improve a workflow.", current: "", suggested: "", checks: ["Useful without a sales call", "Shows your process", "Easy to skim"] },
  { id: "experience", label: "Experience", status: "Missing", summary: "Add your current service description", guidance: "Describe results and operating improvements before tools.", current: "", suggested: "", checks: ["Outcome first", "Current offer", "Credible scope"] },
  { id: "contact", label: "Contact path", status: "Missing", summary: "Add a low-pressure next step", guidance: "Make it easy to continue a useful conversation without a hard pitch.", current: "", suggested: "", checks: ["Low pressure", "Specific prompt", "Conversation-led"] },
];

export const initialSettings: Settings = {
  profileBrief: "",
  icpBrief: "Founders and owners of UK agencies operating for at least two years, with delivery, reporting, handoff or positioning friction.",
  offer: "AI agents, practical workflow automations and websites for founder-led agencies.",
  proofPoints: "",
  bannedPhrases: "game-changer, unlock, revolutionise, leverage AI, 10x, just checking in",
  voiceSamples: [""],
  refreshTime: "08:30",
  dailyTarget: 5,
  candidateLimit: 15,
  maxPostsPerSource: 15,
  filterMode: "broad",
  analysisModel: DEFAULT_ANALYSIS_MODEL,
  writingModel: DEFAULT_WRITING_MODEL,
  jsonPersistence: true,
};
