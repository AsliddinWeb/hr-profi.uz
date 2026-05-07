/* Tiny wrapper around the Web Speech API.
 *
 * Why not just call `speechSynthesis.speak(...)` inline:
 *   - We need to abort an in-flight utterance when a new event fires
 *     (otherwise rapid scans queue up "Asliddin... Asliddin... Asliddin"
 *     in a 5-second tail).
 *   - Voice selection is non-trivial: we want a voice in the user's
 *     locale if one is installed, falling back to whatever the browser
 *     defaults to. Cache the lookup so we're not iterating
 *     getVoices() on every utterance.
 *   - Some tablet browsers (older Android Chrome) silently no-op
 *     speak() until the user has interacted with the page. We can't
 *     fix that here, but we can avoid throwing.
 */

let voicesCache: SpeechSynthesisVoice[] | null = null;

function loadVoices(): SpeechSynthesisVoice[] {
  if (voicesCache && voicesCache.length > 0) return voicesCache;
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  voicesCache = window.speechSynthesis.getVoices();
  return voicesCache;
}

// Some browsers populate getVoices() asynchronously — listen for the
// "voiceschanged" event so the cache picks up the real list when ready.
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    voicesCache = window.speechSynthesis.getVoices();
  });
}

const LANG_MAP: Record<string, string[]> = {
  uz: ["uz-UZ", "uz", "tr-TR", "ru-RU", "en-US"], // Uzbek voice rare → fallback to Turkish/Russian (more natural for UZ phonetics)
  ru: ["ru-RU", "ru"],
  en: ["en-US", "en-GB", "en"],
};

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = loadVoices();
  if (!voices.length) return undefined;
  const candidates = LANG_MAP[lang] ?? [lang];
  for (const tag of candidates) {
    const exact = voices.find((v) => v.lang === tag);
    if (exact) return exact;
    const prefix = voices.find((v) => v.lang.toLowerCase().startsWith(tag.toLowerCase()));
    if (prefix) return prefix;
  }
  return voices[0];
}

/**
 * Speak ``text`` in the requested language. Cancels any pending
 * utterance first so messages never queue up. Safe no-op when the
 * Speech API is unavailable.
 */
export function speak(text: string, lang: string = "uz"): void {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
  try {
    synth.cancel(); // drop any in-flight queue
    const utter = new SpeechSynthesisUtterance(text);
    const v = pickVoice(lang);
    if (v) utter.voice = v;
    utter.lang = v?.lang ?? lang;
    utter.rate = 1.05; // slightly faster than default — feels snappier
    utter.pitch = 1;
    utter.volume = 1;
    synth.speak(utter);
  } catch {
    // Any browser quirk (e.g. NotAllowedError before first interaction)
    // — silently swallow; the visual overlay still tells the user
    // what happened.
  }
}
