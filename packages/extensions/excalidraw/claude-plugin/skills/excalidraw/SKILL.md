---
name: excalidraw
description: Create diagrams and visual drawings using Excalidraw (.excalidraw files). Use when the user wants flowcharts, architecture diagrams, system diagrams, entity relationship diagrams, sketches, or any visual diagram.
---

# Excalidraw Diagrams

Excalidraw is Nimbalyst's whiteboard-style diagram editor for creating flowcharts, architecture diagrams, system diagrams, and visual sketches.

## When to Use Excalidraw

- Flowcharts and process diagrams
- Architecture diagrams
- System design diagrams
- Entity relationship diagrams
- Sequence diagrams
- Mind maps
- Any visual diagram or sketch

## File Format

- **Extension**: `.excalidraw`
- **Format**: JSON-based Excalidraw format
- **Location**: Any directory in the workspace

## Available MCP Tools

The Excalidraw extension provides these MCP tools for diagram manipulation:

### Getting Information
- `excalidraw.get_elements` - Get all elements in the diagram

### Adding Elements
- `excalidraw.add_rectangle` - Add a rectangle/box
- `excalidraw.add_arrow` - Add a single arrow
- `excalidraw.add_arrows` - Add multiple arrows at once
- `excalidraw.add_elements` - Add multiple elements at once
- `excalidraw.add_frame` - Add a frame (container for elements)
- `excalidraw.add_row` - Add elements in a horizontal row
- `excalidraw.add_column` - Add elements in a vertical column

### Modifying Elements
- `excalidraw.update_element` - Update an existing element
- `excalidraw.move_element` - Move an element to new position
- `excalidraw.remove_element` - Remove a single element
- `excalidraw.remove_elements` - Remove multiple elements

### Organization
- `excalidraw.align_elements` - Align elements horizontally/vertically
- `excalidraw.distribute_elements` - Distribute elements evenly
- `excalidraw.group_elements` - Group elements together
- `excalidraw.set_elements_in_frame` - Put elements into a frame
- `excalidraw.relayout` - Automatically relayout elements

### Special Features
- `excalidraw.import_mermaid` - Convert Mermaid syntax to Excalidraw
- `excalidraw.clear_all` - Clear all elements from the diagram

## Workflow

1. **Create file** - Create a new `.excalidraw` file or open existing one
2. **Use MCP tools** - Use the Excalidraw MCP tools to add/modify elements
3. **Verify visually** - Use `mcp__nimbalyst-mcp__capture_editor_screenshot` to see the result
4. **Iterate** - Make adjustments based on visual feedback

## Best Practices

- Use frames to group related elements
- Keep diagrams clean and readable
- Use consistent spacing and alignment
- Add arrows to show flow/relationships
- Use color sparingly for emphasis

## Example: Creating a Flowchart

1. Add rectangles for each step
2. Add arrows connecting the steps
3. Use `align_elements` to align horizontally/vertically
4. Use `distribute_elements` for even spacing
