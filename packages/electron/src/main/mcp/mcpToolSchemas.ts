import { app } from "electron";

interface ToolSchema {
  name: string;
  description: string;
  inputSchema: any;
}

/**
 * Get built-in tool schemas for the MCP server.
 * These define what tools are available to Claude Code.
 *
 * @param sessionId - The Nimbalyst session ID (some tools require it)
 * @returns Array of tool schema definitions
 */
export function getBuiltInToolSchemas(sessionId: string | undefined): ToolSchema[] {
  const tools: ToolSchema[] = [
    {
      name: "capture_editor_screenshot",
      description:
        "Capture a screenshot of any editor view. Works with all file types including custom editors (Excalidraw, CSV, mockups), markdown, code, etc. Use this to visually verify UI, diagrams, or any editor content.",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description:
              "The absolute path to the file being edited (optional, uses active file if not specified)",
          },
          selector: {
            type: "string",
            description:
              "CSS selector to capture a specific element (optional, captures full editor area if not specified)",
          },
        },
      },
    },
  ];

  // open_workspace is only available in development mode
  if (!app.isPackaged) {
    tools.push({
      name: "open_workspace",
      description:
        "Open a workspace (project directory) in Nimbalyst. This allows switching between different projects or opening additional workspaces. The workspace will open in a new window.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_path: {
            type: "string",
            description:
              "The absolute path to the workspace directory to open",
          },
        },
        required: ["workspace_path"],
      },
    });
  }

  tools.push({
    name: "display_to_user",
    description:
      'Display visual content inline in the conversation. Use this to show images or charts to the user. Provide an array of items, where each item has a description and exactly one content type: either "image" (for displaying a LOCAL file) or "chart" (for data visualizations). IMPORTANT: For images, you must provide an ABSOLUTE path to a LOCAL file on disk (e.g., "/Users/name/project/image.png"). URLs and relative paths are NOT supported. If a file does not exist, that specific image will show an error while other valid images still display.',
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description:
            "Array of visual items to display. Each item must have a description and exactly one content type (image or chart).",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              description: {
                type: "string",
                description:
                  "Brief description of what this visual content shows",
              },
              image: {
                type: "object",
                description:
                  "Display a LOCAL image file from disk. Provide this OR chart, not both. The file must exist locally.",
                properties: {
                  path: {
                    type: "string",
                    description:
                      'ABSOLUTE path to a LOCAL image file on disk (e.g., "/Users/name/project/screenshot.png"). URLs and relative paths are NOT supported. The file must exist.',
                  },
                },
                required: ["path"],
              },
              chart: {
                type: "object",
                description:
                  "Display a data chart. Provide this OR image, not both.",
                properties: {
                  chartType: {
                    type: "string",
                    enum: ["bar", "line", "pie", "area", "scatter"],
                    description: "The type of chart to render",
                  },
                  data: {
                    type: "array",
                    items: { type: "object" },
                    description:
                      "Array of data objects with keys matching xAxisKey and yAxisKey",
                  },
                  xAxisKey: {
                    type: "string",
                    description:
                      "Key in data objects for x-axis labels (or pie chart segment names)",
                  },
                  yAxisKey: {
                    oneOf: [
                      { type: "string" },
                      { type: "array", items: { type: "string" } },
                    ],
                    description:
                      "Key(s) in data objects for y-axis values. String for single series, array for multi-series",
                  },
                  colors: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Optional colors for chart series (hex codes or CSS color names)",
                  },
                  errorBars: {
                    type: "object",
                    description:
                      "Optional error bars configuration. Supports bar, line, area, and scatter charts.",
                    properties: {
                      dataKey: {
                        type: "string",
                        description:
                          "Key in data objects for the y-axis series to add error bars to (required when yAxisKey is an array)",
                      },
                      errorKey: {
                        type: "string",
                        description:
                          "Key in data objects containing error values (symmetric errors)",
                      },
                      errorKeyLower: {
                        type: "string",
                        description:
                          "Key in data objects for lower error values (asymmetric errors)",
                      },
                      errorKeyUpper: {
                        type: "string",
                        description:
                          "Key in data objects for upper error values (asymmetric errors)",
                      },
                      strokeWidth: {
                        type: "number",
                        description: "Width of error bar lines (default: 2)",
                      },
                    },
                  },
                },
                required: ["chartType", "data", "xAxisKey", "yAxisKey"],
              },
            },
            required: ["description"],
          },
        },
      },
      required: ["items"],
    },
  });

  // Voice tools - always available so they're discoverable
  tools.push(
    {
      name: "voice_agent_speak",
      description:
        "Send a message to the voice agent to be spoken aloud to the user. This tool serves as a communication bridge between the coding agent and the voice agent, enabling the coding agent to provide spoken updates, task completion notifications, or responses to the user during voice mode sessions. Use this when you want to inform the user about progress or results while they are interacting via voice. If voice mode is not active, this tool will return a non-error response indicating voice is unavailable. Keep messages concise and conversational.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "The message for the voice agent to speak to the user. Be concise and natural. This enables the coding agent to communicate with the user through the voice agent.",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "voice_agent_stop",
      description:
        "Stop the current voice mode session. Use this to end voice interactions when the conversation is complete, when the user requests to stop, or when transitioning away from voice mode. This will disconnect from the voice service and clean up resources. Returns success if a session was stopped, or indicates if no session was active.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    }
  );

  // Session-scoped tools (require sessionId)
  if (sessionId) {
    tools.push({
      name: "AskUserQuestion",
      description:
        "Prompt the user with one or more multiple-choice questions and wait for their response before continuing. Use this when you need explicit confirmation or disambiguation.",
      inputSchema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            description:
              "List of questions to ask the user. Each question should provide 2-3 options.",
            items: {
              type: "object",
              properties: {
                header: {
                  type: "string",
                  description:
                    "Short label shown above the question (12 chars or fewer)",
                },
                question: {
                  type: "string",
                  description: "The question to show the user",
                },
                options: {
                  type: "array",
                  minItems: 2,
                  items: {
                    type: "object",
                    properties: {
                      label: {
                        type: "string",
                        description: "User-facing option label",
                      },
                      description: {
                        type: "string",
                        description: "Short sentence describing this option",
                      },
                    },
                    required: ["label", "description"],
                  },
                },
                multiSelect: {
                  type: "boolean",
                  description:
                    "Whether multiple options can be selected for this question",
                },
              },
              required: ["header", "question", "options"],
            },
          },
        },
        required: ["questions"],
      },
    });

    tools.push({
      name: "get_session_edited_files",
      description:
        "Get the list of files that were edited during this AI session. Use this when you need to know which files have been modified as part of the current session, for example when preparing a git commit. Returns file paths relative to the workspace.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    });

    tools.push({
      name: "developer_git_commit_proposal",
      description: `Propose files and commit message for a git commit.

IMPORTANT: Before calling this tool, you MUST:
1. Call get_session_edited_files to get ALL files edited in this session
2. Cross-reference with git status to find which session files have uncommitted changes
3. Include ALL session-edited files that have changes - do not cherry-pick a subset

This tool will present an interactive widget to the user where they can review
and adjust your proposal before committing.

The commit message should follow these guidelines:
- Start with type prefix: feat:, fix:, refactor:, docs:, test:, chore:
- Focus on IMPACT and WHY, not implementation details
- Title describes user-visible outcome or bug fixed
- Use bullet points (dash prefix) only for multiple distinct changes
- Keep lines under 72 characters
- No emojis
- Lead with problem solved or capability added, not technique used`,
      inputSchema: {
        type: "object",
        properties: {
          filesToStage: {
            type: "array",
            items: {
              oneOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    path: {
                      type: "string",
                      description: "File path relative to workspace root",
                    },
                    status: {
                      type: "string",
                      enum: ["added", "modified", "deleted"],
                      description: "Git status of the file",
                    },
                  },
                  required: ["path", "status"],
                },
              ],
            },
            description:
              "Array of file paths (strings) or file objects with path and status (added/modified/deleted)",
          },
          commitMessage: {
            type: "string",
            description:
              "Proposed commit message following the guidelines above",
          },
          reasoning: {
            type: "string",
            description:
              "Explanation of why these files were selected and why this commit message is appropriate",
          },
        },
        required: ["filesToStage", "commitMessage", "reasoning"],
      },
    });
  }

  // Tracker tools - always available
  tools.push(
    {
      name: "tracker_list",
      description:
        "List tracker items (bugs, tasks, plans, ideas, decisions, etc.) with optional filtering. Returns a summary of each item. Use this to see what work items exist.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            description:
              "Filter by item type (e.g., 'bug', 'task', 'plan', 'idea', 'decision')",
          },
          status: {
            type: "string",
            description:
              "Filter by status (e.g., 'to-do', 'in-progress', 'done')",
          },
          priority: {
            type: "string",
            description:
              "Filter by priority (e.g., 'low', 'medium', 'high', 'critical')",
          },
          archived: {
            type: "boolean",
            description: "Include archived items (default: false)",
          },
          search: {
            type: "string",
            description: "Search title and description text",
          },
          limit: {
            type: "number",
            description: "Maximum number of items to return (default: 50)",
          },
        },
      },
    },
    {
      name: "tracker_get",
      description:
        "Get a single tracker item with its full content (as markdown). Use this to read the detailed body of a bug, plan, task, etc.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The tracker item ID",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "tracker_create",
      description:
        "Create a new tracker item (bug, task, plan, idea, decision, or any custom type).",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            description:
              "Item type (e.g., 'bug', 'task', 'plan', 'idea', 'decision')",
          },
          title: {
            type: "string",
            description: "Item title",
          },
          description: {
            type: "string",
            description:
              "Plain text or markdown description (stored as rich content)",
          },
          status: {
            type: "string",
            description: "Status (default: 'to-do')",
          },
          priority: {
            type: "string",
            description:
              "Priority level (e.g., 'low', 'medium', 'high', 'critical')",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for categorization",
          },
        },
        required: ["type", "title"],
      },
    },
    {
      name: "tracker_update",
      description:
        "Update an existing tracker item's metadata or content. Can change title, status, priority, tags, description, or archive state.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The tracker item ID to update",
          },
          title: {
            type: "string",
            description: "New title",
          },
          status: {
            type: "string",
            description: "New status",
          },
          priority: {
            type: "string",
            description: "New priority",
          },
          description: {
            type: "string",
            description: "New description content (replaces existing content)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "New tags (replaces existing tags)",
          },
          archived: {
            type: "boolean",
            description: "Set archive state",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "tracker_link_session",
      description:
        "Link the current AI session to a tracker item. This creates a bidirectional reference between the session and the work item.",
      inputSchema: {
        type: "object" as const,
        properties: {
          trackerId: {
            type: "string",
            description: "The tracker item ID to link to this session",
          },
        },
        required: ["trackerId"],
      },
    }
  );

  return tools;
}
