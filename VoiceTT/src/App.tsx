import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import MainWindow from "./windows/MainWindow";
import SettingsWindow from "./windows/SettingsWindow";
import VoiceInputWindow from "./windows/VoiceInputWindow";
import MediaTranscribeWindow from "./windows/MediaTranscribeWindow";

type ViewKey = "main" | "settings" | "voice" | "media";

function resolveView(): ViewKey {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return "main";
  if (hash.startsWith("settings")) return "settings";
  if (hash.startsWith("voice")) return "voice";
  if (hash.startsWith("media")) return "media";
  return "main";
}

export default function App() {
  const { language } = useI18n();
  const [view, setView] = useState<ViewKey>(resolveView);

  useEffect(() => {
    const handler = () => setView(resolveView());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  switch (view) {
    case "settings":
      return <SettingsWindow initialLanguage={language} />;
    case "voice":
      return <VoiceInputWindow initialLanguage={language} />;
    case "media":
      return <MediaTranscribeWindow initialLanguage={language} />;
    default:
      return <MainWindow initialLanguage={language} />;
  }
}
