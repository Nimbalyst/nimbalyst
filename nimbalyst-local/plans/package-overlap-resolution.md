# Package Overlap Resolution - Summary

## Problem Identified

The Developer and Product Manager packages both included `/plan` and `/track` commands, causing conflicts when both packages were installed. The last installed package would overwrite the commands from the first.

## Solution Implemented

Created a **Core Package** containing shared commands that all users need, with automatic dependency resolution.

## Package Structure

### 1. Core Package (NEW)
**ID**: `core`
**Icon**: verified
**Commands**: 
- `/plan` - Generic planning for any type of work
- `/track` - Generic tracking supporting all tracker types

**Purpose**: Foundational commands useful for all users regardless of role.

### 2. Developer Package (UPDATED)
**ID**: `developer`
**Icon**: code
**Commands**: 
- `/analyze-code` - Code quality analysis
- `/write-tests` - Test generation

**Tracker Schemas**:
- `bug` - Bug tracking
- `task` - Task management
- `tech-debt` - Technical debt tracking

**Dependencies**: `['core']` - Core package auto-installed

### 3. Product Manager Package (UPDATED)
**ID**: `product-manager`
**Icon**: dashboard
**Commands**:
- `/roadmap` - Roadmap generation
- `/user-research` - User research documentation

**Tracker Schemas**:
- `feature-request` - Feature requests
- `user-story` - User stories
- `feedback` - User feedback

**Dependencies**: `['core']` - Core package auto-installed

## Technical Implementation

### 1. Automatic Dependency Resolution
**File**: `PackageService.ts`

When installing a package:
1. Check for dependencies in package definition
2. Recursively install dependencies that aren't already installed
3. Skip dependencies that are already present
4. Install the main package commands and schemas

```typescript
// Install dependencies first
if (pkg.dependencies && pkg.dependencies.length > 0) {
  for (const depId of pkg.dependencies) {
    const isDepInstalled = await this.isPackageInstalled(depId);
    if (!isDepInstalled) {
      await this.installPackage(depId); // Recursive
    }
  }
}
```

### 2. Package Registry Update
Added Core package to `ALL_PACKAGES` array:
```typescript
export const ALL_PACKAGES: ToolPackage[] = [
  CorePackage,        // NEW
  DeveloperPackage,
  ProductManagerPackage,
];
```

## User Experience

### Installing Developer Package
1. User clicks "Install" on Developer package
2. System detects Core dependency
3. System installs Core first (if not present)
4. System installs Developer package
5. User gets: `/plan`, `/track`, `/analyze-code`, `/write-tests` + dev schemas

### Installing Product Manager Package
1. User clicks "Install" on Product Manager package
2. System detects Core dependency
3. System installs Core first (if not present)
4. System installs Product Manager package
5. User gets: `/plan`, `/track`, `/roadmap`, `/user-research` + PM schemas

### Installing Both Packages
1. User installs Developer → Gets Core + Developer
2. User installs Product Manager → Core already installed, adds PM commands
3. Final result: All commands from all three packages, no conflicts

## Benefits

### No Conflicts
- Each package has unique command names
- Core commands are shared, not duplicated
- Last-installed-wins problem eliminated

### Automatic Dependencies
- Users don't need to manually install Core
- Dependency tree resolved automatically
- Single-click installation experience maintained

### Clear Separation
- Core = Universal commands everyone needs
- Developer = Development-specific tools
- Product Manager = Product-specific tools

### Extensible
- Future packages can also depend on Core
- Can create additional shared packages
- Dependency chains supported

## Files Modified

### New Files
- `packages/electron/src/shared/toolPackages/CorePackage.ts`

### Updated Files
- `packages/electron/src/shared/toolPackages/DeveloperPackage.ts` - Removed `/plan` and `/track`, added Core dependency
- `packages/electron/src/shared/toolPackages/ProductManagerPackage.ts` - Removed `/plan` and `/track`, added Core dependency
- `packages/electron/src/shared/toolPackages/index.ts` - Added CorePackage to registry
- `packages/electron/src/renderer/services/PackageService.ts` - Added dependency resolution logic

## Testing Needed

1. Install Core package alone
2. Install Developer package (should auto-install Core)
3. Install Product Manager package (Core already installed)
4. Verify all commands present and working
5. Verify no file conflicts or overwrites
6. Test uninstall with dependencies

## Status

**Implementation**: ✅ Complete
**Testing**: Pending manual verification
**Documentation**: ✅ Complete

The package overlap issue has been completely resolved with a clean, extensible solution!
