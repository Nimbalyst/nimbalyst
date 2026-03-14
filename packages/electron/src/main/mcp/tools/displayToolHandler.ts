import { isAbsolute } from "path";
import path from "path";

type McpToolResult = {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
};

export const displayToolSchemas = [
  {
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
  },
];

type ErrorBarsConfig = {
  dataKey?: string;
  errorKey?: string;
  errorKeyLower?: string;
  errorKeyUpper?: string;
  strokeWidth?: number;
};

type ChartContent = {
  chartType: "bar" | "line" | "pie" | "area" | "scatter";
  data: Record<string, unknown>[];
  xAxisKey: string;
  yAxisKey: string | string[];
  colors?: string[];
  errorBars?: ErrorBarsConfig;
};

type ImageContent = {
  path: string;
};

type DisplayItem = {
  description: string;
  image?: ImageContent;
  chart?: ChartContent;
};

type DisplayArgs = {
  items: DisplayItem[];
};

export function handleDisplayToUser(args: any): McpToolResult {
  const typedArgs = args as DisplayArgs | undefined;

  // Validate items array exists
  if (!typedArgs?.items) {
    return {
      content: [
        {
          type: "text",
          text: 'Error: "items" array is required. Provide an array of display items, each with a description and either an "image" or "chart" object.',
        },
      ],
      isError: true,
    };
  }

  if (!Array.isArray(typedArgs.items)) {
    return {
      content: [
        {
          type: "text",
          text: 'Error: "items" must be an array of display items.',
        },
      ],
      isError: true,
    };
  }

  if (typedArgs.items.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: 'Error: "items" array must contain at least one item.',
        },
      ],
      isError: true,
    };
  }

  // Validate each item
  const validChartTypes = ["bar", "line", "pie", "area", "scatter"];
  const displayedItems: string[] = [];

  for (let i = 0; i < typedArgs.items.length; i++) {
    const item = typedArgs.items[i];
    const itemPrefix = `items[${i}]`;

    // Validate description
    if (!item.description || typeof item.description !== "string") {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${itemPrefix} is missing required "description" field.`,
          },
        ],
        isError: true,
      };
    }

    // Check that exactly one content type is provided
    const hasImage = !!item.image;
    const hasChart = !!item.chart;

    if (!hasImage && !hasChart) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${itemPrefix} must have either an "image" or "chart" object. Description: "${item.description}"`,
          },
        ],
        isError: true,
      };
    }

    if (hasImage && hasChart) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${itemPrefix} has both "image" and "chart" - provide only one content type per item.`,
          },
        ],
        isError: true,
      };
    }

    // Validate image content
    if (hasImage) {
      if (!item.image!.path || typeof item.image!.path !== "string") {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${itemPrefix}.image.path is required and must be a string.`,
            },
          ],
          isError: true,
        };
      }

      const imagePath = item.image!.path;

      // Check if path looks like a URL (common mistake)
      if (
        imagePath.startsWith("http://") ||
        imagePath.startsWith("https://") ||
        imagePath.startsWith("data:")
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${itemPrefix}.image.path must be a LOCAL file path, not a URL. Got: "${imagePath.substring(
                0,
                100
              )}${
                imagePath.length > 100 ? "..." : ""
              }". Download the image to a local file first, then provide the absolute path to that file.`,
            },
          ],
          isError: true,
        };
      }

      // Validate path is absolute (prevents relative path traversal)
      if (!isAbsolute(imagePath)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${itemPrefix}.image.path must be an ABSOLUTE local file path (e.g., "/Users/name/image.png"), not a relative path. Got: "${imagePath}"`,
            },
          ],
          isError: true,
        };
      }

      // Normalize and resolve path (prevents path traversal attacks)
      const normalizedPath = path.resolve(imagePath);

      // Note: We intentionally do NOT check if the file exists here.
      // The widget handles missing files gracefully per-image, showing an error
      // for that specific image while still displaying other valid images.

      displayedItems.push(`image: ${item.description}`);
    }

    // Validate chart content
    if (hasChart) {
      const chart = item.chart!;

      if (!chart.chartType) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${itemPrefix}.chart.chartType is required.`,
            },
          ],
          isError: true,
        };
      }

      if (!validChartTypes.includes(chart.chartType)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${itemPrefix}.chart.chartType must be one of: ${validChartTypes.join(
                ", "
              )}. Got: "${chart.chartType}"`,
            },
          ],
          isError: true,
        };
      }

      if (
        !chart.data ||
        !Array.isArray(chart.data) ||
        chart.data.length === 0
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${itemPrefix}.chart.data must be a non-empty array.`,
            },
          ],
          isError: true,
        };
      }

      if (!chart.xAxisKey || typeof chart.xAxisKey !== "string") {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${itemPrefix}.chart.xAxisKey is required.`,
            },
          ],
          isError: true,
        };
      }

      if (!chart.yAxisKey) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${itemPrefix}.chart.yAxisKey is required.`,
            },
          ],
          isError: true,
        };
      }

      // Validate error bars if provided
      if (chart.errorBars) {
        const errorBars = chart.errorBars as Record<string, unknown>;

        // Check that we have either symmetric or asymmetric error data
        const hasSymmetric = typeof errorBars.errorKey === "string";
        const hasAsymmetric =
          typeof errorBars.errorKeyLower === "string" &&
          typeof errorBars.errorKeyUpper === "string";

        if (!hasSymmetric && !hasAsymmetric) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${itemPrefix}.chart.errorBars must have either "errorKey" (for symmetric errors) or both "errorKeyLower" and "errorKeyUpper" (for asymmetric errors).`,
              },
            ],
            isError: true,
          };
        }

        if (hasSymmetric && hasAsymmetric) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${itemPrefix}.chart.errorBars cannot have both "errorKey" and "errorKeyLower"/"errorKeyUpper". Use one or the other.`,
              },
            ],
            isError: true,
          };
        }

        // Validate strokeWidth if provided
        if (
          errorBars.strokeWidth !== undefined &&
          typeof errorBars.strokeWidth !== "number"
        ) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${itemPrefix}.chart.errorBars.strokeWidth must be a number.`,
              },
            ],
            isError: true,
          };
        }

        // Validate dataKey if provided (used for multi-series charts)
        if (
          errorBars.dataKey !== undefined &&
          typeof errorBars.dataKey !== "string"
        ) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${itemPrefix}.chart.errorBars.dataKey must be a string.`,
              },
            ],
            isError: true,
          };
        }

        // Pie charts don't support error bars
        if (chart.chartType === "pie") {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${itemPrefix}.chart.errorBars is not supported for pie charts.`,
              },
            ],
            isError: true,
          };
        }
      }

      displayedItems.push(
        `${chart.chartType} chart: ${item.description}`
      );
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Displayed ${
          typedArgs.items.length
        } item(s):\n${displayedItems.map((d) => `- ${d}`).join("\n")}`,
      },
    ],
    isError: false,
  };
}
