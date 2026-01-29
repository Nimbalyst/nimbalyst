---
description: Create a diagram using Excalidraw
---

# /excalidraw Command

Create a diagram using Excalidraw.

Diagram request: $ARGUMENTS

## Workflow

1. **Determine the diagram type**
   - Flowchart / process diagram
   - Architecture diagram
   - System design
   - Sequence diagram
   - Mind map
   - Network diagram
   - User flow diagram
   - Other visual diagram

   **Note**: For database schemas and entity relationship diagrams, use the DataModelLM extension instead.

2. **Create or open file**
   - Create a new `.excalidraw` file if needed
   - Use descriptive filename (e.g., `system-architecture.excalidraw`)

3. **Build the diagram**
   Use the Excalidraw MCP tools:
   - `excalidraw.add_rectangle` - Add boxes/nodes
   - `excalidraw.add_arrow` - Add connections
   - `excalidraw.add_arrows` - Add multiple connections
   - `excalidraw.add_elements` - Add multiple elements at once
   - `excalidraw.align_elements` - Align elements
   - `excalidraw.distribute_elements` - Space evenly
   - `excalidraw.add_frame` - Group related elements

4. **Verify visually**
   - Use `mcp__nimbalyst-mcp__capture_editor_screenshot` to see the result
   - Iterate and refine as needed

## Available Tools

### Adding Elements
- `excalidraw.add_rectangle` - Add rectangle/box
- `excalidraw.add_arrow` - Add single arrow
- `excalidraw.add_arrows` - Add multiple arrows
- `excalidraw.add_elements` - Add multiple elements
- `excalidraw.add_frame` - Add frame container
- `excalidraw.add_row` - Add elements in row
- `excalidraw.add_column` - Add elements in column

### Modifying
- `excalidraw.update_element` - Update element
- `excalidraw.move_element` - Move element
- `excalidraw.remove_element` - Remove element
- `excalidraw.remove_elements` - Remove multiple

### Organization
- `excalidraw.align_elements` - Align elements
- `excalidraw.distribute_elements` - Distribute evenly
- `excalidraw.group_elements` - Group together
- `excalidraw.relayout` - Auto relayout

### Special
- `excalidraw.import_mermaid` - Convert from Mermaid
- `excalidraw.clear_all` - Clear diagram
- `excalidraw.get_elements` - Get all elements

## Tips

- Start with the main components, then add connections
- Use frames to visually group related items
- Use `align_elements` and `distribute_elements` for clean layouts
- For complex diagrams, consider using `import_mermaid` to generate initial structure
