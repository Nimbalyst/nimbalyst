type McpToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
};

export const trackerToolSchemas = [
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
  },
];

export async function handleTrackerList(
  args: any,
  workspacePath: string | undefined
): Promise<McpToolResult> {
  try {
    const { getDatabase } = await import("../../database/initialize");
    const db = getDatabase();

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    // Always scope to workspace
    if (workspacePath) {
      conditions.push(`workspace = $${paramIdx++}`);
      params.push(workspacePath);
    }

    // Filter by archived state (default: exclude archived)
    if (args.archived) {
      conditions.push(`archived = TRUE`);
    } else {
      conditions.push(`(archived = FALSE OR archived IS NULL)`);
    }

    // Filter by type
    if (args.type) {
      conditions.push(`type = $${paramIdx++}`);
      params.push(args.type);
    }

    // Filter by status (stored in JSONB data field)
    if (args.status) {
      conditions.push(`data->>'status' = $${paramIdx++}`);
      params.push(args.status);
    }

    // Filter by priority (stored in JSONB data field)
    if (args.priority) {
      conditions.push(`data->>'priority' = $${paramIdx++}`);
      params.push(args.priority);
    }

    // Search title and description
    if (args.search) {
      conditions.push(
        `(data->>'title' ILIKE $${paramIdx} OR data->>'description' ILIKE $${paramIdx})`
      );
      params.push(`%${args.search}%`);
      paramIdx++;
    }

    const limit = Math.min(args.limit || 50, 250);
    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await db.query<any>(
      `SELECT id, type, data, archived, source, source_ref, updated
       FROM tracker_items
       ${whereClause}
       ORDER BY updated DESC
       LIMIT ${limit}`,
      params
    );

    const items = result.rows.map((row: any) => {
      const data =
        typeof row.data === "string"
          ? JSON.parse(row.data)
          : row.data || {};
      return {
        id: row.id,
        type: row.type,
        title: data.title || "",
        status: data.status || "",
        priority: data.priority || "",
        tags: data.tags || [],
        archived: row.archived ?? false,
        source: row.source || "native",
        updated: row.updated,
      };
    });

    const summary = items
      .map(
        (item: any) =>
          `- [${item.type}] ${item.title} (${item.status || "no status"}, ${item.priority || "no priority"}) [id: ${item.id}]`
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text:
            items.length > 0
              ? `Found ${items.length} tracker item(s):\n\n${summary}`
              : "No tracker items found matching the filters.",
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error("[MCP Server] tracker_list failed:", error);
    return {
      content: [
        {
          type: "text",
          text: `Error listing tracker items: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleTrackerGet(args: any): Promise<McpToolResult> {
  try {
    const { getDatabase } = await import("../../database/initialize");
    const db = getDatabase();

    const result = await db.query<any>(
      `SELECT * FROM tracker_items WHERE id = $1`,
      [args.id]
    );

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Tracker item not found: ${args.id}`,
          },
        ],
        isError: true,
      };
    }

    const row = result.rows[0];
    const data =
      typeof row.data === "string"
        ? JSON.parse(row.data)
        : row.data || {};

    // Build a readable representation
    const lines: string[] = [];
    lines.push(`# ${data.title || "Untitled"}`);
    lines.push("");
    lines.push(`**Type**: ${row.type}`);
    if (data.status) lines.push(`**Status**: ${data.status}`);
    if (data.priority) lines.push(`**Priority**: ${data.priority}`);
    if (data.tags?.length)
      lines.push(`**Tags**: ${data.tags.join(", ")}`);
    if (data.owner) lines.push(`**Owner**: ${data.owner}`);
    if (row.archived) lines.push(`**Archived**: yes`);
    if (row.source && row.source !== "native")
      lines.push(
        `**Source**: ${row.source}${row.source_ref ? ` (${row.source_ref})` : ""}`
      );
    if (data.linkedSessions?.length)
      lines.push(
        `**Linked Sessions**: ${data.linkedSessions.join(", ")}`
      );
    lines.push(`**ID**: ${row.id}`);
    lines.push(`**Updated**: ${row.updated}`);
    lines.push("");

    // Include content as markdown
    if (row.content) {
      const content =
        typeof row.content === "string"
          ? row.content
          : JSON.stringify(row.content);
      lines.push("---");
      lines.push("");
      lines.push(content);
    } else if (data.description) {
      lines.push("---");
      lines.push("");
      lines.push(data.description);
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error("[MCP Server] tracker_get failed:", error);
    return {
      content: [
        {
          type: "text",
          text: `Error getting tracker item: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleTrackerCreate(
  args: any,
  workspacePath: string | undefined
): Promise<McpToolResult> {
  try {
    const { getDatabase } = await import("../../database/initialize");
    const db = getDatabase();

    if (!workspacePath) {
      return {
        content: [
          {
            type: "text",
            text: "Error: No workspace path available. Cannot create tracker item.",
          },
        ],
        isError: true,
      };
    }

    // Check if this type allows creation
    const { globalRegistry } = await import("@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel");
    const model = globalRegistry.get(args.type);
    if (model && model.creatable === false) {
      return {
        content: [
          {
            type: "text",
            text: `Cannot create items of type '${args.type}' via tracker_create. ${args.type === 'automation' ? 'Use the automations.create tool instead.' : 'This type is read-only.'}`,
          },
        ],
        isError: true,
      };
    }

    const id = `${args.type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const data: Record<string, any> = {
      title: args.title,
      status: args.status || "to-do",
      priority: args.priority || "medium",
      created: new Date().toISOString().split("T")[0],
    };
    if (args.tags?.length) data.tags = args.tags;
    if (args.description) data.description = args.description;

    const contentJson = args.description
      ? JSON.stringify(args.description)
      : null;

    await db.query(
      `INSERT INTO tracker_items (
        id, type, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'pending', $5, FALSE, 'native', NULL)`,
      [id, args.type, JSON.stringify(data), workspacePath, contentJson]
    );

    // Notify renderer of the new item
    const { BrowserWindow } = await import("electron");
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("tracker-items-changed", {
          workspacePath,
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Created tracker item:\n- **Type**: ${args.type}\n- **Title**: ${args.title}\n- **Status**: ${data.status}\n- **ID**: ${id}`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error("[MCP Server] tracker_create failed:", error);
    return {
      content: [
        {
          type: "text",
          text: `Error creating tracker item: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleTrackerUpdate(
  args: any,
  workspacePath: string | undefined
): Promise<McpToolResult> {
  try {
    const { getDatabase } = await import("../../database/initialize");
    const db = getDatabase();

    // Read existing item
    const existing = await db.query<any>(
      `SELECT * FROM tracker_items WHERE id = $1`,
      [args.id]
    );
    if (existing.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Tracker item not found: ${args.id}`,
          },
        ],
        isError: true,
      };
    }

    const row = existing.rows[0];
    const data =
      typeof row.data === "string"
        ? JSON.parse(row.data)
        : row.data || {};

    // Apply updates to data JSONB
    if (args.title !== undefined) data.title = args.title;
    if (args.status !== undefined) data.status = args.status;
    if (args.priority !== undefined) data.priority = args.priority;
    if (args.tags !== undefined) data.tags = args.tags;
    if (args.description !== undefined)
      data.description = args.description;

    // Update data field
    await db.query(
      `UPDATE tracker_items SET data = $1, updated = NOW() WHERE id = $2`,
      [JSON.stringify(data), args.id]
    );

    // Update content if description changed
    if (args.description !== undefined) {
      const contentJson = JSON.stringify(args.description);
      await db.query(
        `UPDATE tracker_items SET content = $1 WHERE id = $2`,
        [contentJson, args.id]
      );
    }

    // Handle archive state
    if (args.archived !== undefined) {
      await db.query(
        `UPDATE tracker_items SET archived = $1, archived_at = $2 WHERE id = $3`,
        [
          args.archived,
          args.archived ? new Date().toISOString() : null,
          args.id,
        ]
      );
    }

    // Notify renderer
    const { BrowserWindow } = await import("electron");
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("tracker-items-changed", {
          workspacePath,
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Updated tracker item ${args.id}:\n${
            args.title !== undefined ? `- **Title**: ${args.title}\n` : ""
          }${
            args.status !== undefined
              ? `- **Status**: ${args.status}\n`
              : ""
          }${
            args.priority !== undefined
              ? `- **Priority**: ${args.priority}\n`
              : ""
          }${
            args.archived !== undefined
              ? `- **Archived**: ${args.archived}\n`
              : ""
          }${
            args.tags !== undefined
              ? `- **Tags**: ${args.tags.join(", ")}\n`
              : ""
          }`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error("[MCP Server] tracker_update failed:", error);
    return {
      content: [
        {
          type: "text",
          text: `Error updating tracker item: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleTrackerLinkSession(
  args: any,
  sessionId: string | undefined,
  workspacePath: string | undefined
): Promise<McpToolResult> {
  try {
    const { getDatabase } = await import("../../database/initialize");
    const db = getDatabase();

    if (!sessionId) {
      return {
        content: [
          {
            type: "text",
            text: "Error: No session ID available. This tool is only available during an active AI session.",
          },
        ],
        isError: true,
      };
    }

    // Read existing item
    const existing = await db.query<any>(
      `SELECT * FROM tracker_items WHERE id = $1`,
      [args.trackerId]
    );
    if (existing.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Tracker item not found: ${args.trackerId}`,
          },
        ],
        isError: true,
      };
    }

    const row = existing.rows[0];
    const data =
      typeof row.data === "string"
        ? JSON.parse(row.data)
        : row.data || {};

    // Add session to linkedSessions array
    const linkedSessions: string[] = data.linkedSessions || [];
    if (!linkedSessions.includes(sessionId)) {
      linkedSessions.push(sessionId);
      data.linkedSessions = linkedSessions;

      await db.query(
        `UPDATE tracker_items SET data = $1, updated = NOW() WHERE id = $2`,
        [JSON.stringify(data), args.trackerId]
      );
    }

    // Notify renderer
    const { BrowserWindow } = await import("electron");
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("tracker-items-changed", {
          workspacePath,
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Linked session ${sessionId} to tracker item ${args.trackerId}. Total linked sessions: ${linkedSessions.length}`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error(
      "[MCP Server] tracker_link_session failed:",
      error
    );
    return {
      content: [
        {
          type: "text",
          text: `Error linking session: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
