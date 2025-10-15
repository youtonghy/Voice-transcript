import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { TranscriptionEvent } from "../types";

export function useTranscriptionEvents(
  onEvent: (event: TranscriptionEvent) => void,
) {
  useEffect(() => {
    let disposed = false;
    let unlistenTranscription: (() => void) | undefined;
    let unlistenMedia: (() => void) | undefined;

    (async () => {
      unlistenTranscription = await listen<TranscriptionEvent>(
        "transcription-event",
        (event) => {
          if (!disposed && event.payload) {
            onEvent(event.payload);
          }
        },
      );
      unlistenMedia = await listen<TranscriptionEvent>("media-event", (event) => {
        if (!disposed && event.payload) {
          onEvent(event.payload);
        }
      });
    })();

    return () => {
      disposed = true;
      if (unlistenTranscription) {
        unlistenTranscription();
      }
      if (unlistenMedia) {
        unlistenMedia();
      }
    };
  }, [onEvent]);
}
