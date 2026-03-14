import {
  isVoiceModeActive,
  sendToVoiceAgent,
  getActiveVoiceSessionId,
  stopVoiceSession,
} from "../../services/voice/VoiceModeService";

type McpToolResult = {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
};

export function handleVoiceAgentSpeak(args: any): McpToolResult {
  const message = args?.message as string | undefined;

  if (!message || typeof message !== "string") {
    return {
      content: [
        {
          type: "text",
          text: "Error: message parameter is required and must be a string",
        },
      ],
      isError: true,
    };
  }

  // Get the active voice session directly - works regardless of document state
  const activeVoiceSessionId = getActiveVoiceSessionId();

  if (!activeVoiceSessionId) {
    return {
      content: [
        {
          type: "text",
          text: "Voice mode is not currently active. The message cannot be spoken aloud. You can still respond to the user via text in the normal way.",
        },
      ],
      isError: false, // Not a hard error - just means voice mode isn't active
    };
  }

  // Attempt to send message to voice agent
  const success = sendToVoiceAgent(activeVoiceSessionId, message);

  if (!success) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to send message to voice agent. The voice connection may have been lost or disconnected. You can still respond to the user via text in the normal way.`,
        },
      ],
      isError: false, // Not a hard error - voice agent just isn't reachable
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Message queued for voice agent: "${message.substring(
          0,
          100
        )}${message.length > 100 ? "..." : ""}"`,
      },
    ],
    isError: false,
  };
}

export function handleVoiceAgentStop(): McpToolResult {
  const wasActive = stopVoiceSession();

  if (wasActive) {
    return {
      content: [
        {
          type: "text",
          text: "Voice mode session has been stopped successfully.",
        },
      ],
      isError: false,
    };
  } else {
    return {
      content: [
        {
          type: "text",
          text: "No active voice mode session to stop.",
        },
      ],
      isError: false, // Not a hard error - just means no session was active
    };
  }
}
